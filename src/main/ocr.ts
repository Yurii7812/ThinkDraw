// 紙PKM の左上の手書きIDを読む OCR。エンジンは差し替えられる形にする。
//
// 既定はローカルの ollama の画像モデル 2 つ(無料・キー不要)。別のモデルで読み、一致したときだけ自動で確定する。
// CPU では画像を読み込む部分が重い(1 回 1 分前後)ので、何ページか分の左上を 1 枚の画像に縦に並べて、まとめて読む。
// 使えないときは、読めたふりをせず理由を返す。

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface OcrEngine {
  readonly name: string;
  /** 使えるなら null、使えないなら理由 */
  check(): Promise<string | null>;
  /** 左上を切り出した画像(ファイル)ごとに、ID の文字だけを返す。読めなければ "" */
  readMany(files: string[], work: string, onBatch?: (done: number) => void): Promise<string[]>;
}

export interface OcrModel {
  model: string;
  /** 1 回に何ページ分まとめるか */
  batch: number;
}

export interface OcrSettings {
  engine: "ollama" | "none";
  url: string;
  models: OcrModel[];
}

export const DEFAULT_OCR: OcrSettings = {
  engine: "ollama",
  url: "http://127.0.0.1:11434",
  models: [
    { model: "qwen2.5vl:7b", batch: 8 },
    { model: "gemma3:4b", batch: 4 },
  ],
};

function prompt(n: number): string {
  return [
    `This image has ${n} rows, labelled in red on the right side as R1 to R${n} (the labels are not part of the IDs).`,
    "Each row is the top-left corner of a different handwritten notebook page.",
    "At the top-left of each row there is a short handwritten note ID in blue ink, made of digits and lowercase latin letters alternating, possibly with one hyphen.",
    "If the ID is followed by ' - ' and Japanese words, that is a title: give only the ID. Ignore Japanese text and crossed-out marks.",
    "Read each row on its own; rows are unrelated.",
    `Answer with exactly ${n} lines in the form 'R<n>: ID'. Write 'R<n>: none' if there is no ID.`,
  ].join(" ");
}

/** モデルの返事(1 行分)から ID らしい部分だけを取り出す */
export function pickIdToken(answer: string): string {
  const s = answer.normalize("NFKC").trim().replace(/^["'`*\s]+|["'`*\s.]+$/g, "");
  if (/^none\b/i.test(s)) return "";
  const m = s.match(/[0-9A-Za-z|]+(?:\s?-\s?[0-9A-Za-z]+)?/);
  return m ? m[0].replace(/\s/g, "") : "";
}

/** 「R1: 1a」の行を読み、行ごとの答えにする */
export function parseRows(answer: string, n: number): string[] {
  const got = new Map<number, string>();
  for (const m of answer.matchAll(/R\s*(\d+)\s*[:.)]\s*([^\n]*)/gi)) {
    const k = Number(m[1]);
    // 行の印(R3 など)をそのまま答えたものは、読めなかったことにする
    if (!got.has(k)) got.set(k, /^r\d+$/i.test(pickIdToken(m[2]!)) ? "" : pickIdToken(m[2]!));
  }
  return Array.from({ length: n }, (_, i) => got.get(i + 1) ?? "");
}

/** 左上の切り出しを、右に R1… の印を付けて縦に並べた 1 枚にする */
async function composeRows(files: string[], out: string): Promise<void> {
  const rows: string[] = [];
  for (const [k, f] of files.entries()) {
    const r = `${out}.r${k}.png`;
    await run("magick", [f, "-resize", "x170", "-background", "white", "-gravity", "east", "-splice", "110x0", "-fill", "#d00000", "-pointsize", "44", "-annotate", "+8+0", `R${k + 1}`, "-bordercolor", "#888888", "-border", "2", r]);
    rows.push(r);
  }
  await run("magick", [...rows, "-background", "white", "-append", out]);
  for (const r of rows) await fs.rm(r, { force: true });
}

export class OllamaEngine implements OcrEngine {
  readonly name: string;
  constructor(private url: string, private m: OcrModel) {
    this.name = `ollama:${m.model}`;
  }

  async check(): Promise<string | null> {
    try {
      const res = await fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return `ollama が応答しません(${res.status})`;
      const j = (await res.json()) as { models?: { name: string }[] };
      const want = this.m.model.includes(":") ? this.m.model : `${this.m.model}:latest`;
      if (!j.models?.some((x) => x.name === want)) return `ollama にモデル ${this.m.model} がありません(ollama pull ${this.m.model})`;
      return null;
    } catch {
      return `ollama に接続できません(${this.url})。ollama serve が動いているか確かめてください`;
    }
  }

  async readMany(files: string[], work: string, onBatch?: (done: number) => void): Promise<string[]> {
    const out: string[] = [];
    const size = Math.max(1, Math.min(12, Math.round(this.m.batch) || 1));
    for (let b = 0; b < files.length; b += size) {
      const part = files.slice(b, b + size);
      const img = path.join(work, `ocr-${this.m.model.replace(/[^a-z0-9]/gi, "_")}-${b}.png`);
      await composeRows(part, img);
      const res = await fetch(`${this.url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.m.model,
          prompt: prompt(part.length),
          images: [(await fs.readFile(img)).toString("base64")],
          stream: false,
          keep_alive: "10m",
          options: { temperature: 0, num_predict: 16 * part.length + 16 },
        }),
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!res.ok) throw new Error(`ollama(${this.m.model}): ${res.status} ${await res.text()}`);
      const j = (await res.json()) as { response?: string };
      out.push(...parseRows(j.response ?? "", part.length));
      onBatch?.(out.length);
    }
    return out;
  }
}

export function makeEngines(s: OcrSettings): OcrEngine[] {
  if (s.engine !== "ollama") return [];
  const url = s.url.replace(/\/+$/, "");
  return (s.models ?? []).filter((m) => m.model?.trim()).map((m) => new OllamaEngine(url, m));
}
