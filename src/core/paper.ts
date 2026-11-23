// 紙PKM のページの一覧(vault の paper/index.json)。画面にも Electron にも依存しない。
//
// ・ページごとに内部 ID(pid)を自動で付ける。Folgezettel ID(fz)とは別。並びや fz を直しても pid は変わらない
// ・デジタルのノードとは別の名前空間(ノードの ID とは衝突しない。キャンバスの「紙」ノードは pid で指す)
// ・取り込みは「足すだけ」。既存のページを黙って上書き・削除しない

import { compareFz, earlierSiblings, normalizeFz, parseFz } from "./folgezettel";

export type PaperStatus = "auto" | "manual" | "review";

export interface OcrResult {
  engine: string;
  /** エンジンが返した生の読み(画像の作り方ごと。例: そのまま・青だけ) */
  reads: string[];
  /** 自動で決めた理由、または要確認の理由 */
  reason: string;
  /** 候補(よくある読み違いを直したものも含む) */
  candidates: string[];
}

export interface PaperPage {
  pid: string;
  /** Folgezettel ID。読めなかった・未確定なら null */
  fz: string | null;
  status: PaperStatus;
  ocr?: OcrResult;
  /** ページ画像の中身の sha256(同じページの取り込み直しを見つける) */
  sha: string;
  source: { name: string; sha: string; page: number };
  /** vault からの場所 */
  img: string;
  thumb: string;
  crop: string;
  w: number;
  h: number;
  imported: string;
  /** 取り込んだ順(同じ fz が複数あるときの並び) */
  seq: number;
  /** fz を直した記録 */
  history?: { fz: string | null; at: string }[];
}

export interface PaperIndex {
  v: 1;
  pages: PaperPage[];
}

export function emptyIndex(): PaperIndex {
  return { v: 1, pages: [] };
}

export function parseIndex(text: string | null): PaperIndex {
  if (!text) return emptyIndex();
  const j = JSON.parse(text) as PaperIndex;
  if (!j || j.v !== 1 || !Array.isArray(j.pages)) throw new Error("paper/index.json の形が違います");
  return j;
}

// ---------- OCR の読みから決める ----------

/** 手書きでよくある読み違い(数字の位置にある英字 → 数字 など)を直した候補 */
export function confusionFixes(raw: string): string[] {
  const s = normalizeFz(raw).replace(/[^0-9a-z-]/g, "");
  const out = new Set<string>();
  const add = (x: string) => {
    if (parseFz(x)) out.add(parseFz(x)!.id);
  };
  add(s);
  // l・i・| は 1 に見えやすい。先頭や、英字の直後(数字が来るはずの所)で 1 にした形
  add(s.replace(/[li|]/g, "1"));
  add(s.replace(/^[li|]/, "1"));
  add(s.replace(/(?<=[a-z])[li|](?=[a-z]|$)/g, "1").replace(/^[li|]/, "1"));
  // o は 0 か a。z は 2、s は 5、g は 9(数字の位置のとき)
  add(s.replace(/^o/, "0"));
  add(s.replace(/^z/, "2").replace(/^s/, "5"));
  // ハイフンの読み落とし・読み足しはここでは作らない(意味が変わるので人に聞く)
  return [...out];
}

/**
 * OCR の読み(複数)から fz と状態を決める。
 * 自動で確定するのは、2 通り以上の読みがすべて同じ正しい ID になり、その ID のページがまだ無いときだけ。
 */
export function decideFz(
  reads: string[],
  taken: (fz: string) => boolean,
  /** 読みが分かれたとき、ほかのページですでに使われている ID は後回しにする(同じ読みを繰り返す癖への手当て) */
  usedElsewhere: (fz: string) => boolean = taken,
): { fz: string | null; status: PaperStatus; reason: string; candidates: string[] } {
  const norm = reads.map((r) => normalizeFz(r));
  const valid = norm.map((r) => parseFz(r)?.id ?? null);
  const cands: string[] = [];
  for (const r of norm) for (const c of confusionFixes(r)) if (!cands.includes(c)) cands.push(c);
  const allSame = valid.length > 0 && valid.every((v) => v && v === valid[0]);
  if (allSame) {
    const fz = valid[0]!;
    if (taken(fz)) return { fz, status: "review", reason: `同じID(${fz})のページがほかにもあります`, candidates: cands };
    if (reads.length < 2) return { fz, status: "review", reason: "読みが 1 通りだけなので確かめてください", candidates: cands };
    return { fz, status: "auto", reason: `${reads.length} 通りの読みが一致`, candidates: cands };
  }
  if (!valid.some(Boolean)) {
    return { fz: cands[0] ?? null, status: "review", reason: cands.length ? "IDの形で読めなかった(直した候補あり)" : "IDを読めなかった", candidates: cands };
  }
  const vs = valid.filter(Boolean) as string[];
  // ほかのページで使われていない読みを先に。次に、1 と見間違えやすい l・i を含まない読みを先に(3bl より 3b1)
  const score = (v: string) => (usedElsewhere(v) ? 2 : 0) + (/[li]/.test(v) ? 1 : 0);
  const first = [...vs].sort((x, y) => score(x) - score(y))[0]!;
  const ordered = [first, ...cands.filter((c) => c !== first)];
  return { fz: first, status: "review", reason: `読みが分かれた(${norm.map((r) => r || "なし").join(" / ")})`, candidates: ordered };
}

// ---------- 一覧 ----------

/** 系列ごとに、Folgezettel の順に並べる(同じ fz は取り込んだ順)。0 は無くても入口として出す */
export function bySeries(ix: PaperIndex): { series: number; pages: PaperPage[] }[] {
  const m = new Map<number, PaperPage[]>([[0, []]]);
  for (const p of ix.pages) {
    const f = p.fz ? parseFz(p.fz) : null;
    if (!f) continue;
    if (!m.has(f.series)) m.set(f.series, []);
    m.get(f.series)!.push(p);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([series, pages]) => ({ series, pages: sortPages(pages) }));
}

export function sortPages(pages: PaperPage[]): PaperPage[] {
  return [...pages].sort((a, b) => compareFz(a.fz ?? "", b.fz ?? "") || a.seq - b.seq);
}

/** ID が未確定(読めない・正しくない)のページ */
export function unsorted(ix: PaperIndex): PaperPage[] {
  return ix.pages.filter((p) => !p.fz || !parseFz(p.fz)).sort((a, b) => a.seq - b.seq);
}

/** 全ページを Folgezettel の順に(前後のページ送りに使う) */
export function ordered(ix: PaperIndex): PaperPage[] {
  return bySeries(ix).flatMap((s) => s.pages);
}

export function byPid(ix: PaperIndex, pid: string): PaperPage | undefined {
  return ix.pages.find((p) => p.pid === pid);
}

export function pagesWithFz(ix: PaperIndex, fz: string): PaperPage[] {
  const id = parseFz(fz)?.id ?? normalizeFz(fz);
  return sortPages(ix.pages.filter((p) => p.fz === id));
}

/** fz を直す(人が直したものは manual。直した記録を残す)。pid は変わらないのでリンクは切れない */
export function setFz(ix: PaperIndex, pid: string, fz: string | null, now = new Date().toISOString()): PaperIndex {
  const norm = fz === null || fz.trim() === "" ? null : (parseFz(fz)?.id ?? null);
  if (fz && fz.trim() && !norm) throw new Error(`IDの形が正しくありません: ${fz}`);
  return {
    ...ix,
    pages: ix.pages.map((p) =>
      p.pid !== pid ? p : { ...p, fz: norm, status: norm ? "manual" : "review", history: [...(p.history ?? []), { fz: p.fz, at: now }] },
    ),
  };
}

// ---------- 取り込み ----------

/** 取り込み前の 1 ページ(画像は一時置き場にある) */
export interface StagedPage {
  key: string; // 一時置き場の中の名前
  sha: string;
  source: { name: string; sha: string; page: number };
  w: number;
  h: number;
  ocr?: OcrResult;
  fz: string | null;
  status: PaperStatus;
  /** 同じ画像がすでにある(取り込み直し)。既定では取り込まない */
  dupOf?: string;
}

/** 同じ中身のページを探す(すでに取り込んだもの) */
export function findDuplicate(ix: PaperIndex, sha: string): PaperPage | undefined {
  return ix.pages.find((p) => p.sha === sha);
}

/**
 * 取り込みの結果を一覧に足す(既存のページは変えない)。
 * 同じ fz が既存にあっても上書きせず、新しいページとして足す(一覧では取り込んだ順に並ぶ)
 */
export function addPages(ix: PaperIndex, pages: Omit<PaperPage, "seq">[]): PaperIndex {
  let seq = ix.pages.reduce((m, p) => Math.max(m, p.seq), 0);
  const have = new Set(ix.pages.map((p) => p.pid));
  for (const p of pages) if (have.has(p.pid)) throw new Error(`内部IDが重なりました: ${p.pid}`);
  return { ...ix, pages: [...ix.pages, ...pages.map((p) => ({ ...p, seq: ++seq }))] };
}

/** ページを一覧から外す(画像は消さず、呼ぶ側で paper/.trash へ移す) */
export function removePage(ix: PaperIndex, pid: string): PaperIndex {
  return { ...ix, pages: ix.pages.filter((p) => p.pid !== pid) };
}

/** 同じ fz を持つページが複数ある fz の一覧 */
export function duplicateFz(ix: PaperIndex): string[] {
  const c = new Map<string, number>();
  for (const p of ix.pages) if (p.fz) c.set(p.fz, (c.get(p.fz) ?? 0) + 1);
  return [...c.entries()].filter(([, n]) => n > 1).map(([f]) => f).sort(compareFz);
}

/**
 * 自動で決まった ID の前の兄弟(1d なら 1a・1b・1c)が、一覧にも今回の取り込みにも無ければ、その ID を返す(読み違いの疑い)。
 * 手書きの番号は順に付けるので、抜けがあれば読み違い(1b → 1d など)のことが多い
 */
export function missingSibling(fz: string, have: (fz: string) => boolean): string | null {
  for (const s of earlierSiblings(fz)) if (!have(s)) return s;
  return null;
}
