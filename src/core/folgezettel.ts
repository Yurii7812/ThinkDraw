// 紙PKM の Folgezettel ID の解析と並べ替え。画面にも Electron にも依存しない。
//
// 書き方(2026-11-23 利用者の指示書):
//   通常ノート      1, 1a, 1a1, 1a1a, 2c, 3a1 … (数字と英字を交互に)
//   索引・まとめ    1a-1, 1a-1a, 1a3-1, 1a1-1 …(ハイフンの後ろも数字から始まり、交互)
//   全体索引        0(入口), 0-1, 0-1a, 0-2 …
// 古い紙は「1」「2」から始まる(今は「1a」から)。どちらも同じ規則で読める。

export type FzKind = "note" | "index" | "master";

export interface FzId {
  /** 正規化した形(小文字・空白なし) */
  id: string;
  /** 系列(先頭の数字)。0 は全体索引 */
  series: number;
  /** 通常ノート(note)・索引まとめ(index)・全体索引の系列(master: 0 番台) */
  kind: FzKind;
  /** ハイフンより前(索引の対象)。通常ノートなら自分自身 */
  base: string;
  /** ハイフンより後ろ(索引の部分)。無ければ null */
  indexPart: string | null;
  baseSegs: (number | string)[];
  indexSegs: (number | string)[] | null;
}

/** 数字と英字が交互に並んだ部分(数字から始まる)を、区切りの配列にする */
function segs(s: string): (number | string)[] | null {
  if (!/^\d+([a-z]+\d+)*[a-z]*$/.test(s)) return null;
  const out: (number | string)[] = [];
  for (const m of s.matchAll(/\d+|[a-z]+/g)) out.push(/^\d/.test(m[0]) ? Number(m[0]) : m[0]);
  return out;
}

/** 手書きのよくある書き揺れをそろえる(大文字→小文字、空白・全角を除く)。読み違いの訂正はしない */
export function normalizeFz(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑‒–—―−ー]/g, "-")
    .replace(/\s+/g, "");
}

/** ID として正しい形なら解析結果、そうでなければ null */
export function parseFz(raw: string): FzId | null {
  const id = normalizeFz(raw);
  const parts = id.split("-");
  if (parts.length > 2) return null;
  const baseSegs = segs(parts[0]!);
  if (!baseSegs) return null;
  let indexSegs: (number | string)[] | null = null;
  if (parts.length === 2) {
    indexSegs = segs(parts[1]!);
    if (!indexSegs) return null;
  }
  const series = baseSegs[0] as number;
  const kind: FzKind = series === 0 ? "master" : indexSegs ? "index" : "note";
  return { id, series, kind, base: parts[0]!, indexPart: parts.length === 2 ? parts[1]! : null, baseSegs, indexSegs };
}

export function isValidFz(raw: string): boolean {
  return parseFz(raw) !== null;
}

// 並べ方: 索引・まとめは、その対象の直前。対象の子(1a1 など)は対象の後ろ。
//   1a-1 < 1a-1a < 1a-1b < 1a-2 < 1a < 1a1-1 < 1a1 < 1a1a < 1a2 < 1b
// 鍵を「区切りの列 + 印」にして、前から比べる。印は 索引(IDX) < 自分(SELF) < 子の区切り。
const IDX = { mark: 0 } as const;
const SELF = { mark: 1 } as const;
type KeyEl = number | string | typeof IDX | typeof SELF;

function keyOf(f: FzId): KeyEl[] {
  return f.indexSegs ? [...f.baseSegs, IDX, ...f.indexSegs] : [...f.baseSegs, SELF];
}

function rank(e: KeyEl): number {
  if (e === IDX) return 0;
  if (e === SELF) return 1;
  return 2;
}

function cmpEl(a: KeyEl, b: KeyEl): number {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra < 2) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  // 交互の規則上、同じ位置に数字と英字は来ない。念のため数字を先に
  return typeof a === "number" ? -1 : 1;
}

/** 2 つの ID の順(負なら a が先)。正しくない ID は後ろへ、その中では文字の順 */
export function compareFz(a: string, b: string): number {
  const fa = parseFz(a), fb = parseFz(b);
  if (!fa || !fb) {
    if (fa) return -1;
    if (fb) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const ka = keyOf(fa), kb = keyOf(fb);
  const n = Math.min(ka.length, kb.length);
  for (let i = 0; i < n; i++) {
    const c = cmpEl(ka[i]!, kb[i]!);
    if (c) return c;
  }
  return ka.length - kb.length;
}

export function sortFz(ids: string[]): string[] {
  return [...ids].sort(compareFz);
}

/** 1 つ上(1a1 → 1a、1a1-1a → 1a1-1、1a-1 → 1a、1 → null)。存在の確認はしない */
export function parentFz(raw: string): string | null {
  const f = parseFz(raw);
  if (!f) return null;
  const join = (s: (number | string)[]) => s.join("");
  if (f.indexSegs) return f.indexSegs.length > 1 ? `${f.base}-${join(f.indexSegs.slice(0, -1))}` : f.base;
  return f.baseSegs.length > 1 ? join(f.baseSegs.slice(0, -1)) : null;
}

/** 系列の見出し(0 は全体索引) */
export function seriesOf(raw: string): number | null {
  return parseFz(raw)?.series ?? null;
}

/**
 * 同じ親の、前の兄弟すべて(1d → 1a・1b・1c、1a3 → 1a1・1a2、1a-2 → 1a-1)。
 * 系列そのもの(1・2・3)は飛ぶことがあるので見ない。英字は a〜z の 1 文字の範囲だけ見る。
 */
export function earlierSiblings(raw: string): string[] {
  const f = parseFz(raw);
  if (!f) return [];
  const segsOf = f.indexSegs ?? f.baseSegs;
  if (!f.indexSegs && segsOf.length < 2) return [];
  const last = segsOf[segsOf.length - 1]!;
  const head = segsOf.slice(0, -1).join("");
  const prefix = f.indexSegs ? `${f.base}-${head}` : head;
  const out: string[] = [];
  if (typeof last === "number") for (let k = 1; k < last && k < 200; k++) out.push(prefix + k);
  else if (last.length === 1) for (let c = 97; c < last.charCodeAt(0); c++) out.push(prefix + String.fromCharCode(c));
  return out;
}
