// 共有ボード(みんなで使う。2026-11-28 利用者。質問票 br-1128a)の同期。
// 共有ボードは、それぞれの PC の中の小さな vault(ファイルに書かない)の「根」。開いた人の PC のサーバーが中継し、最新の状態を持つ。
// 送る単位は、ノード 1 つ丸ごと(後から来た方が勝つ)と、ボードの中の位置 1 つずつ(別々の物を同時に動かしても消えない)。
// 集まってつけた状態で使う(利用者)ので、つながっていない間の変更を後で合わせることはしない。
import { parseNode, serializeNode } from "./frontmatter";
import { ROOT_ID, type Stroke, type TDNode } from "./types";
import type { Vault } from "./vault";

export type Op =
  | { t: "node"; id: string; md: string }
  | { t: "del"; id: string }
  | { t: "pos"; id: string; x: number; y: number; w?: number }
  | { t: "unpos"; id: string }
  | { t: "strokes"; list: Stroke[] }
  | { t: "title"; title: string };

export interface Person {
  pid: string;
  name: string;
  color: string;
  /** アプリかブラウザか */
  via?: "app" | "web";
}

/** サーバー(と、はじめに受け取る)状態 */
export interface BoardState {
  title: string;
  nodes: Record<string, string>; // id → .md の中身
  pos: Record<string, { x: number; y: number; w?: number }>;
  strokes: Stroke[];
}
export const emptyBoard = (title: string): BoardState => ({ title, nodes: {}, pos: {}, strokes: [] });

/** 状態に操作を入れる(サーバーでも使う) */
export function applyOps(s: BoardState, ops: Op[]): void {
  for (const o of ops) {
    if (o.t === "node") s.nodes[o.id] = o.md;
    else if (o.t === "del") {
      delete s.nodes[o.id];
      delete s.pos[o.id];
    } else if (o.t === "pos") s.pos[o.id] = { x: o.x, y: o.y, ...(o.w ? { w: o.w } : {}) };
    else if (o.t === "unpos") delete s.pos[o.id];
    else if (o.t === "strokes") s.strokes = o.list;
    else if (o.t === "title") s.title = o.title;
  }
}

const posKey = (p: { x: number; y: number; w?: number }) => `${Math.round(p.x)},${Math.round(p.y)},${p.w ?? ""}`;

/**
 * 共有ボードの vault と、サーバーとのあいだ。手元の変更を操作にして send へ。届いた操作を vault に入れる
 */
export class SessionSync {
  private known = new Map<string, string>(); // 最後に送った/受け取ったノードの中身
  private knownPos = new Map<string, string>();
  private knownStrokes = "[]";
  private knownTitle = "";
  private applying = false;
  private unsub: () => void;

  constructor(
    readonly vault: Vault,
    private send: (ops: Op[]) => void,
    /** 手元で新しく作った物に、書いた人を付ける(送る前) */
    private stamp?: (n: TDNode) => void,
  ) {
    this.unsub = vault.onChange((ids) => this.onLocal(ids));
  }
  close(): void {
    this.unsub();
  }

  /** はじめに受け取った状態を、そのまま入れる */
  load(s: BoardState): void {
    const nodes: [string, TDNode | null][] = [];
    for (const [id, md] of Object.entries(s.nodes)) {
      try {
        nodes.push([id, parseNode(md, id)]);
        this.known.set(id, md);
      } catch {
        /* 壊れた物は入れない */
      }
    }
    const pos: [string, { x: number; y: number; w?: number } | null][] = Object.entries(s.pos);
    for (const [id, p] of pos) this.knownPos.set(id, posKey(p!));
    this.knownStrokes = JSON.stringify(s.strokes);
    this.knownTitle = s.title;
    this.applying = true;
    try {
      this.vault.applyRemote({ nodes, pos, strokes: s.strokes, title: s.title });
    } finally {
      this.applying = false;
    }
  }

  /** ほかの人の操作 */
  receive(ops: Op[]): void {
    const nodes: [string, TDNode | null][] = [];
    const pos: [string, { x: number; y: number; w?: number } | null][] = [];
    let strokes: Stroke[] | undefined;
    let title: string | undefined;
    for (const o of ops) {
      if (o.t === "node") {
        try {
          nodes.push([o.id, parseNode(o.md, o.id)]);
          this.known.set(o.id, o.md);
        } catch {
          /* 入れない */
        }
      } else if (o.t === "del") {
        nodes.push([o.id, null]);
        pos.push([o.id, null]);
        this.known.delete(o.id);
        this.knownPos.delete(o.id);
      } else if (o.t === "pos") {
        pos.push([o.id, { x: o.x, y: o.y, w: o.w }]);
        this.knownPos.set(o.id, posKey(o));
      } else if (o.t === "unpos") {
        pos.push([o.id, null]);
        this.knownPos.delete(o.id);
      } else if (o.t === "strokes") {
        strokes = o.list;
        this.knownStrokes = JSON.stringify(o.list);
      } else if (o.t === "title") {
        title = o.title;
        this.knownTitle = o.title;
      }
    }
    this.applying = true;
    try {
      this.vault.applyRemote({ nodes, pos, strokes, title });
    } finally {
      this.applying = false;
    }
  }

  private onLocal(ids: Set<string>): void {
    if (this.applying) return;
    const ops: Op[] = [];
    for (const id of ids) {
      if (id === ROOT_ID) continue;
      const n = this.vault.get(id);
      if (!n) {
        if (this.known.has(id)) {
          this.known.delete(id);
          ops.push({ t: "del", id });
        }
        continue;
      }
      if (!this.known.has(id)) this.stamp?.(n);
      const md = serializeNode(n);
      if (this.known.get(id) === md) continue;
      this.known.set(id, md);
      ops.push({ t: "node", id, md });
    }
    if (ids.has(ROOT_ID)) {
      const root = this.vault.get(ROOT_ID)!;
      const now = new Set<string>();
      for (const m of root.members) {
        now.add(m.id);
        const k = posKey(m);
        if (this.knownPos.get(m.id) === k) continue;
        this.knownPos.set(m.id, k);
        ops.push({ t: "pos", id: m.id, x: m.x, y: m.y, ...(m.w ? { w: m.w } : {}) });
      }
      for (const id of [...this.knownPos.keys()]) {
        if (now.has(id)) continue;
        this.knownPos.delete(id);
        ops.push({ t: "unpos", id });
      }
      const st = JSON.stringify(root.strokes);
      if (st !== this.knownStrokes) {
        this.knownStrokes = st;
        ops.push({ t: "strokes", list: root.strokes });
      }
      if (root.title !== this.knownTitle) {
        this.knownTitle = root.title;
        ops.push({ t: "title", title: root.title });
      }
    }
    // ノードを先に(位置が先に届くと、まだ無い物の位置になる)
    ops.sort((a, b) => Number(a.t !== "node") - Number(b.t !== "node"));
    if (ops.length) this.send(ops);
  }
}

/** 手元の共有ボードの vault を、状態にする(抜けるときに保存する分) */
export function boardOf(v: Vault): BoardState {
  const root = v.root();
  const s = emptyBoard(root.title);
  for (const m of root.members) {
    const n = v.get(m.id);
    if (!n) continue;
    s.nodes[m.id] = serializeNode(n);
    s.pos[m.id] = { x: m.x, y: m.y, ...(m.w ? { w: m.w } : {}) };
  }
  s.strokes = root.strokes.map((x) => ({ ...x, p: [...x.p] }));
  return s;
}

/** 書いた人(ノードの extra.by に、その人の pid) */
export const authorOf = (n: TDNode | undefined): string | null => (n && typeof n.extra.by === "string" ? n.extra.by : null);
