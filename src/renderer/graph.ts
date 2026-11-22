// グラフビュー(右のサイドパネル。SPEC 第 5 章)。静止した層状の配置。丸は動かせない(パンとズームだけ)
import { buildGroupGraph, buildLocalGraph, graphKey, layoutGraph, type Layout } from "../core/graphLayout";
import { ROOT_ID } from "../core/types";
import type { Vault } from "../core/vault";
import { T } from "./strings";
import { api, h, svg } from "./ui";

export type GraphMode = "local" | "groups";
const LAYOUT_FILE = "graph-layout.json";

export interface GraphHost {
  vault: Vault;
  currentGroup(): string;
  /** キャンバスで選んでいるノード(1 つのとき) */
  selectedNode(): string | null;
  openGroup(id: string): void;
  goToNode(id: string): void;
  onModeChange(m: GraphMode): void;
}

export class GraphPanel {
  readonly el: HTMLElement;
  mode: GraphMode = "local";
  private svgEl: SVGSVGElement;
  private gRoot: SVGGElement;
  private info: HTMLElement;
  private selected: string | null = null;
  private layout: Layout | null = null;
  private cache: Record<string, Layout> = {};
  private cacheLoaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private view = { x: 10, y: 10, z: 1 };
  private fitted = "";

  constructor(private host: GraphHost, parent: HTMLElement) {
    const tabs = h("div", { class: "seg" });
    for (const [m, label] of [["local", T.graphLocal], ["groups", T.graphGroups]] as const) {
      const b = h("button", { class: "seg-b", "data-mode": m, text: label });
      b.addEventListener("click", () => this.setMode(m));
      tabs.append(b);
    }
    this.svgEl = svg("svg", { class: "graph-svg", tabindex: "0" });
    const defs = svg("defs");
    const mk = svg("marker", { id: "g-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse" });
    mk.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: "marker" }));
    defs.append(mk);
    this.gRoot = svg("g");
    this.svgEl.append(defs, this.gRoot);
    this.info = h("div", { class: "graph-info" });
    this.el = h("div", { class: "graph-panel" }, h("div", { class: "graph-head" }, tabs), this.svgEl, this.info);
    parent.append(this.el);
    this.bind();
  }

  setMode(m: GraphMode): void {
    this.mode = m;
    this.selected = null;
    this.host.onModeChange(m);
    this.render();
  }

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      this.cache = JSON.parse((await api().readApp(LAYOUT_FILE)) ?? "{}");
    } catch {
      this.cache = {};
    }
  }

  /** 構造が変わったときだけ計算し直す。計算した位置は .thinkdraw/graph-layout.json に保存 */
  async render(): Promise<void> {
    if (!this.el.isConnected || this.el.offsetParent === null) return;
    await this.loadCache();
    const v = this.host.vault;
    const cur = this.host.currentGroup();
    const selNode = this.host.selectedNode();
    const g = this.mode === "groups" ? buildGroupGraph(v, T.untitledGroup) : buildLocalGraph(v, cur, selNode, T.untitled);
    for (const n of g.nodes) if (n.id === ROOT_ID) n.label = T.home;
    const slot = this.mode === "groups" ? "groups" : `local:${cur}`;
    let lay = this.cache[slot];
    const key = graphKey(g);
    if (!lay || lay.key !== key) {
      lay = layoutGraph(g);
      this.cache[slot] = lay;
      // ノード表示の保存は、直近のいくつかのグループだけ残す
      const nodeSlots = Object.keys(this.cache).filter((k) => k.startsWith("local:"));
      for (const k of nodeSlots.slice(0, Math.max(0, nodeSlots.length - 20))) delete this.cache[k];
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => api().writeApp(LAYOUT_FILE, JSON.stringify(this.cache)), 500);
    }
    this.layout = lay;
    if (this.selected && !lay.nodes.some((n) => n.id === this.selected)) this.selected = null;
    // キャンバスで選んでいるノードを、グラフでも強調する
    if (selNode && lay.nodes.some((n) => n.id === selNode)) this.selected = selNode;
    this.draw();
    if (this.fitted !== slot) {
      this.fitted = slot;
      this.fit();
    }
    for (const b of this.el.querySelectorAll(".seg-b")) b.classList.toggle("active", b.getAttribute("data-mode") === this.mode);
  }

  private fit(): void {
    const lay = this.layout;
    if (!lay) return;
    const r = this.svgEl.getBoundingClientRect();
    const z = Math.min(1.2, (r.width - 20) / Math.max(1, lay.width), (r.height - 20) / Math.max(1, lay.height));
    this.view = { z: Math.max(0.15, z), x: (r.width - lay.width * Math.max(0.15, z)) / 2, y: 10 };
    this.applyView();
  }
  private applyView(): void {
    this.gRoot.setAttribute("transform", `translate(${this.view.x},${this.view.y}) scale(${this.view.z})`);
  }

  private draw(): void {
    const lay = this.layout!;
    const v = this.host.vault;
    this.gRoot.replaceChildren();
    if (!lay.nodes.length) {
      this.info.textContent = T.graphEmpty;
      return;
    }
    const pos = new Map(lay.nodes.map((n) => [n.id, n]));
    const sel = this.selected;
    const edgesG = svg("g", { class: "g-edges" + (sel ? " dimmed" : "") });
    for (const e of lay.edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) continue;
      let x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
      if (e.kind === "member" && b.y > a.y) {
        y1 = a.y + a.h / 2;
        y2 = b.y - b.h / 2;
      } else {
        // 箱の縁で止める
        const clip = (p: typeof a, tx: number, ty: number) => {
          const dx = tx - p.x, dy = ty - p.y;
          const s = Math.min(dx ? p.w / 2 / Math.abs(dx) : Infinity, dy ? p.h / 2 / Math.abs(dy) : Infinity, 1);
          return [p.x + dx * s, p.y + dy * s];
        };
        [x1, y1] = clip(a, b.x, b.y);
        [x2, y2] = clip(b, a.x, a.y);
      }
      const hot = sel && (e.from === sel || e.to === sel);
      const line = svg("path", {
        d: e.kind === "member" && b.y > a.y ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`,
        class: `g-edge ${e.kind === "member" ? "member" : e.kind === "ref" ? "ref" : "link k-" + e.kind}${hot ? " hot" : ""}`,
      });
      if (e.kind === "arrow" || e.kind === "double") line.setAttribute("marker-end", "url(#g-arrow)");
      if (e.kind === "double") line.setAttribute("marker-start", "url(#g-arrow)");
      edgesG.append(line);
    }
    this.gRoot.append(edgesG);
    const cur = this.host.currentGroup();
    for (const n of lay.nodes) {
      const neighbor = sel && lay.edges.some((e) => (e.from === sel && e.to === n.id) || (e.to === sel && e.from === n.id));
      const g = svg("g", {
        class: `g-node k-${n.kind}${n.id === sel ? " selected" : ""}${n.id === cur ? " current" : ""}${sel && n.id !== sel && !neighbor ? " dim" : ""}`,
        "data-id": n.id,
        transform: `translate(${n.x - n.w / 2},${n.y - n.h / 2})`,
      });
      const color = v.get(n.id)?.color;
      g.append(svg("rect", { width: n.w, height: n.h, rx: n.kind === "group" || n.kind === "root" ? 8 : 15, class: color ? `c${color}` : "" }));
      const t = svg("text", { x: n.w / 2, y: n.h / 2 + 4.5, "text-anchor": "middle" });
      t.textContent = n.label;
      g.append(t);
      this.gRoot.append(g);
    }
    this.renderInfo();
  }

  private renderInfo(): void {
    const v = this.host.vault;
    const id = this.selected;
    if (!id) {
      this.info.textContent = T.graphHint;
      return;
    }
    const n = v.get(id);
    this.info.replaceChildren(
      h("div", { class: "gi-title", text: id === ROOT_ID ? T.home : n?.title || T.untitled }),
      h("div", { class: "gi-counts", text: T.graphCounts(v.parentsOf(id).length, v.quotedBy(id).length, v.backlinksOf(id).length) }),
      h("div", { class: "gi-legend" }, h("span", { class: "lg member", text: T.belongsTo }), h("span", { class: "lg ref", text: T.quote }), h("span", { class: "lg link", text: T.linkWord })),
    );
  }

  private activate(id: string): void {
    if (this.selected !== id) {
      this.selected = id;
      this.draw();
      return;
    }
    // もう一度押すと、そこへ移動する
    if (this.host.vault.get(id)?.type === "group") this.host.openGroup(id);
    else this.host.goToNode(id);
  }

  private bind(): void {
    const s = this.svgEl;
    let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
    s.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y, moved: false };
      s.setPointerCapture(e.pointerId);
    });
    s.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
      if (drag.moved) {
        this.view.x = drag.vx + e.clientX - drag.x;
        this.view.y = drag.vy + e.clientY - drag.y;
        this.applyView();
      }
    });
    s.addEventListener("pointerup", (e) => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".g-node");
      const id = el?.getAttribute("data-id");
      if (id) this.activate(id);
      else if (this.selected) {
        this.selected = null;
        this.draw();
      }
    });
    s.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = s.getBoundingClientRect();
        if (e.ctrlKey) {
          const px = e.clientX - r.left, py = e.clientY - r.top;
          const z = Math.min(3, Math.max(0.1, this.view.z * Math.exp(-e.deltaY * 0.0015)));
          const k = z / this.view.z;
          this.view = { x: px - (px - this.view.x) * k, y: py - (py - this.view.y) * k, z };
        } else {
          this.view.x -= e.deltaX;
          this.view.y -= e.deltaY;
        }
        this.applyView();
      },
      { passive: false },
    );
    s.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.selected) {
        e.preventDefault();
        e.stopPropagation();
        this.activate(this.selected);
      }
    });
  }
}
