// 「まわり」(2026-11-23 利用者と決めた): 今のグループのキャンバスはそのままの見た目で真ん中に置き、
// その外側に、つながっている物(リンク先・バックリンク・ほかの所属先・引用している所)を、ふつうのブレストが外へ広がるように並べる。
// - 中の物からつながる外の物は、その中の物の方向へ、中の物の外側の輪に置く。
// - 外の物からさらに線でつながる物は、もう一段外へ(どこまでも。数の上限だけ付ける)。
// - グループ(ほかの所属先・引用している所・今のグループの所属先)は、そこで止める(中身までは広げない)。
import type { Rect } from "../core/placement";
import { ROOT_ID } from "../core/types";
import type { Vault } from "../core/vault";

export interface OuterNode {
  id: string;
  x: number; // 中心
  y: number;
  depth: number; // 1 = すぐ外
  home: string | null; // その物がある(所属している)グループ。ノードの下に小さく出す
}
export interface OuterEdge {
  from: string; // 中の物の ID、または外の物の ID、または "" = グループそのもの(枠の上の真ん中から)
  fromInner: boolean;
  to: string;
  kind: "link" | "member"; // 線でつながる / 所属・引用
}

const MAX_OUTER = 400;
const STEP = 190; // 一段の距離

interface T {
  id: string;
  parent: T | null;
  anchor: string; // 中の物(または "")
  kind: "link" | "member";
  depth: number;
  children: T[];
  leaves: number;
  x: number;
  y: number;
}

export function computeSurround(v: Vault, group: string, rects: Map<string, Rect>): { nodes: OuterNode[]; edges: OuterEdge[]; box: Rect } {
  const inner = new Set(rects.keys());
  // 中の物が全部入る箱
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects.values()) (x0 = Math.min(x0, r.x)), (y0 = Math.min(y0, r.y)), (x1 = Math.max(x1, r.x + r.w)), (y1 = Math.max(y1, r.y + r.h));
  if (!isFinite(x0)) (x0 = y0 = -100), (x1 = y1 = 100);
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const R0 = Math.hypot((x1 - x0) / 2, (y1 - y0) / 2) + 150;

  const seen = new Set<string>([group, ...inner]);
  const anchors = new Map<string, T>(); // 中の物ごとの根
  const anchorOf = (a: string): T => {
    let t = anchors.get(a);
    if (!t) {
      const r = rects.get(a);
      t = { id: a, parent: null, anchor: a, kind: "link", depth: 0, children: [], leaves: 0, x: r ? r.x + r.w / 2 : cx, y: r ? r.y : y0 };
      anchors.set(a, t);
    }
    return t;
  };
  const queue: T[] = [];
  let count = 0;
  const add = (p: T, id: string, kind: "link" | "member") => {
    if (seen.has(id) || !v.exists(id) || count >= MAX_OUTER) return;
    seen.add(id);
    count++;
    const t: T = { id, parent: p, anchor: p.anchor, kind, depth: p.depth + 1, children: [], leaves: 0, x: 0, y: 0 };
    p.children.push(t);
    queue.push(t);
  };
  const isGroup = (id: string) => id === ROOT_ID || v.get(id)?.type === "group";
  const neighbors = (id: string) => {
    const n = v.get(id);
    return n ? [...n.links.map((l) => l.to), ...v.backlinksOf(id)] : [];
  };
  // 今のグループ自身の所属先・引用している所(枠の上から)
  const top = anchorOf("");
  for (const g of [...v.parentsOf(group), ...v.quotedBy(group)]) add(top, g, "member");
  // 中の物から
  for (const a of inner) {
    const t = anchorOf(a);
    for (const o of neighbors(a)) if (!inner.has(o)) add(t, o, "link");
    for (const g of [...v.parentsOf(a), ...v.quotedBy(a)]) if (g !== group) add(t, g, "member");
  }
  while (queue.length) {
    const p = queue.shift()!;
    if (isGroup(p.id)) continue; // グループで止める
    for (const o of neighbors(p.id)) if (!inner.has(o)) add(p, o, "link");
  }

  // 並べる: 中の物の方向ごとに扇の幅を、その先の数に応じて分け、外へ一段ずつ
  const roots = [...anchors.values()].filter((t) => t.children.length);
  const leaves = (t: T): number => (t.leaves = t.children.length ? t.children.reduce((s, c) => s + leaves(c), 0) : 1);
  for (const r of roots) leaves(r);
  const total = roots.reduce((s, r) => s + r.leaves, 0);
  const angleOf = (t: T) => Math.atan2(t.y - cy, t.x - cx);
  roots.sort((a, b) => angleOf(a) - angleOf(b));
  // 外の輪が混むときは、一段の距離を広げる
  let maxDepth = 1;
  const walkD = (t: T) => {
    maxDepth = Math.max(maxDepth, t.depth);
    t.children.forEach(walkD);
  };
  roots.forEach(walkD);
  const ring = Math.max(STEP, (total * 40) / (2 * Math.PI) - R0 / maxDepth);
  const place = (t: T, a0: number, a1: number) => {
    let cur = a0;
    for (const c of t.children) {
      const span = ((a1 - a0) * c.leaves) / Math.max(1, t.leaves);
      const a = cur + span / 2;
      const r = R0 + (c.depth - 1) * ring;
      c.x = cx + Math.cos(a) * r * 1.25; // 横長の文字に合わせて少し横長に
      c.y = cy + Math.sin(a) * r;
      place(c, cur, cur + span);
      cur += span;
    }
  };
  // 扇: 中の物の向きを中心に、幅は数に応じて。順に詰めて、輪を一周させる
  let start = roots.length ? angleOf(roots[0]) - (Math.PI * roots[0].leaves) / Math.max(1, total) : 0;
  for (const r of roots) {
    const w = (2 * Math.PI * r.leaves) / Math.max(1, total);
    place(r, start, start + w);
    start += w;
  }

  const nodes: OuterNode[] = [];
  const edges: OuterEdge[] = [];
  const homeOf = (id: string) => {
    if (isGroup(id)) return null;
    return v.parentsOf(id)[0] ?? null;
  };
  const walk = (t: T) => {
    for (const c of t.children) {
      nodes.push({ id: c.id, x: c.x, y: c.y, depth: c.depth, home: homeOf(c.id) });
      edges.push({ from: t.depth === 0 ? t.anchor : t.id, fromInner: t.depth === 0, to: c.id, kind: c.kind });
      walk(c);
    }
  };
  roots.forEach(walk);
  return { nodes, edges, box };
}
