// 全体の画面(見るだけ。2026-11-23 利用者と決めた):
// 今のグループを真ん中に、上のグループ・下のグループ・引用や線でつながるグループを、まわりに並べて見せる。
// 中に入れたグループも、ここでは中身まで見える。同じノードが複数のグループにあれば、それぞれの所に出す。
// 編集はできない。ノードを左の画面へドラッグすると引用として入る(ノードの上に落とすと線もつなぐ)。
// ダブルクリックで、そのグループを左の画面で開く。
import { cardName } from "../decks";
import { ROOT_ID, type TDNode } from "../core/types";
import type { Vault } from "../core/vault";
import type { Rect } from "../core/placement";
import { T } from "./strings";
import { h, svg } from "./ui";

export interface WholeHost {
  vault: Vault;
  /** そのグループを左の画面で開く(focus があればそのノードを見せる) */
  open(group: string, focus?: string): void;
  /** 全体の画面の外へ落とした。受け取ったら true */
  dropOut(id: string, cx: number, cy: number): boolean;
}

type Role = "center" | "parent" | "child" | "related";
interface Region {
  group: string;
  role: Role;
  items: { id: string; x: number; y: number; ref: boolean }[];
  el: HTMLElement;
  body: HTMLElement;
  box: Rect; // 世界座標での枠
  minX: number;
  minY: number;
}

const MAX_REGIONS = 18;
const MAX_ITEMS = 150;
const PAD = 28;
const GAP = 90;

export class WholeView {
  readonly el: HTMLElement;
  private world: HTMLElement;
  private edges: SVGSVGElement;
  private regions: Region[] = [];
  private view = { x: 0, y: 0, z: 1 };
  private center = ROOT_ID;
  private selected: string | null = null;
  private drag:
    | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
    | { kind: "node"; id: string; sx: number; sy: number; ghost: HTMLElement | null }
    | null = null;

  constructor(private host: WholeHost) {
    this.world = h("div", { class: "wh-world" });
    this.edges = svg("svg", { class: "wh-edges" });
    this.world.append(this.edges);
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

  // ---------- どのグループを出すか ----------
  private pickRegions(): { group: string; role: Role }[] {
    const v = this.v;
    const g = this.center;
    const out: { group: string; role: Role }[] = [{ group: g, role: "center" }];
    const seen = new Set([g]);
    const add = (id: string, role: Role) => {
      if (seen.has(id) || out.length >= MAX_REGIONS) return;
      const n = v.get(id);
      if (id !== ROOT_ID && n?.type !== "group") return;
      seen.add(id);
      out.push({ group: id, role });
    };
    for (const p of v.parentsOf(g)) add(p, "parent");
    for (const q of v.quotedBy(g)) add(q, "parent");
    const items = v.itemsOf(g).filter((i) => v.exists(i.id));
    for (const i of items) if (!i.ref && v.get(i.id)?.type === "group") add(i.id, "child");
    // 引用・ほかの所属・線でつながる相手が入っているグループ
    for (const i of items) {
      const n = v.get(i.id)!;
      const others = [...v.parentsOf(i.id), ...v.quotedBy(i.id)];
      for (const o of others) if (o !== g) add(o, "related");
      for (const t of [...n.links.map((l) => l.to), ...v.backlinksOf(i.id)]) {
        if (!v.exists(t) || items.some((x) => x.id === t)) continue;
        for (const o of v.parentsOf(t)) add(o, "related");
      }
    }
    return out;
  }

  // ---------- 描く ----------
  render(): void {
    if (!this.v.exists(this.center)) this.center = ROOT_ID;
    for (const r of this.regions) r.el.remove();
    this.regions = [];
    for (const { group, role } of this.pickRegions()) this.regions.push(this.buildRegion(group, role));
    this.layout();
    this.drawEdges();
    this.applyView();
  }

  private nodeEl(n: TDNode, ref: boolean): HTMLElement {
    const el = h("div", { class: `node wh-node t-${n.type === "card" ? "text" : n.type}${n.color ? " c" + n.color : ""}${n.fill ? " f" + n.fill : ""}${ref ? " ref" : ""}`, "data-id": n.id });
    if (n.type === "note") el.append(h("div", { class: "note-head" }, h("span", { class: "ico ico-note" }), h("span", { class: "label", text: n.title || T.untitled })));
    else if (n.type === "group") el.append(h("span", { class: "ico ico-folder" }), h("span", { class: "label", text: n.title || T.untitledGroup }));
    else el.append(h("span", { class: "label", text: n.card ? "🂠 " + cardName(n.card) : n.title || T.untitled }));
    return el;
  }

  private buildRegion(group: string, role: Role): Region {
    const v = this.v;
    const items = v.itemsOf(group).filter((i) => v.exists(i.id)).slice(0, MAX_ITEMS);
    const name = group === ROOT_ID ? T.home : v.get(group)?.title || T.untitledGroup;
    const title = h("button", { class: "wh-title", title: T.wholeOpenTip, "data-group": group }, h("span", { class: "wh-role", text: T.wholeRole[role] }), name);
    title.addEventListener("click", () => this.host.open(group));
    const body = h("div", { class: "wh-body" });
    const el = h("div", { class: `wh-region role-${role}`, "data-group": group }, title, body);
    this.world.append(el);
    let minX = Infinity, minY = Infinity;
    for (const i of items) (minX = Math.min(minX, i.x)), (minY = Math.min(minY, i.y));
    if (!isFinite(minX)) minX = minY = 0;
    for (const i of items) {
      const ne = this.nodeEl(v.get(i.id)!, i.ref);
      ne.style.left = i.x - minX + "px";
      ne.style.top = i.y - minY + "px";
      body.append(ne);
    }
    if (!items.length) body.append(h("div", { class: "wh-empty", text: T.wholeEmpty }));
    // 大きさを測る
    let w = 140, hh = 40;
    for (const c of body.children) {
      const e = c as HTMLElement;
      w = Math.max(w, e.offsetLeft + e.offsetWidth);
      hh = Math.max(hh, e.offsetTop + e.offsetHeight);
    }
    body.style.width = w + "px";
    body.style.height = hh + "px";
    return { group, role, items, el, body, box: { x: 0, y: 0, w: w + PAD * 2, h: hh + PAD * 2 + 26 }, minX, minY };
  }

  /** 真ん中・上(上のグループ)・下(下のグループ)・左右(つながるグループ)に並べる */
  private layout(): void {
    const c = this.regions[0];
    c.box.x = -c.box.w / 2;
    c.box.y = -c.box.h / 2;
    const row = (list: Region[], y: (r: Region) => number) => {
      const total = list.reduce((s, r) => s + r.box.w, 0) + GAP * Math.max(0, list.length - 1);
      let x = -total / 2;
      for (const r of list) {
        r.box.x = x;
        r.box.y = y(r);
        x += r.box.w + GAP;
      }
    };
    const parents = this.regions.filter((r) => r.role === "parent");
    const children = this.regions.filter((r) => r.role === "child");
    const related = this.regions.filter((r) => r.role === "related");
    row(parents, (r) => c.box.y - GAP - r.box.h);
    row(children, () => c.box.y + c.box.h + GAP);
    const top = Math.min(c.box.y, ...parents.map((r) => r.box.y));
    const bottom = Math.max(c.box.y + c.box.h, ...children.map((r) => r.box.y + r.box.h));
    const left = Math.min(c.box.x, ...parents.map((r) => r.box.x), ...children.map((r) => r.box.x));
    const right = Math.max(c.box.x + c.box.w, ...parents.map((r) => r.box.x + r.box.w), ...children.map((r) => r.box.x + r.box.w));
    let ly = top, ry = top;
    related.forEach((r, k) => {
      if (k % 2 === 0) {
        r.box.x = right + GAP;
        r.box.y = ry;
        ry += r.box.h + GAP / 2;
      } else {
        r.box.x = left - GAP - r.box.w;
        r.box.y = ly;
        ly += r.box.h + GAP / 2;
      }
    });
    void bottom;
    for (const r of this.regions) {
      r.el.style.left = r.box.x + "px";
      r.el.style.top = r.box.y + "px";
      r.el.style.width = r.box.w + "px";
    }
  }

  /** ノードの、世界座標での箱(同じノードが複数の所にあれば全部) */
  private instances(): Map<string, Rect[]> {
    const m = new Map<string, Rect[]>();
    for (const r of this.regions) {
      for (const c of r.body.querySelectorAll<HTMLElement>(".wh-node")) {
        const id = c.dataset.id!;
        const box = { x: r.box.x + PAD + c.offsetLeft, y: r.box.y + 26 + PAD + c.offsetTop, w: c.offsetWidth, h: c.offsetHeight };
        (m.get(id) ?? m.set(id, []).get(id)!).push(box);
      }
    }
    return m;
  }

  private drawEdges(): void {
    this.edges.replaceChildren();
    const inst = this.instances();
    const center = (b: Rect) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const done = new Set<string>();
    for (const [id, boxes] of inst) {
      for (const l of this.v.get(id)?.links ?? []) {
        const tb = inst.get(l.to);
        if (!tb) continue;
        const key = id + ">" + l.to;
        if (done.has(key)) continue;
        done.add(key);
        // いちばん近い組で 1 本だけ
        let best: [Rect, Rect] | null = null, bd = Infinity;
        for (const a of boxes)
          for (const b of tb) {
            const d = Math.hypot(center(a).x - center(b).x, center(a).y - center(b).y);
            if (d < bd) (bd = d), (best = [a, b]);
          }
        if (!best) continue;
        const p = center(best[0]), q = center(best[1]);
        const cross = !this.sameRegion(best[0], best[1]);
        this.edges.append(svg("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: "wh-edge" + (cross ? " cross" : "") }));
      }
    }
  }
  private sameRegion(a: Rect, b: Rect): boolean {
    return this.regions.some((r) => a.x >= r.box.x && a.x <= r.box.x + r.box.w && b.x >= r.box.x && b.x <= r.box.x + r.box.w && a.y >= r.box.y && a.y <= r.box.y + r.box.h && b.y >= r.box.y && b.y <= r.box.y + r.box.h);
  }

  // ---------- 見る位置 ----------
  private applyView(): void {
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.z})`;
  }
  fit(): void {
    const r = this.el.getBoundingClientRect();
    if (!this.regions.length || !r.width) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const g of this.regions) (x0 = Math.min(x0, g.box.x)), (y0 = Math.min(y0, g.box.y)), (x1 = Math.max(x1, g.box.x + g.box.w)), (y1 = Math.max(y1, g.box.y + g.box.h));
    const z = Math.min(1, Math.max(0.15, Math.min((r.width - 40) / (x1 - x0), (r.height - 40) / (y1 - y0))));
    this.view = { z, x: r.width / 2 - ((x0 + x1) / 2) * z, y: r.height / 2 - ((y0 + y1) / 2) * z };
    this.applyView();
  }

  // ---------- 操作(見る・ドラッグで左へ・ダブルクリックで開く) ----------
  private bind(): void {
    const el = this.el;
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const z = Math.min(3, Math.max(0.08, this.view.z * Math.exp(-e.deltaY * 0.0015)));
        const k = z / this.view.z;
        this.view = { x: px - (px - this.view.x) * k, y: py - (py - this.view.y) * k, z };
      } else this.view = { ...this.view, x: this.view.x - e.deltaX, y: this.view.y - e.deltaY };
      this.applyView();
    }, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      el.focus({ preventScroll: true });
      const node = (e.target as Element).closest<HTMLElement>(".wh-node");
      if (node && e.button === 0) this.drag = { kind: "node", id: node.dataset.id!, sx: e.clientX, sy: e.clientY, ghost: null };
      else if (!(e.target as Element).closest(".wh-title")) this.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
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
        const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (outside) this.host.dropOut(d.id, e.clientX, e.clientY);
        return;
      }
      this.select(d.id);
    });
    el.addEventListener("dblclick", (e) => {
      const node = (e.target as Element).closest<HTMLElement>(".wh-node");
      const region = (e.target as Element).closest<HTMLElement>(".wh-region");
      if (region) this.host.open(region.dataset.group!, node?.dataset.id);
    });
  }

  /** 選んだノード(同じノードの、ほかの所の分も)に色を付ける */
  private select(id: string | null): void {
    this.selected = this.selected === id ? null : id;
    for (const c of this.world.querySelectorAll<HTMLElement>(".wh-node")) c.classList.toggle("selected", c.dataset.id === this.selected);
  }
}
