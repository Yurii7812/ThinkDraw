// 無限キャンバス(SPEC 4.2)。1 つのグループの members を描き、操作をデータの操作に翻訳する。
import { CARD_H, CARD_W } from "../core/spreadLayout";
import { CycleError, type Vault } from "../core/vault";
import { LINK_KINDS, ROOT_ID, type LinkKind, type TDNode } from "../core/types";
import { cardDef, DECKS, spreadDef } from "../decks";
import { T } from "./strings";
import { askText, h, showMenu, svg, toast, type MenuItem } from "./ui";

export interface View {
  x: number; // 画面 = 世界 * z + (x, y)
  y: number;
  z: number;
}

export interface CanvasHost {
  vault: Vault;
  openGroup(id: string): void;
  openBody(id: string): void;
  pickGroup(): Promise<string | null>;
  cardHover(id: string | null, e?: MouseEvent): void;
  cardImageUrl(deck: string, file: string): string;
  onViewChange(group: string, v: View): void;
  onSelectionChange(ids: string[]): void;
}

interface Draft {
  id: string | null; // null = まだ作っていない
  x: number;
  y: number;
  parent: string | null; // 確定したとき、ここから線を引く
  ta: HTMLTextAreaElement;
}

type Drag =
  | { kind: "node-press"; id: string; sx: number; sy: number; ctrl: boolean; target: Element }
  | { kind: "empty-press"; sx: number; sy: number; ctrl: boolean }
  | { kind: "right-node"; id: string; sx: number; sy: number }
  | { kind: "right-empty"; sx: number; sy: number }
  | { kind: "link"; from: string; line: SVGLineElement }
  | { kind: "rubber"; sx: number; sy: number; box: HTMLElement; ctrl: boolean; base: Set<string> }
  | { kind: "move"; ids: string[]; sx: number; sy: number; start: Map<string, { x: number; y: number }>; pointerId: number }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number };

const DRAG_START = 4;
export const PRESET_COLORS = 8;

function excerpt(body: string, n = 90): string {
  const t = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "🖼")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...t].length > n ? [...t].slice(0, n).join("") + "…" : t;
}

export class Canvas {
  group = ROOT_ID;
  view: View = { x: 0, y: 0, z: 1 };
  selection = new Set<string>();
  readonly el: HTMLElement;
  private world: HTMLElement;
  private edgesSvg: SVGSVGElement;
  private nodesLayer: HTMLElement;
  /** 書いている途中の文字の置き場(描き直しで消えないよう、ノードとは別の層) */
  private draftLayer: HTMLElement;
  private els = new Map<string, HTMLElement>();
  private rects = new Map<string, { x: number; y: number; w: number; h: number }>();
  private drag: Drag | null = null;
  private draft: Draft | null = null;
  private renderQueued = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(private host: CanvasHost, parent: HTMLElement) {
    this.el = h("div", { class: "canvas", tabindex: "0" });
    this.world = h("div", { class: "world" });
    this.edgesSvg = svg("svg", { class: "edges" });
    this.edgesSvg.append(this.markerDefs());
    this.nodesLayer = h("div", { class: "nodes" });
    this.draftLayer = h("div", { class: "nodes drafts" });
    this.world.append(this.edgesSvg, this.nodesLayer, this.draftLayer);
    this.el.append(this.world);
    parent.append(this.el);
    this.bind();
  }

  private get v(): Vault {
    return this.host.vault;
  }

  // ---------- 座標 ----------
  toWorld(cx: number, cy: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: (cx - r.left - this.view.x) / this.view.z, y: (cy - r.top - this.view.y) / this.view.z };
  }
  visibleCenter(): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }
  private applyView(): void {
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.z})`;
    this.el.style.setProperty("--z", String(this.view.z));
    this.host.onViewChange(this.group, { ...this.view });
  }
  setView(v: View): void {
    this.view = { ...v };
    this.applyView();
  }

  // ---------- 表示するグループ ----------
  show(group: string, view: View | null, animate: "in" | "out" | null = null): void {
    this.commitDraft("esc");
    this.group = group;
    this.selection.clear();
    this.host.onSelectionChange([]);
    this.renderNow();
    if (view) this.setView(view);
    else this.fitAll(true);
    if (animate) {
      this.world.classList.remove("anim-in", "anim-out");
      void this.world.offsetWidth;
      this.world.classList.add(animate === "in" ? "anim-in" : "anim-out");
    }
  }

  fitAll(initial = false): void {
    const r = this.el.getBoundingClientRect();
    if (!this.rects.size) {
      this.setView({ x: r.width / 2 - 100, y: r.height / 3, z: 1 });
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of this.rects.values()) {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    const pad = 60;
    const z = Math.min(1, (r.width - pad * 2) / Math.max(1, x1 - x0), (r.height - pad * 2) / Math.max(1, y1 - y0));
    const zz = Math.max(0.1, initial ? Math.min(z, 1) : z);
    this.setView({ x: r.width / 2 - ((x0 + x1) / 2) * zz, y: r.height / 2 - ((y0 + y1) / 2) * zz, z: zz });
  }

  /** 指定したノードが画面に収まっていなければ、中心を保ったまま縮める */
  ensureVisible(ids: string[]): void {
    const bs = ids.map((i) => this.rects.get(i)).filter((b): b is NonNullable<typeof b> => !!b);
    if (!bs.length) return;
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    const r = this.el.getBoundingClientRect();
    const pad = 40;
    const z = Math.min(this.view.z, (r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0));
    if (z >= this.view.z) return;
    const c = this.visibleCenter();
    this.setView({ x: r.width / 2 - c.x * z, y: r.height / 2 - c.y * z, z: Math.max(0.1, z) });
  }

  centerOn(id: string): void {
    const b = this.rects.get(id);
    if (!b) return;
    const r = this.el.getBoundingClientRect();
    const z = Math.max(this.view.z, 0.6);
    this.setView({ x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z, z });
    this.setSelection([id]);
    const el = this.els.get(id);
    el?.classList.add("flash");
    setTimeout(() => el?.classList.remove("flash"), 1200);
  }

  setSelection(ids: Iterable<string>): void {
    this.selection = new Set(ids);
    for (const [id, el] of this.els) el.classList.toggle("selected", this.selection.has(id));
    this.host.onSelectionChange([...this.selection]);
  }

  // ---------- 描画 ----------
  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  renderNow(): void {
    const members = this.v.membersOf(this.group);
    const alive = new Set(members.map((m) => m.id));
    for (const id of [...this.selection]) if (!alive.has(id)) this.selection.delete(id);
    // 見た目が変わっていないノードの要素は使い回す(ホバーなどの状態を保ち、描き直しを軽くする)
    const old = this.els;
    this.els = new Map();
    this.rects.clear();
    const frag: HTMLElement[] = [];
    for (const m of members) {
      const n = this.v.get(m.id)!;
      const sig = this.signature(n);
      let el = old.get(n.id);
      if (!el || el.dataset.sig !== sig) {
        el = this.nodeEl(n);
        el.dataset.sig = sig;
      }
      el.style.left = m.x + "px";
      el.style.top = m.y + "px";
      el.classList.toggle("selected", this.selection.has(n.id));
      el.classList.toggle("editing", this.draft?.id === n.id);
      frag.push(el);
      this.els.set(n.id, el);
    }
    for (const [id, el] of old) if (this.els.get(id) !== el) el.remove();
    // 並び(重なりの順)を members の順にそろえる。同じ位置にあるものは動かさない
    frag.forEach((el, i) => {
      if (this.nodesLayer.children[i] !== el) this.nodesLayer.insertBefore(el, this.nodesLayer.children[i] ?? null);
    });
    for (const m of members) {
      const el = this.els.get(m.id)!;
      this.rects.set(m.id, { x: m.x, y: m.y, w: el.offsetWidth, h: el.offsetHeight });
    }
    this.renderEdges();
  }

  private signature(n: TDNode): string {
    return JSON.stringify([n.type, n.title, n.color, n.type === "note" ? excerpt(n.body) : !!n.body.trim(), n.card, n.spread, n.body.length]);
  }

  private nodeEl(n: TDNode): HTMLElement {
    const el = h("div", { class: `node t-${n.type}${n.color ? " c" + n.color : ""}`, "data-id": n.id });
    if (n.type === "text") {
      el.append(h("span", { class: "label", text: n.title || T.untitled }));
      if (n.body.trim()) el.append(h("span", { class: "bodymark", title: T.hasBody, "data-act": "body" }, "¶"));
    } else if (n.type === "note") {
      el.append(
        h("div", { class: "note-head" }, h("span", { class: "ico ico-note" }), h("span", { class: "label", text: n.title || T.untitled })),
        h("div", { class: "excerpt", text: excerpt(n.body) }),
      );
    } else if (n.type === "group") {
      el.append(h("span", { class: "ico ico-folder" }), h("span", { class: "label", text: n.title || T.untitledGroup }));
    } else if (n.type === "card") {
      const def = n.card ? cardDef(n.card.deck, n.card.id) : undefined;
      const img = h("img", { src: def ? this.host.cardImageUrl(n.card!.deck, def.file) : "", alt: def?.ja ?? "", draggable: "false" });
      if (n.card?.reversed) img.classList.add("reversed");
      el.style.width = CARD_W + "px";
      const name = (n.title || def?.ja || "") + (n.card?.reversed ? T.reversedMark : "");
      el.append(h("div", { class: "cardimg", style: `height:${CARD_H}px` }, img), h("div", { class: "label", text: name }));
      const pos = n.spread?.pos ? spreadDef(n.card?.deck ?? "tarot", n.spread.spread)?.pos.find((p) => p.id === n.spread!.pos) : undefined;
      if (pos) el.append(h("div", { class: "poslabel", text: pos.name }));
      if (n.body.replace(DECKS[n.card?.deck ?? "tarot"]?.initialBody ?? "", "").trim()) el.append(h("span", { class: "bodymark", title: T.hasBody, "data-act": "body" }, "¶"));
    }
    return el;
  }

  private markerDefs(): SVGDefsElement {
    const defs = svg("defs");
    const mk = (id: string, d: string) => {
      const m = svg("marker", { id, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" });
      m.append(svg("path", { d, class: "marker" }));
      defs.append(m);
    };
    mk("arrowhead", "M0,0 L10,5 L0,10 z");
    return defs;
  }

  private clip(b: { x: number; y: number; w: number; h: number }, tx: number, ty: number): { x: number; y: number } {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const sx = dx ? (b.w / 2 + 4) / Math.abs(dx) : Infinity;
    const sy = dy ? (b.h / 2 + 4) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy, 1);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  private renderEdges(): void {
    const defs = this.edgesSvg.querySelector("defs")!;
    this.edgesSvg.replaceChildren(defs);
    // スプレッドの囲み枠(同じ 1 回の「引く」で置いたカード)
    const runs = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
    for (const [id, b] of this.rects) {
      const run = this.v.get(id)?.spread?.run;
      if (!run) continue;
      const r = runs.get(run) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      r.x0 = Math.min(r.x0, b.x); r.y0 = Math.min(r.y0, b.y);
      r.x1 = Math.max(r.x1, b.x + b.w); r.y1 = Math.max(r.y1, b.y + b.h);
      runs.set(run, r);
    }
    for (const r of runs.values()) {
      const p = 18;
      this.edgesSvg.append(svg("rect", { class: "spreadframe", x: r.x0 - p, y: r.y0 - p, width: r.x1 - r.x0 + p * 2, height: r.y1 - r.y0 + p * 2, rx: 14 }));
    }
    for (const [id, a] of this.rects) {
      const n = this.v.get(id)!;
      for (const l of n.links) {
        const b = this.rects.get(l.to);
        if (!b) continue; // 両端が同じキャンバスの中にあるときだけ描く
        const p1 = this.clip(a, b.x + b.w / 2, b.y + b.h / 2);
        const p2 = this.clip(b, a.x + a.w / 2, a.y + a.h / 2);
        const g = svg("g", { class: `edge k-${l.kind}`, "data-from": id, "data-to": l.to });
        const d = `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
        g.append(svg("path", { d, class: "hit" }));
        const vis = svg("path", { d, class: "vis" });
        if (l.kind === "arrow" || l.kind === "double") vis.setAttribute("marker-end", "url(#arrowhead)");
        if (l.kind === "double") vis.setAttribute("marker-start", "url(#arrowhead)");
        g.append(vis);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        if (l.kind === "oppose") {
          // 対立: 線の中ほどに、線を断つ二本の短い線
          const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
          const ux = (p2.x - p1.x) / len, uy = (p2.y - p1.y) / len;
          for (const o of [-4, 4]) {
            const cx = mx + ux * o, cy = my + uy * o;
            g.append(svg("line", { class: "oppose-tick", x1: cx - uy * 8, y1: cy + ux * 8, x2: cx + uy * 8, y2: cy - ux * 8 }));
          }
        }
        if (l.label) {
          const t = svg("text", { x: mx, y: my - 6, class: "edgelabel", "text-anchor": "middle" });
          t.textContent = l.label;
          g.append(t);
        }
        this.edgesSvg.append(g);
      }
    }
  }

  // ---------- 文字を書く(箱なし) ----------
  isEditing(): boolean {
    return !!this.draft;
  }

  startEdit(id: string | null, x: number, y: number, parent: string | null, initial = ""): void {
    this.commitDraft("esc");
    const ta = h("textarea", { class: "draft", rows: 1, spellcheck: "false" }) as HTMLTextAreaElement;
    ta.value = initial;
    ta.style.left = x + "px";
    ta.style.top = y + "px";
    const n = id ? this.v.get(id) : null;
    if (n?.color) ta.classList.add("c" + n.color);
    this.draft = { id, x, y, parent, ta };
    ta.addEventListener("keydown", (e) => this.onDraftKey(e));
    ta.addEventListener("blur", () => {
      // メニューや他の窓を開いたときも確定する
      if (this.draft?.ta === ta) this.commitDraft("esc");
    });
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.draftLayer.append(ta);
    if (id) this.els.get(id)?.classList.add("editing");
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  private onDraftKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return; // 日本語入力の変換中は何もしない
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.commitDraft("enter");
    } else if (e.key === "Tab") {
      e.preventDefault();
      this.commitDraft("tab");
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.commitDraft("esc");
      this.el.focus();
    }
  }

  /** 書いている文字を確定する。Enter は下に次、Tab は右に子 */
  commitDraft(mode: "enter" | "tab" | "esc"): void {
    const d = this.draft;
    if (!d) return;
    this.draft = null;
    d.ta.remove();
    const text = d.ta.value.replace(/\s+$/, "");
    let id = d.id;
    try {
      if (id) {
        if (!text.trim()) {
          if (this.v.get(id)?.type === "text") this.v.trash([id]);
          id = null;
        } else this.v.update(id, { title: text });
      } else if (text.trim()) {
        this.v.tx(() => {
          id = this.v.create({ type: "text", title: text, group: this.group, x: d.x, y: d.y }).id;
          if (d.parent && this.v.exists(d.parent)) this.v.addLink(d.parent, id);
        });
      }
    } finally {
      this.renderNow();
    }
    if (!id || mode === "esc") return;
    const b = this.rects.get(id)!;
    if (mode === "enter") {
      const parent = d.parent ?? this.parentOf(id);
      const p = this.freeSpot(b.x, b.y + b.h + 14, b.h);
      this.startEdit(null, p.x, p.y, parent);
    } else {
      const kids = this.v.get(id)!.links.map((l) => this.rects.get(l.to)).filter((r): r is NonNullable<typeof r> => !!r && r.x > b.x + b.w);
      const x = kids.length ? Math.min(...kids.map((k) => k.x)) : b.x + b.w + 60;
      const y = kids.length ? Math.max(...kids.map((k) => k.y + k.h)) + 14 : b.y;
      const p = this.freeSpot(x, y, b.h);
      this.startEdit(null, p.x, p.y, id);
    }
  }

  /** このキャンバスで、このノードに線を引いている(左にある)ノード */
  private parentOf(id: string): string | null {
    const me = this.rects.get(id)!;
    for (const [pid, r] of this.rects) {
      if (pid === id) continue;
      if (this.v.get(pid)!.links.some((l) => l.to === id) && r.x < me.x) return pid;
    }
    return null;
  }

  private freeSpot(x: number, y: number, step: number): { x: number; y: number } {
    let yy = y;
    for (let i = 0; i < 50; i++) {
      const hit = [...this.rects.values()].some((r) => x < r.x + r.w && x + 40 > r.x && yy < r.y + r.h && yy + step > r.y);
      if (!hit) break;
      yy += step + 14;
    }
    return { x, y: yy };
  }

  // ---------- 操作 ----------
  private nodeAt(target: EventTarget | null): string | null {
    const el = (target as Element | null)?.closest?.(".node");
    return el?.getAttribute("data-id") ?? null;
  }
  private nodeAtPoint(cx: number, cy: number, exclude: Set<string> = new Set()): string | null {
    for (const el of document.elementsFromPoint(cx, cy)) {
      const id = el.closest(".node")?.getAttribute("data-id");
      if (id && !exclude.has(id) && this.el.contains(el)) return id;
    }
    return null;
  }

  private bind(): void {
    const el = this.el;
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => this.onDown(e));
    addEventListener("pointermove", (e) => this.onMove(e));
    addEventListener("pointerup", (e) => this.onUp(e));
    el.addEventListener("dblclick", (e) => {
      const id = this.nodeAt(e.target);
      if (!id) return;
      const n = this.v.get(id);
      if (n?.type === "group") {
        e.preventDefault();
        this.commitDraft("esc");
        this.host.openGroup(id);
      }
    });
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
          const r = el.getBoundingClientRect();
          const px = e.clientX - r.left, py = e.clientY - r.top;
          const z = Math.min(4, Math.max(0.1, this.view.z * Math.exp(-e.deltaY * 0.0015)));
          const k = z / this.view.z;
          this.setView({ x: px - (px - this.view.x) * k, y: py - (py - this.view.y) * k, z });
        } else {
          this.setView({ ...this.view, x: this.view.x - e.deltaX, y: this.view.y - e.deltaY });
        }
      },
      { passive: false },
    );
    el.addEventListener("mousemove", (e) => {
      this.lastPointer = { x: e.clientX, y: e.clientY };
      const id = this.nodeAt(e.target);
      this.host.cardHover(id && this.v.get(id)?.type === "card" && !this.drag ? id : null, e);
    });
    el.addEventListener("mouseleave", () => this.host.cardHover(null));
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 2) return;
    this.host.cardHover(null);
    const edge = (e.target as Element).closest?.(".edge");
    const id = this.nodeAt(e.target);
    const ctrl = e.ctrlKey;
    if (e.button === 0) {
      if (edge) return; // 線の左クリックは何もしない(メニューは右クリック)
      if (id) this.drag = { kind: "node-press", id, sx: e.clientX, sy: e.clientY, ctrl, target: e.target as Element };
      else this.drag = { kind: "empty-press", sx: e.clientX, sy: e.clientY, ctrl };
    } else {
      if (id) this.drag = { kind: "right-node", id, sx: e.clientX, sy: e.clientY };
      else this.drag = { kind: "right-empty", sx: e.clientX, sy: e.clientY };
    }
    if (!this.draft) this.el.focus({ preventScroll: true });
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const far = "sx" in d && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_START;
    switch (d.kind) {
      case "node-press": {
        if (!far) return;
        this.commitDraft("esc");
        const line = svg("line", { class: "linkdrag" });
        this.edgesSvg.append(line);
        this.drag = { kind: "link", from: d.id, line };
        this.onMove(e);
        return;
      }
      case "empty-press": {
        if (!far) return;
        this.commitDraft("esc");
        const box = h("div", { class: "rubber" });
        this.el.append(box);
        this.drag = { kind: "rubber", sx: d.sx, sy: d.sy, box, ctrl: d.ctrl, base: d.ctrl ? new Set(this.selection) : new Set() };
        this.onMove(e);
        return;
      }
      case "right-node": {
        if (!far) return;
        this.commitDraft("esc");
        const ids = this.selection.has(d.id) ? [...this.selection] : [d.id];
        if (!this.selection.has(d.id)) this.setSelection([d.id]);
        const start = new Map(ids.map((i) => [i, { x: this.rects.get(i)!.x, y: this.rects.get(i)!.y }]));
        this.drag = { kind: "move", ids, sx: d.sx, sy: d.sy, start, pointerId: e.pointerId };
        for (const i of ids) this.els.get(i)?.classList.add("moving");
        return;
      }
      case "right-empty": {
        if (!far) return;
        this.drag = { kind: "pan", sx: d.sx, sy: d.sy, vx: this.view.x, vy: this.view.y };
        this.el.classList.add("panning");
        return;
      }
      case "link": {
        const a = this.rects.get(d.from);
        if (!a) return;
        const p = this.toWorld(e.clientX, e.clientY);
        d.line.setAttribute("x1", String(a.x + a.w / 2));
        d.line.setAttribute("y1", String(a.y + a.h / 2));
        d.line.setAttribute("x2", String(p.x));
        d.line.setAttribute("y2", String(p.y));
        const over = this.nodeAtPoint(e.clientX, e.clientY, new Set([d.from]));
        for (const [i, el] of this.els) el.classList.toggle("droptarget", i === over);
        return;
      }
      case "rubber": {
        const r = this.el.getBoundingClientRect();
        const x0 = Math.min(d.sx, e.clientX), y0 = Math.min(d.sy, e.clientY);
        const x1 = Math.max(d.sx, e.clientX), y1 = Math.max(d.sy, e.clientY);
        Object.assign(d.box.style, { left: x0 - r.left + "px", top: y0 - r.top + "px", width: x1 - x0 + "px", height: y1 - y0 + "px" });
        const a = this.toWorld(x0, y0), b = this.toWorld(x1, y1);
        const sel = new Set(d.base);
        for (const [i, q] of this.rects) if (q.x < b.x && q.x + q.w > a.x && q.y < b.y && q.y + q.h > a.y) sel.add(i);
        this.setSelection(sel);
        return;
      }
      case "move": {
        const dx = (e.clientX - d.sx) / this.view.z, dy = (e.clientY - d.sy) / this.view.z;
        for (const i of d.ids) {
          const s = d.start.get(i)!;
          const el = this.els.get(i);
          if (el) {
            el.style.left = s.x + dx + "px";
            el.style.top = s.y + dy + "px";
          }
          const r = this.rects.get(i)!;
          r.x = s.x + dx;
          r.y = s.y + dy;
        }
        this.renderEdges();
        const over = this.nodeAtPoint(e.clientX, e.clientY, new Set(d.ids));
        for (const [i, el] of this.els) el.classList.toggle("droptarget", i === over);
        return;
      }
      case "pan":
        this.setView({ ...this.view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
        return;
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    for (const el of this.els.values()) el.classList.remove("droptarget", "moving");
    switch (d.kind) {
      case "node-press":
        return this.clickNode(d.id, d.ctrl, d.target);
      case "empty-press": {
        if (d.ctrl) return;
        if (this.draft) {
          this.commitDraft("esc");
          return;
        }
        this.setSelection([]);
        const p = this.toWorld(e.clientX, e.clientY);
        this.startEdit(null, Math.round(p.x), Math.round(p.y - 10), null);
        return;
      }
      case "right-node": {
        if (!this.selection.has(d.id)) this.setSelection([d.id]);
        return this.nodeMenu(d.id, e.clientX, e.clientY);
      }
      case "right-empty": {
        const edge = (e.target as Element).closest?.(".edge");
        if (edge) return this.edgeMenu(edge.getAttribute("data-from")!, edge.getAttribute("data-to")!, e.clientX, e.clientY);
        return this.emptyMenu(e.clientX, e.clientY);
      }
      case "link": {
        d.line.remove();
        const over = this.nodeAtPoint(e.clientX, e.clientY, new Set([d.from]));
        if (over) {
          this.v.toggleLink(d.from, over);
        } else {
          const p = this.toWorld(e.clientX, e.clientY);
          this.startEdit(null, Math.round(p.x), Math.round(p.y - 10), d.from);
        }
        return;
      }
      case "rubber":
        d.box.remove();
        return;
      case "move":
        return this.endMove(d, e);
      case "pan":
        this.el.classList.remove("panning");
        return;
    }
  }

  private clickNode(id: string, ctrl: boolean, target: Element): void {
    if (ctrl) {
      const s = new Set(this.selection);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      this.setSelection(s);
      return;
    }
    const n = this.v.get(id);
    if (!n) return;
    this.setSelection([id]);
    if (target.closest("[data-act=body]")) return this.host.openBody(id);
    if (n.type === "text") {
      const r = this.rects.get(id)!;
      this.startEdit(id, r.x, r.y, null, n.title);
    } else if (n.type === "note" || n.type === "card") this.host.openBody(id);
    // グループは選ぶだけ(ダブルクリックで開く)
  }

  private endMove(d: Extract<Drag, { kind: "move" }>, e: PointerEvent): void {
    const over = this.nodeAtPoint(e.clientX, e.clientY, new Set(d.ids));
    const positions = d.ids.map((i) => ({ id: i, x: Math.round(this.rects.get(i)!.x), y: Math.round(this.rects.get(i)!.y) }));
    if (!over) {
      this.v.move(this.group, positions);
      return;
    }
    const target = this.v.get(over)!;
    try {
      if (target.type === "group") {
        // グループの上に重ねた: そのグループへ移す
        this.v.tx(() => {
          let k = 0;
          const inside = this.v.membersOf(over);
          const baseY = inside.reduce((a, m) => Math.max(a, m.y + 60), 0);
          for (const i of d.ids) this.v.moveToGroup(this.group, over, i, (k % 5) * 160, baseY + Math.floor(k++ / 5) * 60);
        });
        toast(T.movedInto(target.title || T.untitledGroup));
      } else {
        // 普通のノードの上に重ねた: その場でグループになる
        const tpos = this.v.memberPos(this.group, over)!;
        const g = this.v.tx(() => {
          const g = this.v.bundle(this.group, [over, ...d.ids]);
          this.v.move(this.group, [{ id: g.id, x: tpos.x, y: tpos.y }]);
          return g;
        });
        this.renderNow();
        this.setSelection([g.id]);
        this.renameGroup(g.id);
      }
    } catch (err) {
      this.renderNow();
      if (err instanceof CycleError) toast(T.cycleRefused);
      else throw err;
    }
  }

  renameGroup(id: string): void {
    const r = this.rects.get(id);
    if (!r) return;
    // グループの名前も、その場の文字の入力で直す
    const n = this.v.get(id)!;
    this.startEdit(id, r.x, r.y, null, n.title);
    this.draft!.ta.classList.add("for-group");
  }

  // ---------- キー ----------
  handleKey(e: KeyboardEvent): boolean {
    if (this.draft) return false;
    const ids = [...this.selection];
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!ids.length) return false;
      this.v.trash(ids);
      toast(T.trashed(ids.length));
      return true;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "a") {
      this.setSelection(this.rects.keys());
      return true;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "g") {
      this.bundleSelection();
      return true;
    }
    if (e.ctrlKey && e.key === "0") {
      this.fitAll();
      return true;
    }
    if (e.key === "Enter" && ids.length === 1) {
      const n = this.v.get(ids[0]);
      if (n?.type === "group") this.host.openGroup(n.id);
      else if (n) this.clickNode(n.id, false, this.els.get(n.id)!);
      return true;
    }
    return false;
  }

  bundleSelection(): void {
    const ids = [...this.selection];
    if (!ids.length) return;
    const g = this.v.bundle(this.group, ids);
    this.renderNow();
    this.setSelection([g.id]);
    this.renameGroup(g.id);
  }

  // ---------- 右クリックのメニュー ----------
  private colorItem(ids: string[]): MenuItem {
    const cur = this.v.get(ids[0])?.color ?? 0;
    const set = (c: number) => this.v.tx(() => ids.forEach((i) => this.v.update(i, { color: c })));
    return {
      label: T.color,
      swatches: Array.from({ length: PRESET_COLORS + 1 }, (_, c) => ({ color: c, title: c ? `${T.color} ${c}` : T.colorNone, active: c === cur, action: () => set(c) })),
    };
  }

  private nodeMenu(id: string, x: number, y: number): void {
    const n = this.v.get(id);
    if (!n) return;
    const ids = this.selection.has(id) ? [...this.selection] : [id];
    const items: MenuItem[] = [];
    if (n.type === "group") items.push({ label: T.openGroup, action: () => this.host.openGroup(id) }, { label: T.rename, action: () => this.renameGroup(id) });
    items.push({ label: T.openBody, action: () => this.host.openBody(id) });
    if (n.type === "card" && n.card)
      items.push({ label: T.cardFlip, checked: n.card.reversed, action: () => this.v.setCard(id, { ...n.card!, reversed: !n.card!.reversed }) });
    items.push(this.colorItem(ids), { separator: true, label: "" });
    items.push({ label: T.bundle, action: () => this.bundleSelection() });
    if (n.type === "group") items.push({ label: T.unbundle, action: () => this.v.unbundle(id) });
    items.push({
      label: T.addToGroup,
      action: async () => {
        const g = await this.host.pickGroup();
        if (!g) return;
        try {
          this.v.tx(() => ids.forEach((i, k) => this.v.addToGroup(g, i, (k % 5) * 160, 40 + Math.floor(k / 5) * 60)));
          toast(T.addedInto(this.v.get(g)?.title || T.untitledGroup));
        } catch (err) {
          if (err instanceof CycleError) toast(T.cycleRefused);
          else throw err;
        }
      },
    });
    items.push({
      label: T.removeFromGroup,
      action: () => {
        let refused = false;
        this.v.tx(() => ids.forEach((i) => (refused = !this.v.removeFromGroup(this.group, i) || refused)));
        if (refused && this.group === ROOT_ID) toast(T.rootLastParent);
      },
    });
    items.push({ separator: true, label: "" }, {
      label: T.delete,
      action: () => {
        this.v.trash(ids);
        toast(T.trashed(ids.length));
      },
    });
    showMenu(x, y, items);
  }

  private emptyMenu(x: number, y: number): void {
    const p = this.toWorld(x, y);
    showMenu(x, y, [
      { label: T.newText, action: () => this.startEdit(null, Math.round(p.x), Math.round(p.y), null) },
      {
        label: T.newNote,
        action: () => {
          const n = this.v.create({ type: "note", title: "", group: this.group, x: Math.round(p.x), y: Math.round(p.y) });
          this.host.openBody(n.id);
        },
      },
      { separator: true, label: "" },
      { label: T.selectAll, action: () => this.setSelection(this.rects.keys()) },
      { label: T.fitAll, action: () => this.fitAll() },
    ]);
  }

  private edgeMenu(from: string, to: string, x: number, y: number): void {
    const l = this.v.get(from)?.links.find((l) => l.to === to);
    if (!l) return;
    showMenu(x, y, [
      { label: T.linkKind, disabled: true },
      ...LINK_KINDS.map((k: LinkKind) => ({ label: "  " + T.kinds[k], checked: l.kind === k, action: () => this.v.setLinkKind(from, to, k) })),
      { separator: true, label: "" },
      { label: T.linkReverse, action: () => this.v.reverseLink(from, to) },
      {
        label: T.linkLabel,
        action: async () => {
          const s = await askText(T.labelPrompt, l.label ?? "");
          if (s !== null) this.v.setLinkLabel(from, to, s.trim());
        },
      },
      { label: T.linkRemove, action: () => this.v.removeLink(from, to) },
    ]);
  }

  get pointer(): { x: number; y: number } {
    return this.lastPointer;
  }
}
