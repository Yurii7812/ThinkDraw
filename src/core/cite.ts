// ノートの文章の引用(2026-11-26 修正14)。
// ノートの中の引用された所は、見えない目印のリンク [文章](#q-xxxxxxxx) にする(ほかのエディタでも壊れない)。
// ボードの引用の文字は cite: "<ノートID>#q-xxxxxxxx" を持ち、その目印の文章を見せる。
export const ANCHOR_RE = /^q-[a-z0-9]{8}$/;

export function newAnchor(): string {
  let s = "q-";
  for (let i = 0; i < 8; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
  return s;
}

/** 「ノートID#q-目印」か「ノートID」だけ(目印を付けられなかったとき。anchor は "") */
export function parseCite(s: string | undefined): { note: string; anchor: string } | null {
  const m = /^([a-z0-9]{10})(?:#(q-[a-z0-9]{8}))?$/.exec(s ?? "");
  return m ? { note: m[1], anchor: m[2] ?? "" } : null;
}
export const citeOf = (note: string, anchor: string) => `${note}#${anchor}`;

const unescapeMd = (t: string) => t.replace(/\\(.)/g, "$1").replace(/(\*\*|__|\*|_|`)/g, "");

/** 本文の中の、その目印の文章(いくつかに分かれていれば改行でつなぐ)。無ければ null */
export function anchorText(body: string, anchor: string): string | null {
  if (!anchor) return null;
  const re = new RegExp(`\\[((?:\\\\.|[^\\]\\\\])*)\\]\\(#${anchor}\\)`, "g");
  const parts = [...body.matchAll(re)].map((m) => unescapeMd(m[1]));
  return parts.length ? parts.join("\n") : null;
}
