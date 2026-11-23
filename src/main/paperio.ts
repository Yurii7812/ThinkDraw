// 紙PKM の取り込み・保存(main プロセス)。
//
// vault/paper/
//   index.json          ページの一覧(内部ID・Folgezettel ID・状態・OCR の読み)
//   pages/<pid>.jpg     ページの画像(取り込んだときのまま)
//   thumbs/<pid>.jpg    小さな絵(一覧用)
//   crops/<pid>.png     左上の切り出し(IDの確認用)
//   sources/<sha>.<ext> 取り込んだ元の PDF・画像(消さない)
//   backups/            index.json を書き換える前の写し(新しい 30 件)
//   .staging/<batch>/   取り込みの途中(確定するまで一覧には入らない)
//   .trash/             一覧から外したページ

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  addPages, decideFz, emptyIndex, findDuplicate, missingSibling, parseIndex, removePage, setFz, sortPages,
  type PaperIndex, type PaperPage, type StagedPage,
} from "../core/paper";
import { normalizeFz, parseFz } from "../core/folgezettel";
import { atomicWrite } from "./fsio";
import type { OcrEngine } from "./ocr";

const run = promisify(execFile);
export const PAPER_DIR = "paper";

export interface StageProgress {
  batch: string;
  phase: "render" | "ocr" | "done";
  done: number;
  total: number;
  message?: string;
}

export interface Staged {
  batch: string;
  pages: StagedPage[];
  /** OCR を使えなかったときの理由(このときは全ページ要確認) */
  ocrError: string | null;
  engine: string | null;
}

const IMG_EXT = /\.(jpe?g|png|tiff?|webp|bmp|gif|heic)$/i;

function sha256(b: Buffer | Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

function newPid(): string {
  // ノードの ID(10 文字)とは別の形。紙のページだと分かるよう p で始める
  return "p" + randomBytes(6).toString("hex");
}

async function magick(args: string[]): Promise<string> {
  const { stdout } = await run("magick", args, { maxBuffer: 16 << 20 });
  return stdout;
}

async function sizeOf(file: string): Promise<{ w: number; h: number }> {
  const out = await magick(["identify", "-format", "%w %h", file + "[0]"]);
  const [w, h] = out.trim().split(/\s+/).map(Number);
  return { w: w || 0, h: h || 0 };
}

/** 少しずつ並行して処理する */
async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        await fn(items[k]!, k);
      }
    }),
  );
}

export interface CropSettings {
  /** 左上の切り出しの幅・高さ(ページに対する割合) */
  w: number;
  h: number;
}
export const DEFAULT_CROP: CropSettings = { w: 0.3, h: 0.09 };

export class PaperStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly vault: string) {}

  private p(...xs: string[]): string {
    return path.join(this.vault, PAPER_DIR, ...xs);
  }

  /** 一覧の読み書きは 1 本の列で(同時に書いて壊さないように) */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.queue.then(fn, fn);
    this.queue = r.catch(() => {});
    return r;
  }

  async readIndex(): Promise<PaperIndex> {
    try {
      return parseIndex(await fs.readFile(this.p("index.json"), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyIndex();
      throw e;
    }
  }

  private async writeIndex(ix: PaperIndex): Promise<void> {
    // 書き換える前の写しを残す
    try {
      const old = await fs.readFile(this.p("index.json"));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await atomicWrite(this.p("backups", `index-${stamp}.json`), old);
      const list = (await fs.readdir(this.p("backups"))).filter((f) => f.startsWith("index-")).sort();
      for (const f of list.slice(0, Math.max(0, list.length - 30))) await fs.rm(this.p("backups", f), { force: true });
    } catch {
      /* まだ無い */
    }
    await atomicWrite(this.p("index.json"), JSON.stringify(ix, null, 1));
  }

  // ---------- 取り込み(一時置き場へ) ----------

  /** PDF・画像を一時置き場に開き、左上を切り出して OCR する。一覧はまだ変えない */
  async stage(files: string[], engines: OcrEngine[], crop: CropSettings, onProgress: (p: StageProgress) => void): Promise<Staged> {
    const batch = new Date().toISOString().replace(/\D/g, "").slice(0, 14) + "-" + randomBytes(3).toString("hex");
    const dir = this.p(".staging", batch);
    await fs.mkdir(dir, { recursive: true });
    const ix = await this.readIndex();

    // 1) ページの画像にする
    interface Raw { key: string; file: string; source: { name: string; sha: string; page: number; path: string; ext: string } }
    const raws: Raw[] = [];
    let n = 0;
    for (const f of files) {
      const data = await fs.readFile(f);
      const ssha = sha256(data);
      const ext = path.extname(f).toLowerCase().replace(/^\./, "") || "bin";
      const source = { name: path.basename(f), sha: ssha, path: f, ext };
      if (ext === "pdf") {
        onProgress({ batch, phase: "render", done: 0, total: files.length, message: `${source.name} をページに分けています` });
        const prefix = path.join(dir, `s${n}`);
        await run("pdftoppm", ["-r", "200", "-jpeg", "-jpegopt", "quality=90", f, prefix], { maxBuffer: 16 << 20 });
        const outs = (await fs.readdir(dir)).filter((x) => x.startsWith(`s${n}-`) && x.endsWith(".jpg")).sort((a, b) => num(a) - num(b));
        outs.forEach((o, i) => raws.push({ key: o.replace(/\.jpg$/, ""), file: path.join(dir, o), source: { ...source, page: i + 1 } }));
      } else if (IMG_EXT.test(f)) {
        const key = `s${n}-1`;
        const out = path.join(dir, key + ".jpg");
        if (/^jpe?g$/.test(ext)) {
          // 向きの情報(EXIF)があれば直す。無ければ元のまま(画質を落とさない)
          const orient = (await magick(["identify", "-format", "%[orientation]", f]).catch(() => "")).trim();
          if (orient && orient !== "TopLeft" && orient !== "Undefined") await magick([f, "-auto-orient", "-quality", "95", out]);
          else await fs.copyFile(f, out);
        } else {
          await magick([f + "[0]", "-auto-orient", "-background", "white", "-flatten", "-quality", "95", out]);
        }
        raws.push({ key, file: out, source: { ...source, page: 1 } });
      } else {
        throw new Error(`取り込めない種類のファイルです: ${source.name}(PDF か画像)`);
      }
      n++;
    }

    // 2) 小さな絵・左上の切り出し(並行)
    const prepared: (StagedPage & { cropFile: string })[] = new Array(raws.length);
    let done = 0;
    await pool(raws, 4, async (r, i) => {
      const buf = await fs.readFile(r.file);
      const { w, h } = await sizeOf(r.file);
      await magick([r.file, "-thumbnail", "480x", "-quality", "80", path.join(dir, r.key + ".thumb.jpg")]);
      const cropFile = path.join(dir, r.key + ".crop.png");
      // 左上を切り出し、薄いインクを濃くする。
      // (余白を自動で落とす -trim は、薄い青のインクまで余白として消してしまうので使わない。2026-11-23 実物のスキャンで確認)
      await magick([
        r.file, "-resize", "50%", "-gravity", "NorthWest", "-crop", `${Math.round(crop.w * 100)}%x${Math.round(crop.h * 100)}%+0+0`, "+repage",
        "-level", "0%,80%", "-resize", "720x>", cropFile,
      ]);
      prepared[i] = {
        key: r.key, sha: sha256(buf), source: { name: r.source.name, sha: r.source.sha, page: r.source.page }, w, h,
        fz: null, status: "review", cropFile,
      };
      onProgress({ batch, phase: "render", done: ++done, total: raws.length });
    });
    // 元のファイルは、確定するときに sources/ へ写す
    const srcList = [...new Map(raws.map((r) => [r.source.sha, r.source])).values()];
    await atomicWrite(path.join(dir, "sources.json"), JSON.stringify(srcList));

    // 3) OCR: モデルごとに、何ページ分かをまとめて読む(ollama は同時に 1 つ)
    const checks = await Promise.all(engines.map(async (e) => ({ e, why: await e.check() })));
    const usable = checks.filter((c) => !c.why).map((c) => c.e);
    const ocrError = !engines.length ? "OCR を使わない設定です" : !usable.length ? checks.map((c) => c.why).join(" / ") : null;
    const ocrNote = usable.length && usable.length < engines.length ? checks.filter((c) => c.why).map((c) => c.why).join(" / ") : null;
    const reads: string[][] = prepared.map(() => []);
    const failed: string[] = [];
    const total = prepared.length * usable.length;
    let base = 0;
    for (const e of usable) {
      try {
        const got = await e.readMany(prepared.map((p) => p.cropFile), dir, (d) => onProgress({ batch, phase: "ocr", done: base + d, total }));
        got.forEach((r, i) => reads[i]!.push(r));
      } catch (err) {
        failed.push(`${e.name}: ${(err as Error).message}`);
      }
      base += prepared.length;
    }
    const taken = new Set(ix.pages.map((p) => p.fz).filter(Boolean) as string[]);
    const batchFz = new Map<string, number>();
    // 2 つの読みが一致したページの ID(読みが分かれたページで、どちらを先に出すかに使う)
    const agreed = reads.map((rs) => {
      const v = rs.map((r) => parseFz(r)?.id ?? null);
      return v.length > 1 && v.every((x) => x && x === v[0]) ? v[0]! : null;
    });
    for (const [i, pg] of prepared.entries()) {
      const dup = findDuplicate(ix, pg.sha);
      const dupInBatch = prepared.slice(0, i).find((o) => o.sha === pg.sha);
      if (dup) pg.dupOf = dup.pid;
      if (dupInBatch) pg.dupOf = "batch:" + dupInBatch.key;
      if (usable.length) {
        const d = decideFz(reads[i]!, (f) => taken.has(f), (f) => taken.has(f) || agreed.some((a, j) => j !== i && a === f));
        const notes = [d.reason, ...(failed.length ? [`読めなかったモデル: ${failed.join(" / ")}`] : []), ...(ocrNote ? [ocrNote] : [])];
        pg.fz = d.fz;
        pg.status = d.status;
        pg.ocr = { engine: usable.map((e) => e.name).join(" + "), reads: reads[i]!, reason: notes.join("。"), candidates: d.candidates };
      } else {
        pg.ocr = { engine: engines.map((e) => e.name).join(" + ") || "none", reads: [], reason: ocrError ?? "", candidates: [] };
      }
      if (pg.fz) batchFz.set(pg.fz, (batchFz.get(pg.fz) ?? 0) + 1);
      if (pg.dupOf) pg.status = "review";
    }
    const have = (f: string) => taken.has(f) || batchFz.has(f);
    for (const pg of prepared) {
      if (!pg.fz || pg.status !== "auto" || !pg.ocr) continue;
      // 同じ取り込みの中で同じIDになったページは、自動で確定しない
      if ((batchFz.get(pg.fz) ?? 0) > 1) {
        pg.status = "review";
        pg.ocr.reason = `この取り込みの中に同じID(${pg.fz})のページが複数あります`;
        continue;
      }
      // 前の番号が抜けていれば、読み違いの疑い
      const miss = missingSibling(pg.fz, have);
      if (miss) {
        pg.status = "review";
        pg.ocr.reason = `前の番号(${miss})が一覧にも今回の取り込みにも無いので、読み違いかもしれません`;
      }
    }
    const pages: StagedPage[] = prepared.map(({ cropFile: _c, ...p }) => p);
    await atomicWrite(path.join(dir, "staged.json"), JSON.stringify(pages));
    onProgress({ batch, phase: "done", done: pages.length, total: pages.length });
    return { batch, pages, ocrError, engine: usable.map((e) => e.name).join(" + ") || null };
  }

  /** 一時置き場のページを確定して一覧に足す。decisions に無いページ・include=false のページは取り込まない */
  commit(batch: string, decisions: { key: string; fz: string | null; include: boolean }[]): Promise<PaperIndex> {
    return this.serial(async () => {
      const dir = this.p(".staging", safeSeg(batch));
      const staged = JSON.parse(await fs.readFile(path.join(dir, "staged.json"), "utf8")) as StagedPage[];
      const sources = JSON.parse(await fs.readFile(path.join(dir, "sources.json"), "utf8")) as { sha: string; path: string; ext: string }[];
      const now = new Date().toISOString();
      const add: Omit<PaperPage, "seq">[] = [];
      const moves: [string, string][] = [];
      for (const d of decisions) {
        if (!d.include) continue;
        const s = staged.find((x) => x.key === d.key);
        if (!s) continue;
        const norm = d.fz && d.fz.trim() ? (parseFz(d.fz)?.id ?? null) : null;
        if (d.fz && d.fz.trim() && !norm) throw new Error(`IDの形が正しくありません: ${d.fz}`);
        const pid = newPid();
        const changed = norm !== s.fz;
        add.push({
          pid, fz: norm, status: !norm ? "review" : changed ? "manual" : s.status === "auto" ? "auto" : "manual",
          ocr: s.ocr, sha: s.sha, source: s.source, w: s.w, h: s.h, imported: now,
          img: `${PAPER_DIR}/pages/${pid}.jpg`, thumb: `${PAPER_DIR}/thumbs/${pid}.jpg`, crop: `${PAPER_DIR}/crops/${pid}.png`,
        });
        moves.push([path.join(dir, s.key + ".jpg"), this.p("pages", pid + ".jpg")]);
        moves.push([path.join(dir, s.key + ".thumb.jpg"), this.p("thumbs", pid + ".jpg")]);
        moves.push([path.join(dir, s.key + ".crop.png"), this.p("crops", pid + ".png")]);
      }
      // 画像を先に置き、最後に一覧を書く(途中で失敗しても、一覧は前のまま)
      for (const sub of ["pages", "thumbs", "crops", "sources"]) await fs.mkdir(this.p(sub), { recursive: true });
      for (const [a, b] of moves) await fs.copyFile(a, b);
      for (const s of sources) {
        const dest = this.p("sources", `${s.sha}.${s.ext}`);
        try {
          await fs.access(dest);
        } catch {
          await fs.copyFile(s.path, dest).catch(() => {});
        }
      }
      const ix = addPages(await this.readIndex(), add);
      await this.writeIndex(ix);
      await fs.rm(dir, { recursive: true, force: true });
      return ix;
    });
  }

  async discard(batch: string): Promise<void> {
    await fs.rm(this.p(".staging", safeSeg(batch)), { recursive: true, force: true });
  }

  setFz(pid: string, fz: string | null): Promise<PaperIndex> {
    return this.serial(async () => {
      const ix = setFz(await this.readIndex(), pid, fz);
      await this.writeIndex(ix);
      return ix;
    });
  }

  /** 一覧から外す(画像は paper/.trash/ に移して残す) */
  remove(pid: string): Promise<PaperIndex> {
    return this.serial(async () => {
      const ix = await this.readIndex();
      const pg = ix.pages.find((p) => p.pid === pid);
      if (!pg) return ix;
      const t = this.p(".trash", pid);
      await fs.mkdir(t, { recursive: true });
      await atomicWrite(path.join(t, "page.json"), JSON.stringify(pg, null, 1));
      for (const rel of [pg.img, pg.thumb, pg.crop]) {
        await fs.rename(path.join(this.vault, rel), path.join(t, path.basename(path.dirname(rel)) + "-" + path.basename(rel))).catch(() => {});
      }
      const next = removePage(ix, pid);
      await this.writeIndex(next);
      return next;
    });
  }

  /** 書き出し: 系列ごとのフォルダに「並び順_ID_内部ID.jpg」で写し、一覧(index.json)も置く */
  async exportTo(dest: string): Promise<number> {
    const ix = await this.readIndex();
    const sorted = sortPages(ix.pages);
    let k = 0;
    for (const pg of sorted) {
      const f = pg.fz ? parseFz(pg.fz) : null;
      const sub = f ? String(f.series) : "未確定";
      const name = `${String(++k).padStart(4, "0")}_${(pg.fz ?? "未確定").replace(/[^0-9a-z-]/g, "_")}_${pg.pid}.jpg`;
      await fs.mkdir(path.join(dest, sub), { recursive: true });
      await fs.copyFile(path.join(this.vault, pg.img), path.join(dest, sub, name));
    }
    await atomicWrite(path.join(dest, "index.json"), JSON.stringify(ix, null, 1));
    return sorted.length;
  }
}

function num(name: string): number {
  return Number(name.match(/-(\d+)\.jpg$/)?.[1] ?? 0);
}

function safeSeg(s: string): string {
  if (!/^[0-9a-z-]+$/.test(s)) throw new Error("取り込みの番号が正しくありません");
  return s;
}

export { normalizeFz };
