// ほかのアプリと共有しやすい書き出し・読み込み(2026-11-27 利用者。質問票 br-1127b で形は私に任された)
// - JSON Canvas(.canvas): Obsidian のキャンバスの公開された形式。位置・大きさ・色・線・線の言葉・囲いをそのまま持てる
// - 網の箇条書き: bresuto の貼り付け(Ctrl+Q)と同じ書き方。字下げの木に、何度も出る物は「文 (n)」の番号。AI にも読み書きしやすい
// - OPML: アウトライナー(Workflowy・Dynalist・Logseq など)向け。木だけ(網の線は入らない)
import { labelOf } from "./export";
import type { Rect } from "./placement";
import { LINK_KINDS, ROOT_ID, type LinkKind, type Stroke, type TDNode } from "./types";
import type { Vault } from "./vault";

interface Item {
  id: string;
  n: TDNode;
  r: Rect;
}
function itemsOf(v: Vault, group: string, rectOf: (id: string) => Rect | undefined, only?: Set<string>): Item[] {
  const out: Item[] = [];
  for (const i of v.itemsOf(group)) {
    if (only && !only.has(i.id)) continue;
    const n0 = v.get(i.id);
    if (!n0) continue;
    const n = n0.type === "alias" && n0.target && v.get(n0.target) ? v.get(n0.target)! : n0;
    const r = rectOf(i.id) ?? { x: i.x, y: i.y, w: 160, h: 40 };
    out.push({ id: i.id, n, r });
  }
  return out.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
}

// ---------- JSON Canvas ----------
/** bresuto の色(1〜8)→ JSON Canvas のいつもの色(1 赤・2 橙・3 黄・4 緑・5 水色・6 紫) */
const CANVAS_COLOR = ["", "1", "2", "3", "4", "5", "6", "6", "1"];

export function toJsonCanvas(v: Vault, group: string, rectOf: (id: string) => Rect | undefined, only?: Set<string>): string {
  const items = itemsOf(v, group, rectOf, only);
  const here = new Set(items.map((i) => i.id));
  const nodes: Record<string, unknown>[] = [];
  // 囲いは一番下(先に書く)
  for (const it of [...items].sort((a, b) => Number(b.n.type === "frame") - Number(a.n.type === "frame"))) {
    const { n, r } = it;
    const base: Record<string, unknown> = { id: it.id, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) };
    if (n.color && CANVAS_COLOR[n.color]) base.color = CANVAS_COLOR[n.color];
    if (n.type === "frame") nodes.push({ ...base, type: "group", ...(n.title ? { label: n.title } : {}) });
    else if (n.type === "note" || n.type === "group") nodes.push({ ...base, type: "file", file: `${n.id === ROOT_ID ? "root" : n.id}.md` }); // vault を Obsidian で開くと、そのノート・ボードの .md を指す
    else if (n.type === "text" && n.file) nodes.push({ ...base, type: "file", file: n.file });
    else nodes.push({ ...base, type: "text", text: labelOf(n).length && n.title.includes("\n") ? n.title : labelOf(n) });
  }
  const edges: Record<string, unknown>[] = [];
  const connections = Object.create(null) as Record<string, { kind: LinkKind; color?: number; at?: number; size?: number }>;
  for (const it of items) {
    for (const l of v.get(it.id)?.links ?? []) {
      if (!here.has(l.to)) continue;
      const id = `${it.id}-${l.to}`;
      const e: Record<string, unknown> = { id, fromNode: it.id, toNode: l.to, ...endsOf(l.kind) };
      connections[id] = { kind: l.kind, color: l.color, at: l.at, size: l.size };
      if (l.label) e.label = l.label;
      if (l.color && CANVAS_COLOR[l.color]) e.color = CANVAS_COLOR[l.color];
      edges.push(e);
    }
  }
  const annotations = Object.fromEntries(items.map(({ id, n }) => {
    const byName = typeof n.extra.byName === "string" ? n.extra.byName : undefined;
    const byColor = typeof n.extra.byColor === "string" ? n.extra.byColor : undefined;
    const title = n.type === "note" || n.type === "group" || n.file ? n.title : undefined;
    return [id, { color: n.color, fill: n.fill, title, byName, byColor }];
  }));
  // JSON Canvas が共通に持てない属性は、BRESUTO に戻すための拡張に置く。
  const bresuto = { version: 1, annotations, connections, strokes: only ? [] : v.strokesOf(group) };
  return JSON.stringify({ nodes, edges, bresuto }, null, "\t") + "\n";
}
function endsOf(kind: LinkKind): { fromEnd?: string; toEnd: string } {
  if (kind === "arrow") return { toEnd: "arrow" };
  if (kind === "double") return { fromEnd: "arrow", toEnd: "arrow" };
  return { toEnd: "none" };
}

export interface CanvasImport {
  nodes: { key: string; kind: "text" | "frame"; title: string; x: number; y: number; w: number; h: number; color: number; fill?: number; byName?: string; byColor?: string }[];
  edges: { from: string; to: string; label?: string; kind: LinkKind; color?: number; at?: number; size?: number }[];
  strokes: Omit<Stroke, "id">[];
}
/** .canvas を読む。位置は左上を (0,0) にそろえる */
export function fromJsonCanvas(src: string): CanvasImport {
  interface Extension {
    version?: number;
    annotations?: Record<string, { color?: number; fill?: number; title?: string; byName?: string; byColor?: string }>;
    connections?: Record<string, { kind?: LinkKind; color?: number; at?: number; size?: number }>;
    strokes?: Omit<Stroke, "id">[];
  }
  const j = JSON.parse(src) as { nodes?: Record<string, unknown>[]; edges?: Record<string, unknown>[]; bresuto?: Extension };
  const ext = j.bresuto?.version === 1 ? j.bresuto : undefined;
  const bounded = (n: unknown, min: number, max: number): number | undefined =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  const palette = (n: unknown) => typeof n === "number" && Number.isInteger(n) ? bounded(n, 0, 8) : undefined;
  const color = (c: unknown) => {
    const k = CANVAS_COLOR.indexOf(String(c ?? ""));
    return k > 0 ? k : 0;
  };
  const raw = (j.nodes ?? []).filter((n) => typeof n.id === "string");
  const x0 = Math.min(0, ...raw.map((n) => Number(n.x) || 0)), y0 = Math.min(0, ...raw.map((n) => Number(n.y) || 0));
  const nodes = raw.map((n) => {
    const t = String(n.type ?? "text");
    const a = ext?.annotations?.[String(n.id)];
    const title = t === "text" ? String(n.text ?? "") : t === "file"
      ? (typeof a?.title === "string" ? a.title : String(n.file ?? "").replace(/^.*\//, "").replace(/\.md$/, ""))
      : t === "link" ? String(n.url ?? "") : String(n.label ?? "");
    return { key: String(n.id), kind: (t === "group" ? "frame" : "text") as "text" | "frame", title: title.trim(), x: (Number(n.x) || 0) - x0, y: (Number(n.y) || 0) - y0, w: Number(n.width) || 160, h: Number(n.height) || 60,
      color: palette(a?.color) ?? color(n.color), fill: palette(a?.fill),
      byName: typeof a?.byName === "string" ? a.byName.slice(0, 80) : undefined,
      byColor: typeof a?.byColor === "string" && /^#[a-f\d]{6}$/i.test(a.byColor) ? a.byColor : undefined };
  });
  const keys = new Set(nodes.map((n) => n.key));
  const edges = (j.edges ?? [])
    .filter((e) => keys.has(String(e.fromNode)) && keys.has(String(e.toNode)))
    .map((e) => {
      const to = String(e.toEnd ?? "arrow"), from = String(e.fromEnd ?? "none");
      const extra = ext?.connections?.[String(e.id)];
      const standardKind: LinkKind = to === "arrow" && from === "arrow" ? "double" : to === "arrow" ? "arrow" : "line";
      const kind = extra?.kind && LINK_KINDS.includes(extra.kind) ? extra.kind : standardKind;
      return { from: String(e.fromNode), to: String(e.toNode), ...(e.label ? { label: String(e.label) } : {}), kind,
        color: palette(extra?.color) ?? color(e.color), at: bounded(extra?.at, 0, 1), size: bounded(extra?.size, 1, 200) };
    });
  const strokes: Omit<Stroke, "id">[] = [];
  if (Array.isArray(ext?.strokes)) for (const s of ext.strokes) {
    const c = palette(s?.c), w = bounded(s?.w, 1, 200);
    if (c === undefined || w === undefined || !Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2 || !s.p.every(Number.isFinite)) continue;
    strokes.push({ c, w, hl: s.hl === true, p: s.p.map((p, i) => p - (i % 2 ? y0 : x0)) });
  }
  return { nodes, edges, strokes };
}

// ---------- 網の箇条書き(bresuto の書き方) ----------
/** 線の木を字下げに。2 回目に出てくる物・輪になる所は番号「(n)」で指す。線の言葉は子の行の頭の「(言葉)」 */
export function toOutlineText(v: Vault, group: string, rectOf: (id: string) => Rect | undefined, only?: Set<string>): string {
  const items = itemsOf(v, group, rectOf, only).filter((i) => i.n.type !== "frame");
  const here = new Set(items.map((i) => i.id));
  const order = new Map(items.map((it, k) => [it.id, k]));
  const out = (id: string) =>
    (v.get(id)?.links ?? []).filter((l) => here.has(l.to) && l.to !== id).sort((a, b) => order.get(a.to)! - order.get(b.to)!);
  const indeg = new Map<string, number>();
  for (const it of items) for (const l of out(it.id)) indeg.set(l.to, (indeg.get(l.to) ?? 0) + 1);
  const roots = items.filter((i) => !indeg.get(i.id)).map((i) => i.id);
  // 1 回目: 木を決めて、2 回目に出てくる物(番号が要る物)を探す
  const placed = new Set<string>();
  const needNum = new Set<string>();
  const plan = (id: string) => {
    placed.add(id);
    for (const l of out(id)) {
      if (placed.has(l.to)) needNum.add(l.to);
      else plan(l.to);
    }
  };
  const starts: string[] = [];
  for (const r of roots) if (!placed.has(r)) (starts.push(r), plan(r));
  for (const it of items) if (!placed.has(it.id)) (starts.push(it.id), plan(it.id)); // 輪だけのもの
  const num = new Map<string, number>();
  let k = 0;
  for (const it of items) if (needNum.has(it.id)) num.set(it.id, ++k);
  // 2 回目: 書く
  const lines: string[] = [];
  const done = new Set<string>();
  // 文の頭のかっこ(線の言葉と読まれる)・終わりのかっこ数字(番号と読まれる)・番号の隣のコロンは、全角にして書く
  const clean = (t: string) =>
    t.replace(/\s+/g, " ").trim().replace(/^\(/, "（").replace(/\((\d{1,4})\)$/, "（$1）").replace(/^(\(\d{1,4}\))\s*:/, "$1：") || "(無題)";
  const write = (id: string, depth: number, label?: string) => {
    done.add(id);
    const n = v.get(id)!;
    const t = clean(labelOf(n));
    lines.push("  ".repeat(depth) + (label ? `(${label})` : "") + t + (num.has(id) ? ` (${num.get(id)})` : ""));
    for (const l of out(id)) {
      if (done.has(l.to)) lines.push("  ".repeat(depth + 1) + (l.label ? `(${l.label})` : "") + `(${num.get(l.to)})`);
      else write(l.to, depth + 1, l.label);
    }
  };
  for (const s of starts) if (!done.has(s)) write(s, 0);
  return lines.join("\n") + (lines.length ? "\n" : "");
}

// ---------- OPML ----------
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 線の木を OPML に(網の 2 回目以降は入れない) */
export function toOpml(v: Vault, group: string, rectOf: (id: string) => Rect | undefined, title: string, only?: Set<string>): string {
  const items = itemsOf(v, group, rectOf, only).filter((i) => i.n.type !== "frame");
  const here = new Set(items.map((i) => i.id));
  const order = new Map(items.map((it, k) => [it.id, k]));
  const out = (id: string) => (v.get(id)?.links ?? []).filter((l) => here.has(l.to) && l.to !== id).sort((a, b) => order.get(a.to)! - order.get(b.to)!);
  const indeg = new Map<string, number>();
  for (const it of items) for (const l of out(it.id)) indeg.set(l.to, (indeg.get(l.to) ?? 0) + 1);
  const done = new Set<string>();
  const body: string[] = [];
  const write = (id: string, depth: number) => {
    done.add(id);
    const kids = out(id).filter((l) => !done.has(l.to));
    const pad = "  ".repeat(depth + 2);
    const text = `text="${xml(labelOf(v.get(id)!))}"`;
    if (!kids.length) return void body.push(`${pad}<outline ${text}/>`);
    body.push(`${pad}<outline ${text}>`);
    for (const l of kids) if (!done.has(l.to)) write(l.to, depth + 1);
    body.push(`${pad}</outline>`);
  };
  for (const it of items) if (!indeg.get(it.id) && !done.has(it.id)) write(it.id, 0);
  for (const it of items) if (!done.has(it.id)) write(it.id, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${xml(title)}</title></head>\n  <body>\n${body.join("\n")}\n  </body>\n</opml>\n`;
}
