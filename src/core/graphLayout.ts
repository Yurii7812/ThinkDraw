// グラフビューの静止レイアウト(SPEC 第 5 章)。
// データから位置を決定論的に計算する: 入力を題・ID の順に並べてから dagre(層状のレイアウト)に渡す。

import dagre from "@dagrejs/dagre";
import { ROOT_ID, type LinkKind, type NodeType } from "./types";
import type { Vault } from "./vault";

export type GKind = "root" | NodeType;
export interface GNode {
  id: string;
  label: string;
  kind: GKind;
}
export interface GEdge {
  from: string;
  to: string;
  kind: "member" | LinkKind;
}
export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}
export interface PlacedNode extends GNode {
  x: number; // 中心
  y: number;
  w: number;
  h: number;
}
export interface Layout {
  key: string;
  nodes: PlacedNode[];
  edges: GEdge[];
  width: number;
  height: number;
}

const LABEL_MAX = 14;
export function shortLabel(s: string, empty: string): string {
  const t = s.trim().replace(/\s+/g, " ") || empty;
  return [...t].length > LABEL_MAX ? [...t].slice(0, LABEL_MAX - 1).join("") + "…" : t;
}
/** 文字の幅は推定する(画面のフォントに依存させず、決定論的にするため) */
function labelWidth(label: string): number {
  let w = 0;
  for (const ch of label) w += /[\u0000-ÿ]/.test(ch) ? 7.5 : 13;
  return Math.max(48, Math.round(w + 24));
}

function cmpNode(a: GNode, b: GNode): number {
  if (a.id === ROOT_ID) return -1;
  if (b.id === ROOT_ID) return 1;
  return a.label.localeCompare(b.label, "ja") || a.id.localeCompare(b.id);
}

/** グループ表示: 丸 = グループ(根を含む)。線 = 所属(親→子)と、グループ同士のリンク */
export function buildGroupGraph(v: Vault, emptyLabel: string): Graph {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  for (const n of v.nodes.values()) {
    if (n.type !== "group") continue;
    nodes.push({ id: n.id, label: shortLabel(n.title, emptyLabel), kind: n.id === ROOT_ID ? "root" : "group" });
    for (const m of n.members) if (v.get(m.id)?.type === "group") edges.push({ from: n.id, to: m.id, kind: "member" });
    for (const l of n.links) if (v.get(l.to)?.type === "group") edges.push({ from: n.id, to: l.to, kind: l.kind });
  }
  return { nodes, edges };
}

/** ノード表示: 丸 = グループ以外のノード。線 = リンクだけ。範囲 = 今のグループの中身 + リンクで 1 歩 */
export function buildNodeGraph(v: Vault, group: string, emptyLabel: string): Graph {
  const isLeaf = (id: string) => {
    const n = v.get(id);
    return !!n && n.type !== "group";
  };
  const set = new Set<string>();
  for (const m of v.membersOf(group)) if (isLeaf(m.id)) set.add(m.id);
  for (const id of [...set]) {
    for (const t of v.index.outlinksOf(id)) if (isLeaf(t)) set.add(t);
    for (const s of v.backlinksOf(id)) if (isLeaf(s)) set.add(s);
  }
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  for (const id of set) {
    const n = v.get(id)!;
    nodes.push({ id, label: shortLabel(n.title, emptyLabel), kind: n.type });
    for (const l of n.links) if (set.has(l.to)) edges.push({ from: id, to: l.to, kind: l.kind });
    // 本文のリンクは "line" として描く
    for (const t of v.index.outlinksOf(id))
      if (set.has(t) && !n.links.some((l) => l.to === t)) edges.push({ from: id, to: t, kind: "line" });
  }
  return { nodes, edges };
}

/** 構造が同じなら同じ値。保存した配置を使い回すかどうかの判定に使う */
export function graphKey(g: Graph): string {
  const ns = [...g.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((n) => `${n.id}:${n.kind}:${n.label}`);
  const es = g.edges.map((e) => `${e.from}>${e.to}:${e.kind}`).sort();
  // 短い決定論的なハッシュ(FNV-1a)
  let h = 0x811c9dc5;
  for (const ch of ns.join("|") + "#" + es.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${g.nodes.length}-${g.edges.length}-${h.toString(36)}`;
}

export function layoutGraph(g: Graph): Layout {
  const dg = new dagre.graphlib.Graph({ multigraph: true });
  dg.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 56, marginx: 20, marginy: 20, acyclicer: "greedy", ranker: "network-simplex" });
  dg.setDefaultEdgeLabel(() => ({}));
  const nodes = [...g.nodes].sort(cmpNode);
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) dg.setNode(n.id, { width: labelWidth(n.label), height: 30 });
  const edges = g.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .sort((a, b) => (a.from + a.to + a.kind < b.from + b.to + b.kind ? -1 : 1));
  // 段を決めるのは所属の線。所属の線があるとき(グループ表示)は、リンクは配置に使わず、後から直線で描く
  const hasMember = edges.some((e) => e.kind === "member");
  edges.forEach((e, i) => {
    if (hasMember && e.kind !== "member") return;
    dg.setEdge(e.from, e.to, { minlen: 1, weight: 1 }, `e${i}`);
  });
  dagre.layout(dg);
  const placed: PlacedNode[] = nodes.map((n) => {
    const p = dg.node(n.id);
    return { ...n, x: Math.round(p.x), y: Math.round(p.y), w: p.width, h: p.height };
  });
  const gr = dg.graph();
  return { key: graphKey(g), nodes: placed, edges, width: Math.round(gr.width ?? 0), height: Math.round(gr.height ?? 0) };
}
