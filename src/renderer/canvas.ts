// 無限キャンバス(SPEC 4.2)。1 つのグループの中身(所属 + 引用)とペンの線を描き、操作をデータの操作に翻訳する。
import { gap, placeAround, segHitsRect, type Rect } from "../core/placement";
import { CARD_H, CARD_W } from "../core/spreadLayout";
import { CycleError, type Vault } from "../core/vault";
import { LINK_KINDS, ROOT_ID, type LinkKind, type Stroke, type TDNode } from "../core/types";
import { cardName, spreadDef } from "../decks";
import { cardFace, faceHeight } from "./cardface";
import { openPicker } from "./picker";
import { T } from "./strings";
import { api, askText, h, showMenu, svg, toast, type MenuItem } from "./ui";
import { pickIslands, placeIslands } from "../core/islands";

export interface View {
  x: number; // 画面 = 世界 * z + (x, y)
  y: number;
  z: number;
}

export interface PenState {
  on: boolean;
  tool: "pen" | "hl" | "eraser";
  color: number; // 0 = 文字と同じ色
  width: number;
}

export interface CanvasHost {
  vault: Vault;
  openGroup(id: string): void;
  /** 開く(文字は書き直し以外。ノート・カード・グループの本文) */
  openBody(id: string): void;
  goToNode(id: string): void;
  pickGroup(title: string): Promise<string | null>;
  cardHover(id: string | null, e?: MouseEvent): void;
  onViewChange(group: string, v: View): void;
  onSelectionChange(ids: string[]): void;
  /** 画面の外(分割の反対側)の上をドラッグしている間。cx = null で終わり。反対側に落とせる所なら true */
  dragOutside?(ids: string[], cx: number | null, cy: number, link: boolean): boolean;
  /** 分割していて、反対側の画面があるか */
  hasOther?(): boolean;
  /** 分割の反対側に、引用として置く(右クリックから) */
  quoteToOther?(ids: string[]): void;
  /** この画面の外(横の画面)へ落としたとき。受け取ったら true */
  dropOutside?(ids: string[], cx: number, cy: number, link: boolean): boolean;
  /** 島の範囲を変えたとき(覚えるため) */
  onScopeChange?(n: number): void;
  /** 添付のファイルを、その種類のふつうのアプリで開く */
  openFile?(rel: string): void;
  /** グループの ▸: 下のグループの木を出す */
  groupTree?(id: string, anchor: Element): void;
  /** 空きの右クリックに足す項目(日のグループでの記録の作成など)。x, y は置く位置 */
  extraEmptyMenu?(group: string, x: number, y: number): MenuItem[];
  /** 横の画面に開く(グループはその中、ほかは所属先で、そのノードを見せる) */
  openBeside?(id: string): void;
}

interface Draft {
  id: string | null; // null = まだ作っていない
  x: number;
  y: number;
  parent: string | null; // 確定したとき、ここから線を引く
  ta: HTMLTextAreaElement;
}

type Drag =
  | { kind: "node-press"; id: string; sx: number; sy: number; ctrl: boolean; target: Element; wasSelected: boolean }
  | { kind: "stroke-press"; id: string; sx: number; sy: number; ctrl: boolean }
  | { kind: "empty-press"; sx: number; sy: number; ctrl: boolean }
  | { kind: "right-node"; id: string; sx: number; sy: number }
  | { kind: "right-stroke"; id: string; sx: number; sy: number }
  | { kind: "right-empty"; sx: number; sy: number }
  | { kind: "link"; from: string; line: SVGLineElement }
  | { kind: "rubber"; sx: number; sy: number; box: HTMLElement; base: Set<string>; baseStrokes: Set<string> }
  | { kind: "move"; ids: string[]; strokes: string[]; sx: number; sy: number; start: Map<string, { x: number; y: number }>; dx: number; dy: number }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "draw"; pts: number[]; path: SVGPathElement }
  | { kind: "erase"; hit: Set<string> }
  | { kind: "outer"; id: string; sx: number; sy: number; moved: boolean };

const DRAG_START = 4;
export const PRESET_COLORS = 8;
const CARD_FACE_H = CARD_H;

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

export function strokeD(p: number[]): string {
  if (p.length < 2) return "";
  let d = `M${p[0]},${p[1]}`;
  if (p.length === 2) d += ` L${p[0] + 0.1},${p[1]}`;
  for (let i = 2; i + 1 < p.length; i += 2) d += ` L${p[i]},${p[i + 1]}`;
  return d;
}
function strokeBox(s: Stroke): Rect {
  const xs = s.p.filter((_, i) => i % 2 === 0), ys = s.p.filter((_, i) => i % 2 === 1);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}
function nearStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const rr = r + s.w / 2;
  for (let i = 0; i + 1 < s.p.length; i += 2) {
    const ax = s.p[i], ay = s.p[i + 1];
    const bx = i + 3 < s.p.length ? s.p[i + 2] : ax, by = i + 3 < s.p.length ? s.p[i + 3] : ay;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= rr) return true;
  }
  return false;
}

export class Canvas {
  group = ROOT_ID;
  view: View = { x: 0, y: 0, z: 1 };
  selection = new Set<string>();
  strokeSel = new Set<string>();
  pen: PenState = { on: false, tool: "pen", color: 0, width: 3 };
  readonly el: HTMLElement;
  private world: HTMLElement;
  private edgesSvg: SVGSVGElement;
  private strokesSvg: SVGSVGElement;
  private nodesLayer: HTMLElement;
  /** 書いている途中の文字の置き場(描き直しで消えないよう、ノードとは別の層) */
  private draftLayer: HTMLElement;
  private els = new Map<string, HTMLElement>();
  private rects = new Map<string, Rect>();
  private drag: Drag | null = null;
  /** 「まわり」を出しているか(今のグループはそのまま、外につながりを広げる) */
  surround = false;
  /** 見るだけ(全体の画面の右側)。書く・動かす・消すはできない */
  readOnly = false;
  private outerLayer: HTMLElement;
  private draft: Draft | null = null;
  private renderQueued = false;

  constructor(private host: CanvasHost, parent: HTMLElement) {
    this.el = h("div", { class: "canvas", tabindex: "0" });
    this.world = h("div", { class: "world" });
    this.edgesSvg = svg("svg", { class: "edges" });
    this.edgesSvg.append(this.markerDefs());
    this.strokesSvg = svg("svg", { class: "strokes" });
    this.nodesLayer = h("div", { class: "nodes" });
    this.draftLayer = h("div", { class: "nodes drafts" });
    this.outerLayer = h("div", { class: "nodes outer-layer" });
    this.world.append(this.edgesSvg, this.strokesSvg, this.outerLayer, this.nodesLayer, this.draftLayer);
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
    // 縮めたとき、島の名前は読める大きさに保つ
    this.el.style.setProperty("--inv-z", String(Math.min(5, Math.max(1, 1 / this.view.z))));
    this.host.onViewChange(this.group, { ...this.view });
  }
  setView(v: View): void {
    this.view = { ...v };
    this.applyView();
  }
  rectOf(id: string): Rect | undefined {
    return this.rects.get(id);
  }

  // ---------- 表示するグループ ----------
  show(group: string, view: View | null, animate: "in" | "out" | null = null): void {
    this.commitDraft("esc");
    this.group = group;
    this.selection.clear();
    this.strokeSel.clear();
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

  private allBoxes(): Rect[] {
    const outer = this.surround ? this.islands.map((i) => i.box) : [];
    return [...this.rects.values(), ...this.v.strokesOf(this.group).map(strokeBox), ...outer];
  }

  fitAll(initial = false): void {
    const r = this.el.getBoundingClientRect();
    const boxes = this.allBoxes();
    if (!boxes.length) {
      this.setView({ x: r.width / 2 - 100, y: r.height / 3, z: 1 });
      return;
    }
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const pad = 60;
    const z = Math.min(1, (r.width - pad * 2) / Math.max(1, x1 - x0), (r.height - pad * 2) / Math.max(1, y1 - y0));
    const zz = Math.max(0.1, initial ? Math.min(z, 1) : z);
    this.setView({ x: r.width / 2 - ((x0 + x1) / 2) * zz, y: r.height / 2 - ((y0 + y1) / 2) * zz, z: zz });
  }

  /** 指定したノードが画面に収まっていなければ、中心を保ったまま縮める */
  ensureVisible(ids: string[]): void {
    const bs = ids.map((i) => this.rects.get(i)).filter((b): b is Rect => !!b);
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

  setSelection(ids: Iterable<string>, strokes: Iterable<string> = []): void {
    this.selection = new Set(ids);
    this.strokeSel = new Set(strokes);
    for (const [id, el] of this.els) el.classList.toggle("selected", this.selection.has(id));
    for (const p of this.strokesSvg.querySelectorAll<SVGPathElement>("path.stroke")) p.classList.toggle("selected", this.strokeSel.has(p.dataset.sid!));
    this.updateSelBar();
    this.host.onSelectionChange([...this.selection]);
  }

  setPen(p: Partial<PenState>): void {
    this.pen = { ...this.pen, ...p };
    this.el.classList.toggle("pen-mode", this.pen.on);
    this.el.classList.toggle("eraser", this.pen.on && this.pen.tool === "eraser");
    if (this.pen.on) this.commitDraft("esc");
    this.updateSelBar();
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
    const items = this.v.itemsOf(this.group);
    const alive = new Set(items.map((m) => m.id));
    for (const id of [...this.selection]) if (!alive.has(id)) this.selection.delete(id);
    const strokeIds = new Set(this.v.strokesOf(this.group).map((s) => s.id));
    for (const id of [...this.strokeSel]) if (!strokeIds.has(id)) this.strokeSel.delete(id);
    // 見た目が変わっていないノードの要素は使い回す(ホバーなどの状態を保ち、描き直しを軽くする)
    const old = this.els;
    this.els = new Map();
    this.rects.clear();
    const order: HTMLElement[] = [];
    for (const m of items) {
      const n = this.v.get(m.id)!;
      const sig = this.signature(n, m.ref);
      let el = old.get(n.id);
      if (!el || el.dataset.sig !== sig) {
        el = this.nodeEl(n, m.ref);
        el.dataset.sig = sig;
      }
      el.style.left = m.x + "px";
      el.style.top = m.y + "px";
      el.classList.toggle("selected", this.selection.has(n.id));
      el.classList.toggle("editing", this.draft?.id === n.id);
      order.push(el);
      this.els.set(n.id, el);
    }
    for (const [id, el] of old) if (this.els.get(id) !== el) el.remove();
    order.forEach((el, i) => {
      if (this.nodesLayer.children[i] !== el) this.nodesLayer.insertBefore(el, this.nodesLayer.children[i] ?? null);
    });
    for (const m of items) {
      const el = this.els.get(m.id)!;
      this.rects.set(m.id, { x: m.x, y: m.y, w: el.offsetWidth, h: el.offsetHeight });
    }
    this.renderOuter();
    this.renderEdges();
    this.renderStrokes();
  }

  // ---------- 島(全体・まわり。2026-11-23 利用者と決めた A2) ----------
  // 今のグループの島はいつものキャンバスそのまま。ほかのグループも、開いたときと同じ位置・見た目・線のまま島として並べる。
  // 島をまたぐ線は、まっすぐ(曲線は使わない)。所属は、親の島の中のグループのノードから、その島の縁への点線。
  setSurround(on: boolean): void {
    this.surround = on;
    this.el.classList.toggle("surround", on);
    this.renderScopeCtl();
    this.renderNow();
  }
  /** 範囲: 0 = このグループ、1 = ＋1、2 = ＋2、Infinity = 全部 */
  scope = 1;
  setScope(n: number): void {
    this.scope = n;
    this.renderScopeCtl();
    this.renderNow();
    this.fitAll();
    this.host.onScopeChange?.(n);
  }
  private scopeCtl: HTMLElement | null = null;
  private renderScopeCtl(): void {
    this.scopeCtl?.remove();
    this.scopeCtl = null;
    if (!this.surround) return;
    const opts: [string, number][] = [[T.scopeThis, 0], ["＋1", 1], ["＋2", 2], [T.scopeAll, Infinity]];
    const ctl = h("div", { class: "scope-ctl", role: "group", "aria-label": T.scopeLabel });
    for (const [label, n] of opts) {
      const b = h("button", { class: "sc-opt" + (this.scope === n ? " on" : ""), text: label, "data-scope": String(n) });
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", () => this.setScope(n));
      ctl.append(b);
    }
    ctl.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.el.append(ctl);
    this.scopeCtl = ctl;
  }

  private islands: { group: string; box: Rect; nodes: { id: string; el: HTMLElement }[] }[] = [];
  private curBox: Rect | null = null;
  private renderOuter(): void {
    this.outerLayer.replaceChildren();
    this.islands = [];
    this.curBox = null;
    if (!this.surround) return;
    const PAD = 28, HEAD = 26;
    // 今の島の箱(中の物がちょうど入る大きさ)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of this.rects.values()) (x0 = Math.min(x0, r.x)), (y0 = Math.min(y0, r.y)), (x1 = Math.max(x1, r.x + r.w)), (y1 = Math.max(y1, r.y + r.h));
    if (!isFinite(x0)) (x0 = y0 = 0), (x1 = 200), (y1 = 80);
    const cur = { x: x0 - PAD, y: y0 - PAD - HEAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 + HEAD };
    this.curBox = cur;
    const curName = h("div", { class: "island-name cur", text: this.group === ROOT_ID ? T.home : this.v.get(this.group)?.title || T.untitledGroup });
    curName.style.left = cur.x + 14 + "px";
    curName.style.top = cur.y + 8 + "px";
    this.outerLayer.append(curName);
    const picks = pickIslands(this.v, this.group, this.scope);
    // ほかの島を作って、大きさを測る
    const built: { group: string; el: HTMLElement; nodes: { id: string; el: HTMLElement }[] }[] = [];
    const sizes = new Map<string, { w: number; h: number }>();
    for (const pk of picks.slice(1)) {
      const items = this.v.itemsOf(pk.group).filter((i) => this.v.exists(i.id));
      let mx = Infinity, my = Infinity;
      for (const i of items) (mx = Math.min(mx, i.x)), (my = Math.min(my, i.y));
      if (!isFinite(mx)) mx = my = 0;
      const el = h("div", { class: "island", "data-ig": pk.group }, h("div", { class: "island-name", text: pk.group === ROOT_ID ? T.home : this.v.get(pk.group)?.title || T.untitledGroup }));
      const nodes: { id: string; el: HTMLElement }[] = [];
      for (const it of items) {
        const n = this.v.get(it.id)!;
        const ne = this.nodeEl(n, it.ref);
        ne.removeAttribute("data-id");
        ne.dataset.oid = it.id;
        ne.dataset.ig = pk.group;
        ne.classList.add("outer");
        ne.style.left = it.x - mx + PAD + "px";
        ne.style.top = it.y - my + PAD + HEAD + "px";
        el.append(ne);
        nodes.push({ id: it.id, el: ne });
      }
      this.outerLayer.append(el);
      let w = 180, hh = 70;
      for (const nd of nodes) (w = Math.max(w, nd.el.offsetLeft + nd.el.offsetWidth + PAD)), (hh = Math.max(hh, nd.el.offsetTop + nd.el.offsetHeight + PAD));
      el.style.width = w + "px";
      el.style.height = hh + "px";
      sizes.set(pk.group, { w, h: hh });
      built.push({ group: pk.group, el, nodes });
    }
    const boxes = placeIslands(picks, cur, sizes);
    for (const b of built) {
      const box = boxes.get(b.group)!;
      b.el.style.left = box.x + "px";
      b.el.style.top = box.y + "px";
      this.islands.push({ group: b.group, box, nodes: b.nodes });
    }
  }

  /** 島どうし・島の中の線(全部まっすぐ)。今の島の中の線は、ふつうの線として別に描いている */
  private drawOuterEdges(): void {
    if (!this.surround || !this.curBox) return;
    const cur = this.curBox;
    this.edgesSvg.append(svg("rect", { class: "island-bg cur", x: cur.x, y: cur.y, width: cur.w, height: cur.h, rx: 24 }));
    // ノードの場所(今の島は rects、ほかの島は島の位置 + ノードの位置)
    const inst = new Map<string, { r: Rect; ig: string }[]>();
    const put = (id: string, r: Rect, ig: string) => (inst.get(id) ?? inst.set(id, []).get(id)!).push({ r, ig });
    for (const [id, r] of this.rects) put(id, r, this.group);
    for (const isl of this.islands)
      for (const nd of isl.nodes) put(nd.id, { x: isl.box.x + nd.el.offsetLeft, y: isl.box.y + nd.el.offsetTop, w: nd.el.offsetWidth, h: nd.el.offsetHeight }, isl.group);
    const line = (a: Rect, b: Rect, cls: string) => {
      const p = this.clip(a, b.x + b.w / 2, b.y + b.h / 2);
      const q = this.clip(b, a.x + a.w / 2, a.y + a.h / 2);
      this.edgesSvg.append(svg("line", { class: cls, x1: p.x, y1: p.y, x2: q.x, y2: q.y }));
    };
    const dist = (a: Rect, b: Rect) => Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
    // 線(リンク)
    const done = new Set<string>();
    for (const [id, list] of inst) {
      const n = this.v.get(id);
      if (!n) continue;
      for (const l of n.links) {
        const tl = inst.get(l.to);
        if (!tl) continue;
        const key = id + ">" + l.to;
        if (done.has(key)) continue;
        done.add(key);
        // 同じ島に両方あれば、その島の中で(今の島どうしは、ふつうの線がもうある)
        let drewSame = false;
        for (const a of list)
          for (const b of tl)
            if (a.ig === b.ig) {
              drewSame = true;
              if (a.ig !== this.group) line(a.r, b.r, "outer-edge k-link");
            }
        if (drewSame) continue;
        let best: [Rect, Rect] | null = null, bd = Infinity;
        for (const a of list) for (const b of tl) if (dist(a.r, b.r) < bd) (bd = dist(a.r, b.r)), (best = [a.r, b.r]);
        if (best) line(best[0], best[1], "outer-edge k-link");
      }
    }
    // 所属: 島の中のグループのノード → そのグループの島の縁(点線)
    const islandBox = new Map<string, Rect>([[this.group, cur], ...this.islands.map((i) => [i.group, i.box] as [string, Rect])]);
    for (const [gid, box] of islandBox) {
      for (const a of inst.get(gid) ?? []) if (a.ig !== gid) line(a.r, box, "outer-edge k-member");
    }
  }

  private outerAt(target: EventTarget | null): string | null {
    return (target as Element | null)?.closest?.<HTMLElement>(".node.outer")?.dataset.oid ?? null;
  }
  /** 外の物を、この画面に引用として置く(ノードの上なら線でつなぐ) */
  private quoteOuterHere(id: string, cx: number, cy: number): void {
    if (this.readOnly || !this.v.exists(id) || id === this.group) return;
    const over = this.nodeAtPoint(cx, cy);
    const p = this.toWorld(cx, cy);
    this.v.tx(() => {
      if (!this.v.itemPos(this.group, id)) this.v.addRef(this.group, id, Math.round(p.x), Math.round(p.y));
      if (over && over !== id) this.v.addLink(over, id);
    });
    this.renderNow();
    this.setSelection([id]);
  }
  private outerMenu(id: string, x: number, y: number): void {
    const items: MenuItem[] = [];
    if (!this.readOnly) items.push({ label: T.outerQuoteHere, action: () => this.quoteOuterHere(id, x, y) });
    const ig = (document.elementFromPoint(x, y) as Element | null)?.closest?.<HTMLElement>(".island")?.dataset.ig;
    if (ig) items.push({ label: T.openIsland, action: () => this.host.openGroup(ig) });
    if (this.host.openBeside) items.push({ label: T.openBeside, action: () => this.host.openBeside!(id) });
    showMenu(x, y, items);
  }

  private signature(n: TDNode, ref: boolean): string {
    return JSON.stringify([n.type, n.title, n.color, n.fill, n.file, ref, n.type === "group" ? this.groupPeek(n.id).subs : null, n.type === "note" ? excerpt(n.body) : !!n.body.trim(), n.card, n.spread]);
  }

  /** グループのノードに見せる中身: 上から 3 件の名前・残りの数・下のグループの数 */
  private groupPeek(id: string): { lines: string[]; more: number; subs: number } {
    const items = this.v
      .itemsOf(id)
      .filter((i) => this.v.exists(i.id))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const nameOf = (i: string) => {
      const n = this.v.get(i)!;
      const t = (n.card ? cardName(n.card) : n.title || T.untitled).replace(/\s+/g, " ");
      return (n.type === "group" ? "▸ " : "") + ([...t].length > 24 ? [...t].slice(0, 24).join("") + "…" : t);
    };
    const lines = items.slice(0, 3).map((i) => nameOf(i.id));
    return { lines, more: Math.max(0, items.length - 3), subs: items.filter((i) => !i.ref && this.v.get(i.id)?.type === "group").length };
  }

  private nodeEl(n: TDNode, ref: boolean): HTMLElement {
    const el = h("div", { class: `node t-${n.type}${n.color ? " c" + n.color : ""}${n.fill ? " f" + n.fill : ""}${ref ? " ref" : ""}`, "data-id": n.id });
    if (ref) el.title = T.refMark;
    if (n.type === "text" && n.file) {
      // 添付: 画像は小さな絵、ほかは 📎 と名前
      el.classList.add("file");
      if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(n.file)) el.append(h("img", { class: "file-img", src: "vault://local/" + n.file.split("/").map(encodeURIComponent).join("/"), alt: n.title, draggable: "false" }));
      el.append(h("span", { class: "label" }, h("span", { class: "clip", text: "📎 " }), n.title || T.untitled));
    } else if (n.type === "text") {
      el.append(h("span", { class: "label", text: n.title || T.untitled }));
      if (n.body.trim()) el.append(h("span", { class: "bodymark", title: T.hasBody, "data-act": "body" }, "¶"));
    } else if (n.type === "note") {
      el.append(
        h("div", { class: "note-head" }, h("span", { class: "ico ico-note" }), h("span", { class: "label", text: n.title || T.untitled })),
        h("div", { class: "excerpt", text: excerpt(n.body) }),
      );
    } else if (n.type === "group") {
      // 下にグループがあれば ▸ で木を出して飛べる(中身の文字は出さない。2026-11-23 利用者)
      const peek = this.groupPeek(n.id);
      el.append(
        h(
          "div",
          { class: "g-head" },
          h("span", { class: "ico ico-folder" }),
          h("span", { class: "label", text: n.title || T.untitledGroup }),
          peek.subs ? h("button", { class: "gtree-btn", "data-act": "tree", title: T.treeTip, "aria-label": T.treeTip, text: "▸" }) : null,
        ),
      );

    } else if (n.type === "card" && n.card) {
      el.style.width = CARD_W + "px";
      el.classList.add("deck-" + n.card.deck);
      el.append(cardFace(n.card, faceHeight(n.card.deck, CARD_FACE_H)));
      el.append(h("div", { class: "label", text: n.card.deck === "tarot" ? cardName(n.card) : n.card.deck === "iching" ? "" : "" }));
      const pos = n.spread?.pos ? spreadDef(n.card.deck, n.spread.spread)?.pos.find((p) => p.id === n.spread!.pos) : undefined;
      if (pos) el.append(h("div", { class: "poslabel", text: pos.name }));
      if (n.body.trim()) el.append(h("span", { class: "bodymark", title: T.hasBody, "data-act": "body" }, "¶"));
    }
    return el;
  }

  private markerDefs(): SVGDefsElement {
    const defs = svg("defs");
    const m = svg("marker", { id: "arrowhead", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" });
    m.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: "marker" }));
    defs.append(m);
    return defs;
  }

  private clip(b: Rect, tx: number, ty: number): { x: number; y: number } {
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
    // スプレッドの囲み枠は出さない(2026-11-23 利用者「枠やっぱりいらない」)
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
    this.drawOuterEdges();
    this.draftLine();
  }

  private renderStrokes(): void {
    this.strokesSvg.replaceChildren();
    for (const s of this.v.strokesOf(this.group)) {
      const d = strokeD(s.p);
      const g = svg("g", { "data-sid": s.id });
      g.append(svg("path", { d, class: "stroke-hit", "data-sid": s.id, "stroke-width": Math.max(14, s.w + 10) }));
      const p = svg("path", { d, class: `stroke col${s.c}${s.hl ? " hl" : ""}${this.strokeSel.has(s.id) ? " selected" : ""}`, "data-sid": s.id, "stroke-width": s.w });
      g.append(p);
      this.strokesSvg.append(g);
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
    ta.addEventListener("input", () => this.draftLine());
    ta.addEventListener("blur", () => {
      if (this.draft?.ta === ta) this.commitDraft("esc");
    });
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.draftLayer.append(ta);
    if (id) this.els.get(id)?.classList.add("editing");
    this.updateSelBar();
    this.draftLine();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  /** 書いている最中の文字と、つなぎ元とのあいだの仮の線(確定前でも線が見えるように) */
  private draftLine(): void {
    this.edgesSvg.querySelector(".draftline")?.remove();
    const d = this.draft;
    if (!d?.parent) return;
    const a = this.rects.get(d.parent);
    if (!a) return;
    const b = { x: d.x, y: d.y, w: Math.max(d.ta.offsetWidth, 40), h: Math.max(d.ta.offsetHeight, 24) };
    const p1 = this.clip(a, b.x + b.w / 2, b.y + b.h / 2);
    const p2 = this.clip(b, a.x + a.w / 2, a.y + a.h / 2);
    this.edgesSvg.append(svg("path", { class: "draftline edge", d: `M${p1.x},${p1.y} L${p2.x},${p2.y}`, fill: "none" }));
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

  /** 書いている文字を確定する。Enter は同じ親のまわりに次、Tab はこのノードのまわりに子 */
  commitDraft(mode: "enter" | "tab" | "esc"): void {
    const d = this.draft;
    if (!d) return;
    this.draft = null;
    d.ta.remove();
    queueMicrotask(() => this.updateSelBar());
    this.edgesSvg.querySelector(".draftline")?.remove();
    const text = d.ta.value.replace(/\s+$/, "");
    let id = d.id;
    try {
      if (id) {
        if (!text.trim()) {
          if (this.v.get(id)?.type === "text") this.deleteItems([id]);
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
    if (id && !d.id && d.parent) this.fitNew(id, d.parent);
    if (!id || mode === "esc") return;
    if (mode === "enter") {
      const parent = d.parent ?? this.parentOf(id);
      const p = this.spot(parent && this.rects.has(parent) ? parent : id);
      this.startEdit(null, p.x, p.y, parent);
    } else {
      const p = this.spot(id);
      this.startEdit(null, p.x, p.y, id);
    }
  }

  /** 書き終えた文字の実際の大きさで、親やほかの物に近すぎ・重なっていたら置き直す(書く前は大きさが分からないため) */
  private fitNew(id: string, parent: string): void {
    const r = this.rects.get(id);
    const a = this.rects.get(parent);
    if (!r || !a) return;
    const others = [...this.obstacles(new Set([id, parent])), ...this.edgeBoxes(id)];
    const boxes = [...this.rects.entries()].filter(([i]) => i !== id && i !== parent).map(([, b]) => b);
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const myLineHits = boxes.some((b) => segHitsRect(ac.x, ac.y, r.x + r.w / 2, r.y + r.h / 2, b));
    if (gap(r, a) >= 30 && others.every((o) => gap(r, o) >= 16) && !myLineHits) return;
    const p = placeAround(a, others, { size: { w: r.w, h: r.h }, lineBlockers: boxes });
    this.v.move(this.group, [{ id, x: Math.round(p.x), y: Math.round(p.y) }]);
    this.renderNow();
  }

  /** anchor のまわりで、ほかと一番離れる所(2026-11-22 利用者の希望。core/placement.ts) */
  spot(anchor: string): { x: number; y: number } {
    const a = this.rects.get(anchor)!;
    const others = [...this.rects.entries()].filter(([i]) => i !== anchor).map(([, r]) => r);
    others.push(...this.v.strokesOf(this.group).map(strokeBox), ...this.edgeBoxes());
    const boxes = [...this.rects.entries()].filter(([i]) => i !== anchor).map(([, r]) => r);
    return placeAround(a, others, { size: { w: 90, h: Math.min(40, a.h) }, lineBlockers: boxes });
  }

  /** つなぎの線を、小さな箱の並びとして表す(Tab で置く文字が線にかぶらないように)。except につながる線は除く */
  private edgeBoxes(except?: string): Rect[] {
    const out: Rect[] = [];
    for (const [id, a] of this.rects) {
      for (const l of this.v.get(id)!.links) {
        const b = this.rects.get(l.to);
        if (!b || id === except || l.to === except) continue;
        const p1 = this.clip(a, b.x + b.w / 2, b.y + b.h / 2);
        const p2 = this.clip(b, a.x + a.w / 2, a.y + a.h / 2);
        const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 20));
        for (let k = 0; k <= n; k++) out.push({ x: p1.x + ((p2.x - p1.x) * k) / n - 3, y: p1.y + ((p2.y - p1.y) * k) / n - 3, w: 6, h: 6 });
      }
    }
    return out;
  }

  /** いま置いてあるもの(ノードとペンの線)の箱 */
  obstacles(except: Set<string> = new Set()): Rect[] {
    return [...[...this.rects.entries()].filter(([i]) => !except.has(i)).map(([, r]) => r), ...this.v.strokesOf(this.group).map(strokeBox)];
  }

  /** このキャンバスで、このノードに線を引いているノード */
  private parentOf(id: string): string | null {
    for (const pid of this.rects.keys()) {
      if (pid !== id && this.v.get(pid)!.links.some((l) => l.to === id)) return pid;
    }
    return null;
  }

  /** 右の欄のボタンから: from につながった文字を置く。edit なら、その場で書き始める */
  addConnected(from: string, text: string, edit: boolean): void {
    if (!this.rects.has(from)) return;
    const p = this.spot(from);
    if (edit) {
      this.startEdit(null, p.x, p.y, from, text);
      return;
    }
    const id = this.v.tx(() => {
      const n = this.v.create({ type: "text", title: text, group: this.group, x: p.x, y: p.y });
      this.v.addLink(from, n.id);
      return n.id;
    });
    this.renderNow();
    this.setSelection([id]);
  }

  // ---------- 操作 ----------
  private nodeAt(target: EventTarget | null): string | null {
    const el = (target as Element | null)?.closest?.(".node");
    return el?.getAttribute("data-id") ?? null;
  }
  private strokeAt(target: EventTarget | null): string | null {
    const el = (target as Element | null)?.closest?.("[data-sid]");
    return el?.getAttribute("data-sid") ?? null;
  }
  /** 反対側からのドラッグで、落とす先のノードに印を付ける(null で外す) */
  markDropOut(id: string | null): void {
    for (const [i, el] of this.els) el.classList.toggle("droptarget-out", i === id);
  }
  nodeAtPoint(cx: number, cy: number, exclude: Set<string> = new Set()): string | null {
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
      if (this.pen.on) return;
      // ほかの島: その島のグループを開いて編集できるように
      const isl = (e.target as Element).closest?.<HTMLElement>(".island");
      if (isl?.dataset.ig) {
        e.preventDefault();
        return this.host.openGroup(isl.dataset.ig);
      }
      const id = this.nodeAt(e.target);
      if (!id) return;
      e.preventDefault();
      if (this.readOnly) {
        const n = this.v.get(id);
        if (n?.type === "group") this.host.openGroup(id);
        return;
      }
      this.open(id, e.target as Element);
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
      const id = this.nodeAt(e.target);
      this.host.cardHover(id && this.v.get(id)?.type === "card" && !this.drag && !this.pen.on ? id : null, e);
    });
    el.addEventListener("mouseleave", () => this.host.cardHover(null));
    // ファイルを落とすと、その場所に添付
    el.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    });
    el.addEventListener("drop", (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      const p = this.toWorld(e.clientX, e.clientY);
      void this.attachFilesAt(e.dataTransfer.files, p.x, p.y);
    });
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 2) return;
    this.host.cardHover(null);
    const oid = this.outerAt(e.target);
    if (oid && !this.pen.on) {
      this.drag = e.button === 0 ? { kind: "outer", id: oid, sx: e.clientX, sy: e.clientY, moved: false } : { kind: "right-empty", sx: e.clientX, sy: e.clientY };
      if (e.button === 2) (this.drag as { outerMenu?: string }).outerMenu = oid;
      this.el.focus({ preventScroll: true });
      return;
    }
    const edge = (e.target as Element).closest?.(".edge");
    const id = this.nodeAt(e.target);
    const sid = id ? null : this.strokeAt(e.target);
    const ctrl = e.ctrlKey;
    if (e.button === 0 && this.pen.on) {
      // ペンモード: 左ドラッグで描く・消す(ノードの上でも)
      this.commitDraft("esc");
      if (this.pen.tool === "eraser") {
        this.drag = { kind: "erase", hit: new Set() };
        this.onMove(e);
      } else {
        const p = this.toWorld(e.clientX, e.clientY);
        const path = svg("path", { class: `stroke live col${this.pen.color}${this.pen.tool === "hl" ? " hl" : ""}`, "stroke-width": this.strokeWidth() });
        this.strokesSvg.append(path);
        this.drag = { kind: "draw", pts: [Math.round(p.x), Math.round(p.y)], path };
        path.setAttribute("d", strokeD(this.drag.pts));
      }
      e.preventDefault();
      return;
    }
    if (e.button === 0) {
      if (edge) return; // 線の左クリックは何もしない(メニューは右クリック)
      if (id) this.drag = { kind: "node-press", id, sx: e.clientX, sy: e.clientY, ctrl, target: e.target as Element, wasSelected: this.selection.size === 1 && this.selection.has(id) };
      else if (sid) this.drag = { kind: "stroke-press", id: sid, sx: e.clientX, sy: e.clientY, ctrl };
      else this.drag = { kind: "empty-press", sx: e.clientX, sy: e.clientY, ctrl };
    } else {
      if (id) this.drag = { kind: "right-node", id, sx: e.clientX, sy: e.clientY };
      else if (sid) this.drag = { kind: "right-stroke", id: sid, sx: e.clientX, sy: e.clientY };
      else this.drag = { kind: "right-empty", sx: e.clientX, sy: e.clientY };
    }
    if (!this.draft) this.el.focus({ preventScroll: true });
  }

  private strokeWidth(): number {
    return this.pen.tool === "hl" ? Math.max(8, this.pen.width * 3) : this.pen.width;
  }

  private startMove(ids: string[], strokes: string[], sx: number, sy: number): void {
    this.commitDraft("esc");
    const start = new Map(ids.filter((i) => this.rects.has(i)).map((i) => [i, { x: this.rects.get(i)!.x, y: this.rects.get(i)!.y }]));
    this.drag = { kind: "move", ids: [...start.keys()], strokes, sx, sy, start, dx: 0, dy: 0 };
    for (const i of ids) this.els.get(i)?.classList.add("moving");
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const far = "sx" in d && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_START;
    switch (d.kind) {
      case "draw": {
        const p = this.toWorld(e.clientX, e.clientY);
        const n = d.pts.length;
        if (Math.hypot(p.x - d.pts[n - 2], p.y - d.pts[n - 1]) * this.view.z < 2) return;
        d.pts.push(Math.round(p.x), Math.round(p.y));
        d.path.setAttribute("d", strokeD(d.pts));
        return;
      }
      case "erase": {
        const p = this.toWorld(e.clientX, e.clientY);
        for (const s of this.v.strokesOf(this.group)) {
          if (d.hit.has(s.id) || !nearStroke(s, p.x, p.y, 6 / this.view.z)) continue;
          d.hit.add(s.id);
          this.strokesSvg.querySelector(`g[data-sid="${s.id}"]`)?.remove();
        }
        return;
      }
      case "node-press": {
        if (!far) return;
        this.commitDraft("esc");
        const line = svg("line", { class: "linkdrag" });
        this.edgesSvg.append(line);
        this.drag = { kind: "link", from: d.id, line };
        this.onMove(e);
        return;
      }
      case "stroke-press":
      case "empty-press": {
        if (!far) return;
        this.commitDraft("esc");
        const box = h("div", { class: "rubber" });
        this.el.append(box);
        this.drag = { kind: "rubber", sx: d.sx, sy: d.sy, box, base: d.ctrl ? new Set(this.selection) : new Set(), baseStrokes: d.ctrl ? new Set(this.strokeSel) : new Set() };
        this.onMove(e);
        return;
      }
      case "right-node": {
        if (!far) return;
        if (this.readOnly) {
          this.drag = { kind: "pan", sx: d.sx, sy: d.sy, vx: this.view.x, vy: this.view.y };
          return;
        }
        const sel = this.selection.has(d.id);
        if (!sel) this.setSelection([d.id]);
        this.startMove(sel ? [...this.selection] : [d.id], sel ? [...this.strokeSel] : [], d.sx, d.sy);
        return;
      }
      case "right-stroke": {
        if (!far) return;
        const sel = this.strokeSel.has(d.id);
        if (!sel) this.setSelection([], [d.id]);
        this.startMove(sel ? [...this.selection] : [], sel ? [...this.strokeSel] : [d.id], d.sx, d.sy);
        return;
      }
      case "right-empty": {
        if (!far) return;
        this.drag = { kind: "pan", sx: d.sx, sy: d.sy, vx: this.view.x, vy: this.view.y };
        this.el.classList.add("panning");
        return;
      }
      case "outer": {
        if (!far && !d.moved) return;
        d.moved = true;
        const out = !this.inside(e) && !!this.host.dragOutside?.([d.id], e.clientX, e.clientY, true);
        this.dragGhost([d.id], e, true);
        const over = out || this.readOnly ? null : this.nodeAtPoint(e.clientX, e.clientY);
        for (const [i, el] of this.els) el.classList.toggle("droptarget", i === over);
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
        const out = !this.inside(e) && !!this.host.dragOutside?.([d.from], e.clientX, e.clientY, true);
        d.line.style.display = out ? "none" : "";
        this.dragGhost(out ? [d.from] : null, e, true);
        const over = out ? null : this.nodeAtPoint(e.clientX, e.clientY, new Set([d.from]));
        for (const [i, el] of this.els) el.classList.toggle("droptarget", i === over);
        return;
      }
      case "rubber": {
        const r = this.el.getBoundingClientRect();
        const x0 = Math.min(d.sx, e.clientX), y0 = Math.min(d.sy, e.clientY);
        const x1 = Math.max(d.sx, e.clientX), y1 = Math.max(d.sy, e.clientY);
        Object.assign(d.box.style, { left: x0 - r.left + "px", top: y0 - r.top + "px", width: x1 - x0 + "px", height: y1 - y0 + "px" });
        const a = this.toWorld(x0, y0), b = this.toWorld(x1, y1);
        const hit = (q: Rect) => q.x < b.x && q.x + q.w > a.x && q.y < b.y && q.y + q.h > a.y;
        const sel = new Set(d.base);
        for (const [i, q] of this.rects) if (hit(q)) sel.add(i);
        const ss = new Set(d.baseStrokes);
        for (const s of this.v.strokesOf(this.group)) if (hit(strokeBox(s))) ss.add(s.id);
        this.setSelection(sel, ss);
        return;
      }
      case "move": {
        const dx = (e.clientX - d.sx) / this.view.z, dy = (e.clientY - d.sy) / this.view.z;
        d.dx = dx;
        d.dy = dy;
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
        for (const sid of d.strokes) this.strokesSvg.querySelector(`g[data-sid="${sid}"]`)?.setAttribute("transform", `translate(${dx},${dy})`);
        this.renderEdges();
        const out = !this.inside(e) && d.ids.length > 0 && !!this.host.dragOutside?.(d.ids, e.clientX, e.clientY, false);
        this.dragGhost(out ? d.ids : null, e, false);
        const over = d.ids.length && !out ? this.nodeAtPoint(e.clientX, e.clientY, new Set(d.ids)) : null;
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
    this.dragGhost(null, e, false);
    this.host.dragOutside?.([], null, 0, false);
    switch (d.kind) {
      case "draw": {
        d.path.remove();
        if (d.pts.length >= 2) {
          this.v.addStroke(this.group, { c: this.pen.color, w: this.strokeWidth(), hl: this.pen.tool === "hl" ? true : undefined, p: d.pts });
        }
        return;
      }
      case "erase":
        if (d.hit.size) this.v.removeStrokes(this.group, [...d.hit]);
        return;
      case "outer": {
        if (!d.moved) {
          for (const el of this.outerLayer.children) el.classList.toggle("selected", (el as HTMLElement).dataset.oid === d.id && !el.classList.contains("selected"));
          return;
        }
        if (!this.inside(e)) {
          this.host.dropOutside?.([d.id], e.clientX, e.clientY, true);
          return;
        }
        return this.quoteOuterHere(d.id, e.clientX, e.clientY);
      }
      case "node-press":
        if (this.readOnly) return this.setSelection([d.id]);
        return this.clickNode(d.id, d.ctrl, d.target, d.wasSelected);
      case "stroke-press": {
        if (d.ctrl) {
          const s = new Set(this.strokeSel);
          if (s.has(d.id)) s.delete(d.id);
          else s.add(d.id);
          this.setSelection(this.selection, s);
        } else this.setSelection([], [d.id]);
        return;
      }
      case "empty-press": {
        // ほかの島の空きでは書き始めない(書くのは今の島)
        if ((e.target as Element).closest?.(".island")) return this.setSelection([]);
        if (d.ctrl || this.readOnly) return this.readOnly ? this.setSelection([]) : undefined;
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
        if (this.readOnly) return;
        if (!this.selection.has(d.id)) this.setSelection([d.id]);
        return this.nodeMenu(d.id, e.clientX, e.clientY);
      }
      case "right-stroke": {
        if (!this.strokeSel.has(d.id)) this.setSelection([], [d.id]);
        return this.strokeMenu(e.clientX, e.clientY);
      }
      case "right-empty": {
        const om = (d as { outerMenu?: string }).outerMenu;
        if (om) return this.outerMenu(om, e.clientX, e.clientY);
        if (this.readOnly) return;
        const edge = (e.target as Element).closest?.(".edge");
        if (edge) return this.edgeMenu(edge.getAttribute("data-from")!, edge.getAttribute("data-to")!, e.clientX, e.clientY);
        return this.emptyMenu(e.clientX, e.clientY);
      }
      case "link": {
        d.line.remove();
        if (!this.inside(e) && this.host.dropOutside?.([d.from], e.clientX, e.clientY, true)) return;
        if (this.readOnly) return;
        const over = this.nodeAtPoint(e.clientX, e.clientY, new Set([d.from]));
        if (over) this.v.toggleLink(d.from, over);
        else {
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

  /**
   * 文字: 1 回クリックですぐ書き直す(選ぶだけなら Ctrl+クリックか範囲選択)。
   * グループ・ノート・カード: 1 回目 = 選ぶ、選んであるものをもう一度 = 開く。
   */
  private clickNode(id: string, ctrl: boolean, target: Element, wasSelected: boolean): void {
    if (ctrl) {
      const s = new Set(this.selection);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      this.setSelection(s, this.strokeSel);
      return;
    }
    const node = this.v.get(id);
    if (!node) return;
    if (target.closest("[data-act=tree]")) {
      this.setSelection([id]);
      return this.host.groupTree?.(id, target.closest("[data-act=tree]")!);
    }
    if (target.closest("[data-act=body]")) {
      this.setSelection([id]);
      return this.host.openBody(id);
    }
    if (node.type === "text" && !node.file) {
      this.setSelection([id]);
      return this.open(id, target);
    }
    if (!wasSelected) {
      this.setSelection([id]);
      return;
    }
    this.open(id, target);
  }

  /** 開く: 文字は書き直し、グループは中へ、ノート・カードは本文 */
  open(id: string, _target?: Element): void {
    const n = this.v.get(id);
    if (!n) return;
    if (n.type === "group") return this.host.openGroup(id);
    if (n.type === "text" && n.file) return this.host.openFile?.(n.file);
    if (n.type === "text") {
      const r = this.rects.get(id);
      if (r) this.startEdit(id, r.x, r.y, null, n.title);
      return;
    }
    // 本文はノートだけ(2026-11-23 利用者)。カードは選ぶと右の欄に詳細が出る
    if (n.type === "note" || n.body.trim()) this.host.openBody(id);
    else this.setSelection([id]);
  }

  /** 反対側の画面へドラッグしている間、カーソルに付いてくる札(何がどうなるかを書く) */
  private ghost: HTMLElement | null = null;
  private dragGhost(ids: string[] | null, e: { clientX: number; clientY: number }, link: boolean): void {
    if (!ids) {
      this.ghost?.remove();
      this.ghost = null;
      return;
    }
    if (!this.ghost) {
      const first = this.v.get(ids[0]);
      const name = first ? (first.card ? cardName(first.card) : first.title || T.untitled) : "";
      this.ghost = h("div", { class: "drag-ghost" }, h("b", { text: ids.length > 1 ? T.dragMany(name, ids.length) : name }), h("span", { class: "dg-hint" }));
      document.body.append(this.ghost);
    }
    this.ghost.style.left = e.clientX + 14 + "px";
    this.ghost.style.top = e.clientY + 12 + "px";
    const hint = this.ghost.querySelector(".dg-hint")!;
    const overNode = document.querySelector(".canvas .node.droptarget-out");
    hint.textContent = link && overNode ? T.dragQuoteLink : T.dragQuote;
  }

  private inside(e: { clientX: number; clientY: number }): boolean {
    const r = this.el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  private endMove(d: Extract<Drag, { kind: "move" }>, e: PointerEvent): void {
    if (!this.inside(e) && d.ids.length && this.host.dropOutside?.(d.ids, e.clientX, e.clientY, false)) {
      this.renderNow(); // こちらの位置は元のまま
      return;
    }
    const over = d.ids.length ? this.nodeAtPoint(e.clientX, e.clientY, new Set(d.ids)) : null;
    const positions = d.ids.map((i) => ({ id: i, x: Math.round(this.rects.get(i)!.x), y: Math.round(this.rects.get(i)!.y) }));
    if (!over) {
      this.v.tx(() => {
        if (positions.length) this.v.move(this.group, positions);
        this.v.moveStrokes(this.group, d.strokes, Math.round(d.dx), Math.round(d.dy));
      });
      this.renderNow();
      return;
    }
    const target = this.v.get(over)!;
    try {
      if (target.type === "group") {
        // グループの上に重ねた: そのグループへ移す(引用は引用のまま)
        this.v.tx(() => {
          let k = 0;
          const inside = this.v.itemsOf(over);
          const baseY = inside.reduce((a, m) => Math.max(a, m.y + 60), 0);
          for (const i of d.ids) this.v.moveToGroup(this.group, over, i, (k % 5) * 160, baseY + Math.floor(k++ / 5) * 60);
          this.v.moveStrokes(this.group, d.strokes, Math.round(d.dx), Math.round(d.dy));
        });
        toast(T.movedInto(target.title || T.untitledGroup));
      } else {
        // 普通のノードの上に重ねた: その場でグループになる
        const tpos = this.v.itemPos(this.group, over)!;
        const g = this.v.tx(() => {
          const g = this.v.bundle(this.group, [over, ...d.ids], "", d.strokes);
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
    const n = this.v.get(id)!;
    this.startEdit(id, r.x, r.y, null, n.title);
    this.draft!.ta.classList.add("for-group");
  }

  /** 消す: 引用はこのグループから外すだけ(元のノードは消さない)。引用でないものはゴミ箱へ */
  deleteItems(ids: string[], tell = false): void {
    const refs = ids.filter((i) => this.v.isRefIn(this.group, i));
    const own = ids.filter((i) => !refs.includes(i));
    this.v.tx(() => {
      for (const i of refs) this.v.removeRef(this.group, i);
      if (own.length) this.v.trash(own);
    });
    if (!tell) return;
    if (own.length) toast(T.trashed(own.length) + (refs.length ? T.refsRemoved(refs.length) : ""));
    else if (refs.length) toast(T.refsRemoved(refs.length));
  }

  // ---------- キー ----------
  handleKey(e: KeyboardEvent): boolean {
    if (this.draft) return false;
    if (this.readOnly) return e.ctrlKey && e.key === "0" ? (this.fitAll(), true) : false;
    const ids = [...this.selection];
    const k = e.key.toLowerCase();
    if (e.key === "Escape" && this.pen.on) return false; // ペンモードを抜けるのは app
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!ids.length && !this.strokeSel.size) return false;
      this.v.tx(() => {
        this.deleteItems(ids, true);
        this.v.removeStrokes(this.group, [...this.strokeSel]);
      });
      return true;
    }
    if (e.ctrlKey && k === "a") {
      this.setSelection(this.rects.keys(), this.v.strokesOf(this.group).map((s) => s.id));
      return true;
    }
    if (e.ctrlKey && k === "g") {
      this.bundleSelection();
      return true;
    }
    if (e.ctrlKey && k === "l") {
      this.linkBySearch();
      return true;
    }
    if (e.ctrlKey && e.key === "0") {
      this.fitAll();
      return true;
    }
    if (e.key === "Enter" && ids.length === 1) {
      this.open(ids[0]);
      return true;
    }
    return false;
  }

  bundleSelection(): void {
    const ids = [...this.selection];
    const strokes = [...this.strokeSel];
    if (!ids.length && !strokes.length) return;
    const g = this.v.bundle(this.group, ids, "", strokes);
    this.renderNow();
    this.setSelection([g.id]);
    this.renameGroup(g.id);
  }

  /**
   * Ctrl+L: 検索してリンクをポンと入れる。
   * 1 つ選んでいれば、選んだものと線でつなぐ(このキャンバスに無いものは、引用として近くに置いてから)。
   * 何も選んでいなければ、画面の真ん中に引用として置く。
   */
  async linkBySearch(): Promise<void> {
    const from = this.selection.size === 1 ? [...this.selection][0] : null;
    const r = await openPicker(this.v, { title: from ? T.pickLinkTitle : T.pickRefTitle, mode: "node", exclude: (n) => n.id === from || n.id === this.group });
    if (!r || !("id" in r)) return;
    const to = r.id;
    if (this.rects.has(to)) {
      if (from) this.v.addLink(from, to);
      else this.centerOn(to);
      return;
    }
    const p = from ? this.spot(from) : (() => { const c = this.visibleCenter(); return { x: Math.round(c.x - 40), y: Math.round(c.y - 12) }; })();
    this.v.tx(() => {
      this.v.addRef(this.group, to, p.x, p.y);
      if (from) this.v.addLink(from, to);
    });
    this.renderNow();
    this.setSelection([to]);
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

  /** 文字の背景の色 */
  private fillItem(ids: string[]): MenuItem {
    const cur = this.v.get(ids[0])?.fill ?? 0;
    const set = (c: number) => this.v.tx(() => ids.forEach((i) => this.v.update(i, { fill: c })));
    return {
      label: T.fill,
      swatches: Array.from({ length: PRESET_COLORS + 1 }, (_, c) => ({ color: c, title: c ? `${T.fill} ${c}` : T.fillNone, active: c === cur, action: () => set(c) })),
    };
  }

  /** ノードの右クリック(2026-11-23 利用者と決めた): 一番上に、よく使う操作を絵と名前の大きなボタンで横に並べ、
   * その下に色の見本、そのあと「グループ」の操作を見出し付きで。ショートカットは右に小さく */
  private nodeMenu(id: string, x: number, y: number): void {
    const n = this.v.get(id);
    if (!n) return;
    const ids = this.selection.has(id) ? [...this.selection] : [id];
    const isRef = this.v.isRefIn(this.group, id);
    const allRefs = ids.every((i) => this.v.isRefIn(this.group, i));
    const many = ids.length > 1;
    // よく使う操作(横に並べる)
    const bar: NonNullable<MenuItem["bar"]> = [];
    if (!many) {
      if (n.type === "group") bar.push({ icon: "open", label: T.mOpen, title: T.openGroup, action: () => this.host.openGroup(id) });
      else if (n.type === "text" && n.file) bar.push({ icon: "open", label: T.mOpen, title: T.openFile, action: () => this.host.openFile?.(n.file!) });
      else if (n.type === "text") bar.push({ icon: "edit", label: T.mEdit, title: T.editText, action: () => this.editText(id) });
      else if (n.type === "note") bar.push({ icon: "open", label: T.mOpen, title: T.openNote, action: () => this.host.openBody(id) });
      else bar.push({ icon: "open", label: T.mOpen, action: () => this.open(id) });
    }
    bar.push({ icon: "link", label: T.linkShort, title: T.linkSearch + " (Ctrl+L)", action: () => this.linkBySearch() });
    bar.push({ icon: "bundle", label: T.bundleShort, title: T.bundle + " (Ctrl+G)", action: () => this.bundleSelection() });
    if (this.host.openBeside && !many) bar.push({ icon: "beside", label: T.mBeside, title: T.openBeside, action: () => this.host.openBeside!(id) });
    bar.push({ icon: "trash", label: T.deleteShort, title: (allRefs ? T.deleteRef : T.delete) + " (Delete)", danger: true, action: () => this.deleteItems(ids, true) });

    const items: MenuItem[] = [{ label: "", bar }];
    if (many) items.unshift({ label: T.selCount(ids.length), heading: true });
    // 色
    items.push(this.colorItem(ids));
    if (ids.every((i) => this.v.get(i)?.type === "text" && !this.v.get(i)?.file)) items.push(this.fillItem(ids));
    // このノードだけのこと
    const own: MenuItem[] = [];
    if (!many && n.type === "group") own.push({ label: T.rename, action: () => this.renameGroup(id) }, { label: T.unbundle, action: () => this.v.unbundle(id) });
    if (!many && n.type === "text" && n.file) own.push({ label: T.rename, action: () => this.editText(id) });
    if (!many && n.type === "card" && n.card?.deck === "tarot") own.push({ label: T.cardFlip, checked: n.card.reversed, action: () => this.v.setCard(id, { ...n.card!, reversed: !n.card!.reversed }) });
    if (own.length) items.push({ separator: true, label: "" }, ...own);
    // グループ(入れる・引用する・外す)
    items.push({ label: T.mGroupHead, heading: true });
    if (isRef && !many) items.push({ label: T.goOrigin, action: () => this.host.goToNode(id) });
    items.push(...this.groupMenuItems(ids));
    if (allRefs) items.push({ label: T.removeRef, action: () => this.v.tx(() => ids.forEach((i) => this.v.removeFromGroup(this.group, i))) });
    else
      items.push({
        label: T.removeFromGroup,
        action: () => {
          let refused = false;
          this.v.tx(() => ids.forEach((i) => (refused = !this.v.removeFromGroup(this.group, i) || refused)));
          if (refused && this.group === ROOT_ID) toast(T.rootLastParent);
        },
      });
    showMenu(x, y, items);
  }

  /** ほかのグループへ入れる・引用する(選んだときのバーの「グループへ」) */
  private groupMenuItems(ids: string[]): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: T.addToGroup,
        action: async () => {
          const g = await this.host.pickGroup(T.pickGroupTitle);
          if (!g) return;
          try {
            this.v.tx(() => ids.forEach((i, k) => this.v.addToGroup(g, i, (k % 5) * 160, 40 + Math.floor(k / 5) * 60)));
            toast(T.addedInto(this.v.get(g)?.title || T.untitledGroup));
          } catch (err) {
            if (err instanceof CycleError) toast(T.cycleRefused);
            else throw err;
          }
        },
      },
      {
        label: T.quoteInto,
        action: async () => {
          const g = await this.host.pickGroup(T.pickQuoteTitle);
          if (!g) return;
          this.v.tx(() => ids.forEach((i, k) => this.v.addRef(g, i, (k % 5) * 160, 40 + Math.floor(k / 5) * 60)));
          toast(T.quotedInto(this.v.get(g)?.title || T.untitledGroup));
        },
      },
    ];
    if (this.host.quoteToOther && this.host.hasOther?.()) items.push({ label: T.quoteToOther, action: () => this.host.quoteToOther!(ids) });
    return items;
  }

  /** (上に出るバーはやめた。2026-11-23 利用者「上に出るのも違う」。操作は右クリックへ) */
  private updateSelBar(): void {}

  /** 文字を書き直す(添付の文字も、名前を書き直せる) */
  private editText(id: string): void {
    const r = this.rects.get(id);
    const n = this.v.get(id);
    if (r && n) this.startEdit(id, r.x, r.y, null, n.title);
  }

  // ---------- 添付(ボードにも。2026-11-23 利用者) ----------
  /** ファイルを、その場所に添付の文字として置く(画像は小さな絵で見せる)。いくつかなら少しずつずらす */
  async attachFilesAt(files: FileList | File[] | undefined, x: number, y: number): Promise<void> {
    const list = [...(files ?? [])];
    if (!list.length) return;
    const made: string[] = [];
    for (const [k, f] of list.entries()) {
      const data = new Uint8Array(await f.arrayBuffer());
      const rel = await api().saveAttachment(f.name || "file", data);
      const id = this.v.create({ type: "text", title: f.name || "file", group: this.group, x: Math.round(x + k * 24), y: Math.round(y + k * 24), file: rel }).id;
      made.push(id);
    }
    this.renderNow();
    this.setSelection(made);
    toast(T.attached(made.length));
  }
  pickFilesAt(x: number, y: number): void {
    const input = h("input", { type: "file", multiple: "" }) as HTMLInputElement;
    input.addEventListener("change", () => void this.attachFilesAt(input.files ?? undefined, x, y));
    input.click();
  }

  private strokeMenu(x: number, y: number): void {
    showMenu(x, y, [
      { label: T.bundle, action: () => this.bundleSelection() },
      { label: T.strokeDelete, action: () => this.v.removeStrokes(this.group, [...this.strokeSel]) },
    ]);
  }

  /** 空きの右クリック: 作るものだけ(全部選ぶ・全体を見るは Ctrl+A・Ctrl+0) */
  private emptyMenu(x: number, y: number): void {
    const p = this.toWorld(x, y);
    const px = Math.round(p.x), py = Math.round(p.y);
    const extra = this.host.extraEmptyMenu?.(this.group, px, py) ?? [];
    showMenu(x, y, [
      { label: T.newText, action: () => this.startEdit(null, px, py, null) },
      {
        // 空のグループを作って、その場で名前を書く(2026-11-23 利用者の希望)
        label: T.newGroup,
        action: () => {
          const n = this.v.create({ type: "group", title: "", group: this.group, x: px, y: py });
          this.renderNow();
          this.setSelection([n.id]);
          this.renameGroup(n.id);
        },
      },
      {
        label: T.newNote,
        action: () => {
          const n = this.v.create({ type: "note", title: "", group: this.group, x: px, y: py });
          this.renderNow();
          this.setSelection([n.id]);
          this.host.openBody(n.id);
        },
      },
      { label: T.attachHere, action: () => this.pickFilesAt(px, py) },
      {
        label: T.quoteHere,
        action: () => {
          this.setSelection([]);
          this.linkBySearch();
        },
      },
      ...(extra.length ? [{ separator: true, label: "" }, { label: T.dayRecords, sub: extra.slice(1) }] : []),
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
}
