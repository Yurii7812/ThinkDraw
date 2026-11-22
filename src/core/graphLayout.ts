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
  kind: "member" | "ref" | LinkKind;
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
    for (const r of n.refs) if (v.get(r.id)?.type === "group") edges.push({ from: n.id, to: r.id, kind: "ref" });
    for (const l of n.links) if (v.get(l.to)?.type === "group") edges.push({ from: n.id, to: l.to, kind: l.kind });
  }
  return { nodes, edges };
}

/**
 * 「この辺り」表示(2026-11-22 利用者の希望): 今のグループを中心に、
 * 親・子のグループ、引用し合うグループ、線でつながるグループ、中に引用している物(とその所属先)、
 * 中の物から線・本文のリンクで出ている先(とその所属先)を出す。
 * selected があれば、それと、それが所属・引用されているグループも出す。
 */
export function buildLocalGraph(v: Vault, group: string, selected: string | null, emptyLabel: string, max = 60): Graph {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const add = (id: string) => {
    if (nodes.has(id) || nodes.size >= max) return nodes.has(id);
    const n = v.get(id);
    if (!n) return false;
    nodes.set(id, { id, label: shortLabel(n.title, emptyLabel), kind: id === ROOT_ID ? "root" : n.type });
    return true;
  };
  const edge = (from: string, to: string, kind: GEdge["kind"]) => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    const k = `${from}>${to}:${kind}`;
    if (!edges.has(k)) edges.set(k, { from, to, kind });
  };
  const homes = (id: string) => {
    for (const p of v.parentsOf(id)) if (add(p)) edge(p, id, "member");
  };
  const quoters = (id: string) => {
    for (const q of v.quotedBy(id)) if (add(q)) edge(q, id, "ref");
  };
  add(group);
  homes(group);
  quoters(group);
  const g = v.get(group);
  for (const m of v.membersOf(group)) if (v.get(m.id)?.type === "group" && add(m.id)) edge(group, m.id, "member");
  for (const r of v.refsOf(group)) if (add(r.id)) {
    edge(group, r.id, "ref");
    homes(r.id);
  }
  for (const l of g?.links ?? []) if (add(l.to)) edge(group, l.to, l.kind);
  for (const s of v.backlinksOf(group)) if (add(s)) edge(s, group, "line");
  // 中の物から外へのリンク
  const inside = new Set(v.itemsOf(group).map((i) => i.id));
  for (const id of inside) {
    const n = v.get(id)!;
    for (const t of v.index.outlinksOf(id)) {
      if (inside.has(t) || !v.exists(t)) continue;
      if (add(t)) {
        if (!nodes.has(id)) add(id);
        const kind = n.links.find((l) => l.to === t)?.kind ?? "line";
        edge(id, t, kind);
        if (!v.memberPos(group, id)) homes(id);
        else edge(group, id, "member");
        homes(t);
      }
    }
  }
  if (selected && v.exists(selected) && add(selected)) {
    homes(selected);
    quoters(selected);
    if (v.memberPos(group, selected)) edge(group, selected, "member");
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
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
  // 段を決めるのは所属の線。所属の線があるときは、引用とリンクは配置に使わず、後から直線で描く
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
