// 全体の画面(見るだけ。2026-11-23 利用者と決めた「ふつうのマインドマップが広がった形」・どこまでも広がる):
// 今のグループを根にして、所属・引用・線でつながるものを、たどれる限り全部たどり、1 枚のマインドマップとして放射状に並べる。
// - グループは「枝の分かれ目」(フォルダの札)。その中の物は、グループの中の線の木のとおりに枝分かれする。
// - 上のグループ(所属先)も、根から外への枝として出る。
// - ほかのグループの物と線でつながっていれば、その物のグループが、線でつないだノードの先に枝として出る(青い点線)。
// - 同じノードは 1 か所にだけ出し、木に使わなかったつながりは青い点線で結ぶ。
// 編集はできない。ノードを左の画面へドラッグすると引用として入る。ダブルクリックでそのグループを左の画面で開く。
import { cardName } from "../decks";
import { ROOT_ID } from "../core/types";
import type { Vault } from "../core/vault";
import { T } from "./strings";
import { h, svg } from "./ui";

export interface WholeHost {
  vault: Vault;
  /** そのグループを左の画面で開く(focus があればそのノードを見せる) */
  open(group: string, focus?: string): void;
  /** 全体の画面の外へ落とした。受け取ったら true */
  dropOut(id: string, cx: number, cy: number): boolean;
}

/** 木の辺の種類: 中(グループ→中の物・中の線)/上(グループ→所属先)/つながり(ほかのグループへ) */
type EdgeKind = "in" | "up" | "cross";
interface V {
  id: string;
  ctx: string; // どのグループの中としてたどったか
  parent: V | null;
  kind: EdgeKind;
  children: V[];
  depth: number;
  leaves: number;
  branch: number; // 根から出た枝の番号(色分け)
  x: number;
  y: number;
}

const MAX_NODES = 3000; // 描く数の上限(重くならないように)
const RING = 200; // 1 段の距離

export class WholeView {
  readonly el: HTMLElement;
  private world: HTMLElement;
  private edges: SVGSVGElement;
  private nodesLayer: HTMLElement;
  private view = { x: 0, y: 0, z: 1 };
  private center = ROOT_ID;
  private verts = new Map<string, V>();
  private more = 0;
  private drag:
    | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
    | { kind: "node"; id: string; sx: number; sy: number; ghost: HTMLElement | null }
    | null = null;

  constructor(private host: WholeHost) {
    this.world = h("div", { class: "wh-world" });
    this.edges = svg("svg", { class: "wh-edges" });
    this.nodesLayer = h("div", { class: "wh-nodes" });
    this.world.append(this.edges, this.nodesLayer);
    this.el = h("div", { class: "whole", tabindex: "0" }, this.world);
    this.bind();
  }

  private get v(): Vault {
    return this.host.vault;
  }

  setCenter(g: string): void {
    const changed = g !== this.center;
    this.center = g;
    this.render();
    if (changed) this.fit();
  }

  // ---------- たどる(幅優先・同じノードは 1 回だけ) ----------
  private build(): V {
    const v = this.v;
    this.verts.clear();
    this.more = 0;
    const root: V = { id: this.center, ctx: this.center, parent: null, kind: "in", children: [], depth: 0, leaves: 0, branch: 0, x: 0, y: 0 };
    this.verts.set(root.id, root);
    const queue: V[] = [root];
    const add = (p: V, id: string, ctx: string, kind: EdgeKind) => {
      if (this.verts.has(id) || !v.exists(id)) return;
      if (this.verts.size >= MAX_NODES) {
        this.more++;
        return;
      }
      const c: V = { id, ctx, parent: p, kind, children: [], depth: p.depth + 1, leaves: 0, branch: p.parent ? p.branch : p.children.length % 8, x: 0, y: 0 };
      this.verts.set(id, c);
      p.children.push(c);
      queue.push(c);
    };
    const isGroup = (id: string) => id === ROOT_ID || v.get(id)?.type === "group";
    const groups: V[] = [];
    for (;;) {
      if (!queue.length) {
        // 線が輪になっていて根の無い物は、たどり終わってから、そのグループに直接つなぐ
        for (const g of groups) for (const i of v.itemsOf(g.id)) add(g, i.id, g.id, "in");
        if (!queue.length) break;
      }
      const p = queue.shift()!;
      if (isGroup(p.id)) groups.push(p);
      if (isGroup(p.id)) {
        // 中の物: グループの中の線の木の根(中のほかの物から線が来ていないもの)を、上から順に
        const items = v.itemsOf(p.id).filter((i) => v.exists(i.id));
        const inside = new Set(items.map((i) => i.id));
        const pointed = new Set<string>();
        for (const i of items) for (const l of v.get(i.id)!.links) if (inside.has(l.to) && l.to !== i.id) pointed.add(l.to);
        const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
        for (const i of order) if (!pointed.has(i.id)) add(p, i.id, p.id, "in");
        // 上のグループ(所属先・引用している所)
        for (const g of [...v.parentsOf(p.id), ...v.quotedBy(p.id)]) add(p, g, g, "up");
      } else {
        const n = v.get(p.id)!;
        const inside = new Set(v.itemsOf(p.ctx).map((i) => i.id));
        // 同じグループの中で線の先 → 子。ほかのグループの物 → そのグループを枝として
        const targets = [...n.links.map((l) => l.to), ...v.backlinksOf(p.id)];
        for (const t of targets) {
          if (inside.has(t)) add(p, t, p.ctx, "in");
          else for (const g of v.parentsOf(t)) add(p, g, g, "cross");
        }
        // この物のほかの所属先・引用元
        for (const g of [...v.parentsOf(p.id), ...v.quotedBy(p.id)]) if (g !== p.ctx) add(p, g, g, "cross");
      }
    }
    return root;
  }

  // ---------- 並べる(放射状の木。葉の数に応じて角度を分ける) ----------
  private layout(root: V): void {
    const count = (n: V): number => (n.leaves = n.children.length ? n.children.reduce((s, c) => s + count(c), 0) : 1);
    count(root);
    let maxDepth = 0;
    for (const n of this.verts.values()) maxDepth = Math.max(maxDepth, n.depth);
    // 外の輪ほど広く: 葉が多いときは輪の間を広げて、文字が重ならないように
    const ring = Math.max(RING, (root.leaves * 46) / (2 * Math.PI * Math.max(1, maxDepth)));
    const place = (n: V, a0: number, a1: number) => {
      const a = (a0 + a1) / 2;
      const r = n.depth * ring;
      n.x = Math.cos(a) * r;
      n.y = Math.sin(a) * r;
      let cur = a0;
      for (const c of n.children) {
        const span = ((a1 - a0) * c.leaves) / Math.max(1, n.leaves);
        place(c, cur, cur + span);
        cur += span;
      }
    };
    // 根の枝は「中 → 上 → つながり」の順に並べ、上のグループのかたまりが真上に来るように回す
    const rank = { in: 0, up: 1, cross: 2 } as const;
    root.children.sort((a, b) => rank[a.kind] - rank[b.kind]);
    let before = 0, up = 0;
    for (const c of root.children) {
      if (c.kind === "up") up += c.leaves;
      else if (c.kind === "in") before += c.leaves;
    }
    const L = Math.max(1, root.leaves);
    const a0 = up ? -Math.PI / 2 - (2 * Math.PI * (before + up / 2)) / L : -Math.PI / 2 - Math.PI;
    place(root, a0, a0 + 2 * Math.PI);
  }

  // ---------- 描く ----------
  render(): void {
    if (!this.v.exists(this.center)) this.center = ROOT_ID;
    const root = this.build();
    this.layout(root);
    this.nodesLayer.replaceChildren();
    this.edges.replaceChildren();
    const v = this.v;
    // 木の辺: 親から外へ、ゆるい曲線で(マインドマップの枝のように)。根から出た枝ごとに色を変える
    for (const n of this.verts.values()) {
      const p = n.parent;
      if (!p) continue;
      const pr = Math.hypot(p.x, p.y), nr = Math.hypot(n.x, n.y);
      const mid = (pr + nr) / 2;
      const ang = Math.atan2(n.y, n.x);
      const c1 = pr ? { x: (p.x / pr) * mid, y: (p.y / pr) * mid } : p;
      const c2 = { x: Math.cos(ang) * mid, y: Math.sin(ang) * mid };
      this.edges.append(svg("path", { d: `M${p.x},${p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${n.x},${n.y}`, class: `wh-edge k-${n.kind} b${n.branch}` }));
    }
    // 木に使わなかった線(両方見えているもの)
    for (const n of this.verts.values()) {
      const node = v.get(n.id);
      if (!node) continue;
      for (const l of node.links) {
        const t = this.verts.get(l.to);
        if (!t || t.parent === n || n.parent === t) continue;
        this.edges.append(svg("line", { x1: n.x, y1: n.y, x2: t.x, y2: t.y, class: "wh-edge k-extra" }));
      }
    }
    // ノード
    for (const n of this.verts.values()) {
      const isRoot = !n.parent;
      const node = v.get(n.id);
      const group = n.id === ROOT_ID || node?.type === "group";
      const el = h("div", { class: "wh-node" + (group ? " grp" : "") + (isRoot ? " root" : "") + (node?.type === "note" ? " note" : "") + (isRoot ? "" : ` b${n.branch}`) + (n.depth >= 4 ? " far-d" : ""), "data-id": n.id, "data-ctx": n.ctx });
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      if (group) {
        el.append(h("span", { class: "ico ico-folder" }), h("span", { class: "wh-label", text: n.id === ROOT_ID ? T.home : node?.title || T.untitledGroup }));
        if (!isRoot && n.kind !== "in") el.append(h("span", { class: "wh-tag", text: n.kind === "up" ? T.wholeRole.parent : T.wholeRole.related }));
      } else {
        if (node?.type === "note") el.append(h("span", { class: "ico ico-note" }));
        const t = node?.card ? cardName(node.card) : node?.title || T.untitled;
        el.append(h("span", { class: "wh-label", text: [...t].length > 40 ? [...t].slice(0, 40).join("") + "…" : t }));
      }
      this.nodesLayer.append(el);
    }
    if (this.more) this.nodesLayer.append(Object.assign(h("div", { class: "wh-node more", text: T.wholeMore(this.more) }), {}));
    this.applyView();
  }

  // ---------- 見る位置 ----------
  private applyView(): void {
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.z})`;
    // とても小さくしたときは、グループの札だけ出す
    this.el.classList.toggle("far", this.view.z < 0.32);
  }
  fit(): void {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !this.verts.size) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.verts.values()) (x0 = Math.min(x0, n.x)), (y0 = Math.min(y0, n.y)), (x1 = Math.max(x1, n.x)), (y1 = Math.max(y1, n.y));
    const w = x1 - x0 + 240, hh = y1 - y0 + 120;
    const z = Math.min(1, Math.max(0.05, Math.min(r.width / w, r.height / hh)));
    this.view = { z, x: r.width / 2 - ((x0 + x1) / 2) * z, y: r.height / 2 - ((y0 + y1) / 2) * z };
    this.applyView();
  }

  // ---------- 操作(見る・ドラッグで左へ・ダブルクリックで開く) ----------
  private bind(): void {
    const el = this.el;
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
          const r = el.getBoundingClientRect();
          const px = e.clientX - r.left, py = e.clientY - r.top;
          const z = Math.min(3, Math.max(0.03, this.view.z * Math.exp(-e.deltaY * 0.0015)));
          const k = z / this.view.z;
          this.view = { x: px - (px - this.view.x) * k, y: py - (py - this.view.y) * k, z };
        } else this.view = { ...this.view, x: this.view.x - e.deltaX, y: this.view.y - e.deltaY };
        this.applyView();
      },
      { passive: false },
    );
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      el.focus({ preventScroll: true });
      const node = (e.target as Element).closest<HTMLElement>(".wh-node");
      if (node?.dataset.id && e.button === 0) this.drag = { kind: "node", id: node.dataset.id, sx: e.clientX, sy: e.clientY, ghost: null };
      else this.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
    });
    addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d) return;
      if (d.kind === "pan") {
        this.view = { ...this.view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy };
        this.applyView();
        el.classList.add("panning");
        return;
      }
      if (!d.ghost && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      if (!d.ghost) {
        const n = this.v.get(d.id);
        d.ghost = h("div", { class: "wh-ghost", text: n ? (n.card ? cardName(n.card) : n.title || T.untitled) : "" });
        document.body.append(d.ghost);
      }
      d.ghost.style.left = e.clientX + 8 + "px";
      d.ghost.style.top = e.clientY + 8 + "px";
    });
    addEventListener("pointerup", (e) => {
      const d = this.drag;
      this.drag = null;
      el.classList.remove("panning");
      if (!d || d.kind !== "node") return;
      if (d.ghost) {
        d.ghost.remove();
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.host.dropOut(d.id, e.clientX, e.clientY);
        return;
      }
      this.select(d.id);
    });
    el.addEventListener("dblclick", (e) => {
      const node = (e.target as Element).closest<HTMLElement>(".wh-node");
      if (!node?.dataset.id) return;
      const id = node.dataset.id;
      const isGroup = id === ROOT_ID || this.v.get(id)?.type === "group";
      if (isGroup) this.host.open(id);
      else this.host.open(node.dataset.ctx!, id);
    });
  }

  private select(id: string): void {
    for (const c of this.nodesLayer.querySelectorAll<HTMLElement>(".wh-node")) c.classList.toggle("selected", c.dataset.id === id && !c.classList.contains("selected"));
  }
}
