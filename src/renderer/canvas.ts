// 無限キャンバス(SPEC 4.2)。1 つのグループの中身(所属 + 引用)とペンの線を描き、操作をデータの操作に翻訳する。
import { gap, placeAround, segHitsRect, type Rect } from "../core/placement";
import { CARD_H, CARD_W } from "../core/spreadLayout";
import { CycleError, type Vault } from "../core/vault";
import { NEW_LINK_KINDS, noteKind, ROOT_ID, type Link, type LinkKind, type Stroke, type TDNode } from "../core/types";
import { edgeEnds, findHops, kindPreview, partEnd, pointAlong, polyPath, routeAround, type Pt, type Seg } from "./edgeshape";
import { cardDef, cardName, spreadDef } from "../decks";
import { openCardSearch } from "./tarot";
import { PROMPT_BY_ID } from "../decks/prompts";
import { cardFace, faceHeight } from "./cardface";
import { openPicker } from "./picker";
import { PT, T } from "./strings";
import { paperStore } from "./paperstore";
import { makeChecklist, makeTable, renderBodyDom, schema as mdSchema, serializeMarkdown, toggleTask } from "./mdschema";
import { api, askText, h, showMenu, svg, toast, type MenuItem } from "./ui";
import { pickIslands, placeIslands, type IslandPick } from "../core/islands";
import { bodyLinkTargets } from "../core/links";
import { selectionToMarkdown } from "../core/export";
import { autoGroupTitle } from "../core/grouptitle";
import { anchorText, citeOf, parseCite } from "../core/cite";
import { currentClip, setClip, type PassageClip } from "./clip";
import { allTags, splitTags } from "../core/tags";

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
  /** チェックリスト・表のノートを、キャンバスの上でそのまま書く(mount の中に編集欄を作る) */
  editInline?(id: string, mount: HTMLElement, onClose: () => void): { close(): void; focus(): void };
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
  /** 紙PKM のページを開く(内部ID) */
  openPaper?(pid: string): void;
  /** グループの ▸: 下のグループの木を出す */
  groupTree?(id: string, anchor: Element): void;
  /** 空きの右クリックに足す項目(日のグループでの記録の作成など)。x, y は置く位置 */
  extraEmptyMenu?(group: string, x: number, y: number): MenuItem[];
  /** 横の画面に開く(グループはその中、ほかは所属先で、そのノードを見せる) */
  /** 新しいタブで開く(2026-11-24。前は「横に開く」) */
  openBeside?(id: string): void;
  /** 中ボタン: 後ろのタブで開く */
  openTabBehind?(id: string): void;
  /** 引用の「飛ぶ」: 元の場所へ(同じボードなら、そこを見せる)。from = 押した引用 */
  jump?(target: string, from: string): void;
  /** 線の種類ごとのいつもの色(0 = 決めていない) */
  kindColor?(kind: LinkKind): number;
  /** 線の設定の画面(種類ごとのいつもの色) */
  openLineSettings?(): void;
  /** ノートの文章を引用するとき、ノートのその所に目印を付ける(付けられなければ null)。2026-11-26 修正14 */
  anchorPassage?(c: PassageClip): string | null;
  /** ノートの文章の引用を押した: そのノートのその所を開く */
  openCite?(note: string, anchor: string): void;
  /** @ を打ったときの候補(時系列記録のしるし・種類と同じ) */
  tagCandidates?(): string[];
}

interface Draft {
  id: string | null; // null = まだ作っていない
  x: number;
  y: number;
  parent: string | null; // 確定したとき、ここから線を引く
  ta: HTMLTextAreaElement;
  /** 親の左に置いたとき: 右の端をここに留め、左へ伸ばす(親にかぶらないように) */
  right?: number;
}

type Drag =
  | { kind: "node-press"; id: string; sx: number; sy: number; ctrl: boolean; target: Element; wasSelected: boolean }
  | { kind: "stroke-press"; id: string; sx: number; sy: number; ctrl: boolean }
  | { kind: "empty-press"; sx: number; sy: number; ctrl: boolean; shift?: boolean }
  | { kind: "right-node"; id: string; sx: number; sy: number }
  | { kind: "right-stroke"; id: string; sx: number; sy: number }
  | { kind: "right-empty"; sx: number; sy: number }
  | { kind: "link"; from: string; line: SVGLineElement }
  | { kind: "rubber"; sx: number; sy: number; box: HTMLElement; base: Set<string>; baseStrokes: Set<string>; edges?: Set<string>; baseEdges: Set<string> }
  | { kind: "move"; ids: string[]; strokes: string[]; sx: number; sy: number; start: Map<string, { x: number; y: number }>; dx: number; dy: number }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "draw"; pts: number[]; path: SVGPathElement }
  | { kind: "erase"; hit: Set<string> }
  | { kind: "outer"; id: string; sx: number; sy: number; moved: boolean }
  | { kind: "resize"; id: string; sx: number; sy: number; w: number; h: number }
  | { kind: "edge-press"; key: string; sx: number; sy: number; ctrl: boolean; label: boolean }
  | { kind: "label-drag"; key: string }
  | { kind: "grp-resize"; id: string; corner: string; sx: number; sy: number; x0: number; y0: number; w0: number; h0: number; w?: number; h?: number }
  | { kind: "img-resize"; id: string; corner: string; sx: number; sy: number; x0: number; y0: number; w0: number; h0: number; w?: number };

const DRAG_START = 4;
/** 線の文字の大きさ(0 = 文章と同じ) */
const LABEL_SIZES: [string, number][] = [["小", 12], ["ふつう(文章と同じ)", 0], ["大", 19], ["特大", 24]];
/** Tab・Enter で次の文字を置くときに見込む幅 */
const SPOT_W = 110;
export const PRESET_COLORS = 8;
/** 束ねたときに題にする文字の背景の色(0 = 切る)。アプリの設定から入れる(2026-11-26 修正13。初期値は赤 = 1) */
export const groupPrefs = { titleFill: 1 };

/** Ctrl+C でコピーした物(どの画面のキャンバスからでも貼れる)と、システムのコピーに入れた目印の文字 */
let refClip: { id: string; x: number; y: number; w?: number }[] = [];
let refClipMark = "";
/** Ctrl+X で切り取ったとき: 切り取った元のグループ(貼ると、そこから移す) */
let refCutFrom: string | null = null;
export const refClipboard = { get mark() { return refClipMark; }, get size() { return refClip.length; }, get ids() { return refClip.map((r) => r.id); } };
const CARD_FACE_H = CARD_H;

export function isImageFile(f: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f);
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
  getView(): View {
    return { ...this.view };
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
    if (group !== this.group) this.closeFind();
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
    if (this.edgeSel.size) {
      this.edgeSel.clear();
      for (const g of this.edgesSvg.querySelectorAll(".edge.selected, .elabel.selected")) g.classList.remove("selected");
    }
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
    // 枠は一番後ろに(大きい枠ほど後ろ)。2026-11-24
    const area = (id: string) => { const z = this.v.get(id)?.size; return z ? z.w * z.h : 0; };
    const items = this.v.itemsOf(this.group).map((m, i) => ({ m, i })).sort((a, b) => {
      const fa = this.v.get(a.m.id)?.type === "frame", fb = this.v.get(b.m.id)?.type === "frame";
      if (fa !== fb) return fa ? -1 : 1;
      if (fa && fb) return area(b.m.id) - area(a.m.id);
      return a.i - b.i;
    }).map((x) => x.m);
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
      // 画像の幅は置いた場所ごと(引用先でも別々に)
      if (m.w) el.style.setProperty("--img-w", m.w + "px");
      else el.style.removeProperty("--img-w");
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
    this.markCut();
    this.renderOuter();
    this.renderEdges();
    this.renderStrokes();
  }

  // ---------- 島(全体・まわり。2026-11-23 利用者と決めた A2) ----------
  // 今のグループの島はいつものキャンバスそのまま。ほかのグループも、開いたときと同じ位置・見た目・線のまま島として並べる。
  // 島をまたぐ線は、まっすぐ(曲線は使わない)。所属は、親の島の中のグループのノードから、その島の縁への点線。
  /** 外に広げる物: surround = まわり(全体の画面)、backlinks = このボードの物へのバックリンクだけ(2026-11-27 利用者) */
  outerMode: "surround" | "backlinks" = "surround";
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
    if (!this.surround || this.outerMode === "backlinks") return;
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
    const only = this.outerMode === "backlinks" ? this.backlinkItems() : null;
    const picks: IslandPick[] = only ? [{ group: this.group, dist: 0, from: null, rel: "side" }, ...[...only.keys()].map((g) => ({ group: g, dist: 1, from: this.group, rel: "side" as const }))] : pickIslands(this.v, this.group, this.scope);
    // ほかの島を作って、大きさを測る
    const built: { group: string; el: HTMLElement; nodes: { id: string; el: HTMLElement }[] }[] = [];
    const sizes = new Map<string, { w: number; h: number }>();
    for (const pk of picks.slice(1)) {
      const items = this.v.itemsOf(pk.group).filter((i) => this.v.exists(i.id) && (!only || only.get(pk.group)!.has(i.id)));
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
    const line = (a: Rect, b: Rect, cls: string, l?: Link) => {
      const p = this.clip(a, b.x + b.w / 2, b.y + b.h / 2);
      const q = this.clip(b, a.x + a.w / 2, a.y + a.h / 2);
      if (!l) {
        this.edgesSvg.append(svg("line", { class: cls, x1: p.x, y1: p.y, x2: q.x, y2: q.y }));
        return;
      }
      // 島の中・島をまたぐ線も、種類(矢印・部分の括弧)と色は同じ(統合仕様 3)
      const e = edgeEnds(l.kind, p, q);
      const g = svg("g", { class: `edge outer k-${l.kind}${this.linkColor(l) ? " c" + this.linkColor(l) : ""}` });
      g.append(svg("path", { class: "vis " + cls, d: `M${e.start.x},${e.start.y} L${e.end.x},${e.end.y}` }));
      if (e.fill) g.append(svg("path", { class: "end-fill", d: e.fill }));
      if (e.stroke) g.append(svg("path", { class: "end-stroke", d: e.stroke }));
      this.edgesSvg.append(g);
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
              if (a.ig !== this.group) line(a.r, b.r, "outer-edge k-link", l);
            }
        if (drewSame) continue;
        let best: [Rect, Rect] | null = null, bd = Infinity;
        for (const a of list) for (const b of tl) if (dist(a.r, b.r) < bd) (bd = dist(a.r, b.r)), (best = [a.r, b.r]);
        if (best) line(best[0], best[1], "outer-edge k-link", l);
      }
    }
    if (this.outerMode === "backlinks") {
      // 同じ物(ほかの所属先・引用)は点線、本文のリンクは細い線、文章の引用は緑の線。どれもこのボードの物へ
      for (const isl of this.islands)
        for (const nd of isl.nodes) {
          const r = { x: isl.box.x + nd.el.offsetLeft, y: isl.box.y + nd.el.offsetTop, w: nd.el.offsetWidth, h: nd.el.offsetHeight };
          const n = this.v.get(nd.id);
          if (this.rects.has(nd.id)) line(r, this.rects.get(nd.id)!, "outer-edge k-same");
          for (const t of n ? bodyLinkTargets(n.body) : []) if (this.rects.has(t) && t !== nd.id) line(r, this.rects.get(t)!, "outer-edge k-body");
          const c = n?.cite ? parseCite(n.cite)?.note : undefined;
          if (c && this.rects.has(c)) line(r, this.rects.get(c)!, "outer-edge k-cite");
        }
      return;
    }
    // 所属: 島の中のグループのノード → そのグループの島の縁(点線)
    const islandBox = new Map<string, Rect>([[this.group, cur], ...this.islands.map((i) => [i.group, i.box] as [string, Rect])]);
    for (const [gid, box] of islandBox) {
      for (const a of inst.get(gid) ?? []) if (a.ig !== gid) line(a.r, box, "outer-edge k-member");
    }
  }

  /** このボードの物へのバックリンク: グループごとに、そこに見せる物(本文のリンク・引用・文章の引用・ほかの所属先)。
   * このボードそのもののつながりは出さない(上の階層で見えるので。2026-11-27 利用者) */
  backlinkItems(): Map<string, Set<string>> {
    const v = this.v;
    const here = new Set(this.rects.keys());
    const out = new Map<string, Set<string>>();
    const isGroup = (g: string) => g === ROOT_ID || v.get(g)?.type === "group";
    const put = (g: string, id: string) => {
      if (g === this.group || !isGroup(g) || !v.exists(g)) return;
      (out.get(g) ?? out.set(g, new Set()).get(g)!).add(id);
    };
    const cites = new Map<string, string[]>();
    for (const n of v.nodes.values()) {
      const c = n.type === "text" && n.cite ? parseCite(n.cite)?.note : undefined;
      if (c && here.has(c)) (cites.get(c) ?? cites.set(c, []).get(c)!).push(n.id);
    }
    for (const id of here) {
      if (v.get(id)?.type === "alias") continue;
      for (const p of v.parentsOf(id)) put(p, id); // ほかの所属先
      for (const q of v.quotedBy(id)) put(q, id); // 引用しているボード
      for (const x of v.backlinksOf(id)) {
        if (here.has(x) || !bodyLinkTargets(v.get(x)?.body ?? "").includes(id)) continue; // 本文のリンクだけ(線は同じボードの中なので見えている)
        for (const p of v.parentsOf(x)) put(p, x);
      }
      for (const c of cites.get(id) ?? []) if (!here.has(c)) for (const p of v.parentsOf(c)) put(p, c);
    }
    return out;
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
    if (n.type === "alias") {
      const t = n.target ? this.v.get(n.target) : undefined;
      return JSON.stringify(["alias", n.target, t && t.type !== "alias" ? this.signature(t, true) : null]);
    }
    if (n.type === "note" && this.inline === n.id) return JSON.stringify(["inline", n.id]); // 書いている間は作り直さない
    return JSON.stringify([n.type, n.title, n.color, n.fill, n.file, n.paper ? [n.paper, paperStore.fzOf(n.paper), paperStore.thumbOf(n.paper)] : null, ref, n.type === "group" ? this.groupPeek(n.id).subs : null, n.type === "note" ? (noteKind(n) ? n.body : null) : !!n.body.trim(), n.card, n.spread, n.size, n.cite ? this.citeText(n) : null]);
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
    if (n.type === "alias") {
      // 同じボードの中の引用: 元の物と同じ見た目に、点線の枠と「飛ぶ」ボタン
      const t = n.target ? this.v.get(n.target) : undefined;
      if (t && t.type !== "alias") {
        const el = this.nodeEl(t, true);
        el.dataset.id = n.id;
        el.classList.add("alias");
        el.title = T.aliasMark;
        return el;
      }
      return h("div", { class: "node t-text ref alias missing", "data-id": n.id }, h("span", { class: "label", text: T.aliasMissing }));
    }
    const el = this.nodeEl0(n, ref);
    // 引用はふつう 1 回クリックで元の場所へ飛ぶ。カード(タロット・易・発想)だけは、クリック=選ぶ・右上の ↗=飛ぶ(2026-11-25 修正11)
    if (ref && n.type === "card") el.append(h("button", { class: "jump-btn", "data-act": "jump", title: T.jumpTip, "aria-label": T.jumpTip }));
    return el;
  }

  private nodeEl0(n: TDNode, ref: boolean): HTMLElement {
    const el = h("div", { class: `node t-${n.type}${n.color ? " c" + n.color : ""}${n.fill ? " f" + n.fill : ""}${ref ? " ref" : ""}`, "data-id": n.id });
    if (ref) el.title = T.refMark;
    if (n.type === "text" && n.paper) {
      // 紙PKM のページ: 小さな絵と、今の ID(直せば変わる)
      const fz = paperStore.fzOf(n.paper);
      const thumb = paperStore.thumbOf(n.paper);
      el.classList.add("file", "paper-node");
      if (thumb) el.append(h("img", { class: "file-img paper-img", src: thumb, alt: "", draggable: "false" }));
      el.append(h("span", { class: "label" }, fz === undefined ? PT.nodeMissing : PT.nodeLabel(fz ?? "?")));
    } else if (n.type === "text" && n.file) {
      // 添付: 画像は絵だけ(名前はマウスを乗せたときの説明に。選ぶと四隅で大きさを変えられる。統合仕様 8)、ほかは 📎 と名前
      el.classList.add("file");
      if (isImageFile(n.file)) {
        el.classList.add("image");
        el.title = n.title;
        const img = h("img", { class: "file-img", src: "vault://local/" + n.file.split("/").map(encodeURIComponent).join("/"), alt: n.title, draggable: "false" });
        img.addEventListener("load", () => this.requestRender()); // 読み込んでから大きさを測り直す(線の端・取っ手)
        el.append(img);
        for (const c of ["nw", "ne", "sw", "se"]) el.append(h("div", { class: `img-h ${c}`, "data-act": "imgresize", "data-corner": c, title: T.imgResize }));
      } else el.append(h("span", { class: "label" }, h("span", { class: "clip", text: "📎 " }), n.title || T.untitled));
    } else if (n.type === "text") {
      // @しるしは、しるしの見た目に(2026-11-24 利用者)
      if (n.cite) {
        // ノートの文章の引用(2026-11-26 修正14): 元の文章をそのまま見せる(元を直すと変わる)。緑の枠
        el.classList.add("cite");
        el.title = T.citeTip(this.v.get(parseCite(n.cite)?.note ?? "")?.title || T.untitled);
        el.append(h("span", { class: "label", text: this.citeText(n) || T.untitled }));
        return el;
      }
      const parts = splitTags(n.title || T.untitled);
      el.append(h("span", { class: "label" }, ...parts.map((p) => (p.tag ? h("span", { class: "tag", "data-tag": p.tag, text: p.text }) : p.text))));
      if (n.body.trim()) el.append(h("span", { class: "bodymark", title: T.hasBody, "data-act": "body" }, "¶"));
    } else if (n.type === "note") {
      // ノートはタイトルだけ。中身はクリックして開いたときにだけ見せる(2026-11-23 利用者)
      const ct = !!noteKind(n);
      // 題の無いチェックリスト・表は、題の行を出さない(「無題」とも出さない。2026-11-25 修正11)
      if (!ct || n.title) el.append(h("div", { class: "note-head" }, h("span", { class: "ico ico-note" }), h("span", { class: "label", text: n.title || T.untitled })));
      // チェックリスト・表のノートは、中身が全部見えるように(2026-11-25 利用者)
      if (ct) {
        el.classList.add("note-open");
        el.append(renderBodyDom(n.body, (i) => this.v.setBody(n.id, toggleTask(this.v.get(n.id)!.body, i))));
      }
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

    } else if (n.type === "frame") {
      // 枠: 中は素通し(中の空きを押すと、いつもどおり書ける)。縁と名前と右下の角だけ押せる
      const z = n.size ?? { w: 240, h: 160 };
      el.style.width = z.w + "px";
      el.style.height = z.h + "px";
      for (const side of ["t", "r", "b", "l"]) el.append(h("div", { class: `frame-edge e-${side}` }));
      el.append(h("div", { class: "frame-name" + (n.title ? "" : " empty"), text: n.title || T.frameName }));
      // 四方の角で大きさを変える(画像と同じ取っ手。縦横は自由。2026-11-25 利用者)
      for (const c of ["nw", "ne", "sw", "se"]) el.append(h("div", { class: `img-h ${c}`, "data-act": "grpresize", "data-corner": c, title: T.frameResize }));
    } else if (n.type === "card" && n.card?.deck === "prompt") {
      // 発想カードは文字と同じ大きさの札(2026-11-24 利用者が見本 A を選んだ)。選ぶと下に問いが出る
      const p = PROMPT_BY_ID[n.card.id];
      el.classList.add("pchip", "deck-prompt", "pc" + (p?.color ?? 0));
      el.append(h("span", { class: "pchip-dot" }), h("span", { class: "label", text: p?.name ?? n.title }));
      if (p) el.append(h("div", { class: "pchip-q" }, h("div", { class: "pchip-set", text: p.setName }), p.question));
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
    // 矢印は大きく、とがった形に(2026-11-24 利用者「分かりづらい」)
    const m = svg("marker", { id: "arrowhead", viewBox: "0 0 14 12", refX: "13", refY: "6", markerWidth: "15", markerHeight: "13", orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" });
    m.append(svg("path", { d: "M0,0.5 L14,6 L0,11.5 L3.5,6 z", class: "marker" }));
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

  /** 選んでいる線("from>to") */
  edgeSel = new Set<string>();
  /** 文字をドラッグしている間の位置(決めるまで保存しない) */
  private labelAtLive: { key: string; at: number } | null = null;

  /** このキャンバスの線(両端があるもの)と、その形 */
  private edgeGeom(): { from: string; to: string; key: string; l: Link; p1: Pt; p2: Pt; ends: ReturnType<typeof edgeEnds> }[] {
    const out: { from: string; to: string; key: string; l: Link; p1: Pt; p2: Pt; ends: ReturnType<typeof edgeEnds> }[] = [];
    for (const [id, a] of this.rects) {
      for (const l of this.v.get(id)!.links) {
        const b = this.rects.get(l.to);
        if (!b) continue; // 両端が同じキャンバスの中にあるときだけ描く
        const p1 = this.clip(a, b.x + b.w / 2, b.y + b.h / 2);
        let p2 = this.clip(b, a.x + a.w / 2, a.y + a.h / 2);
        if (l.kind === "part") p2 = partEnd(b, p1, p2); // 括弧が部分のノードに隠れないように
        out.push({ from: id, to: l.to, key: id + ">" + l.to, l, p1, p2, ends: edgeEnds(l.kind, p1, p2) });
      }
    }
    return out;
  }

  /** 見た目の箱: グループは下に重ねた影(3px)・ノートは影の分を足す(よける余白が上・横・下でそろうように。2026-11-24 利用者) */
  private visualBox(id: string, r: Rect): Rect {
    const t = this.v.get(id)?.type;
    const extra = t === "group" ? 4 : t === "note" ? 2 : 0;
    return extra ? { ...r, h: r.h + extra } : r;
  }

  /** 文字の位置(線の上の割合)。終わりの印を隠さないよう、端に寄せすぎない */
  private labelAt(key: string, l: Link): number {
    const at = this.labelAtLive?.key === key ? this.labelAtLive.at : l.at ?? 0.5;
    return Math.min(0.85, Math.max(0.15, at));
  }

  private renderEdges(): void {
    const defs = this.edgesSvg.querySelector("defs")!;
    this.edgesSvg.replaceChildren(defs);
    // スプレッドの囲み枠は出さない(2026-11-23 利用者「枠やっぱりいらない」)
    const geom = this.edgeGeom();
    const alive = new Set(geom.map((g) => g.key));
    for (const k of [...this.edgeSel]) if (!alive.has(k)) this.edgeSel.delete(k);
    // 文字(ノード)をよける: 枠は除く。線の両端のノードも除く(2026-11-24 利用者「文字の枠に沿う感じ」)。
    // 回る線はノードにつながる線の端(4)より外(14)を通す。同じ箱を何本も回るときは 6 ずつ外へ(重ならないように)
    const frs = this.frameIds();
    const obstacles = [...this.rects.entries()].filter(([i]) => !frs.has(i));
    const around = new Map<string, number>();
    // 箱ごとの、つながっている線の端
    const attach = new Map<string, Pt[]>();
    for (const g of geom) for (const [id, p] of [[g.from, g.p1], [g.to, g.p2]] as [string, Pt][]) (attach.get(id) ?? attach.set(id, []).get(id)!).push(p);
    const routes = new Map<string, Pt[]>();
    for (const e of geom) {
      const list = obstacles.filter(([i]) => i !== e.from && i !== e.to);
      const rt = routeAround(e.ends.start, e.ends.end, list.map(([i, r]) => ({ ...this.visualBox(i, r), pad: 14 + 6 * (around.get(i) ?? 0), avoid: attach.get(i) })));
      if (!rt) continue;
      routes.set(e.key, rt.pts);
      for (const bi of rt.used) around.set(list[bi][0], (around.get(list[bi][0]) ?? 0) + 1);
    }
    // 交差: 一方が小さな弧で乗り越える(2026-11-24 統合仕様 5)。よけて回る線も、回った所でまたぐ線を乗り越える
    const segs: Seg[] = [];
    for (const g of geom) {
      const pl = routes.get(g.key) ?? [g.ends.start, g.ends.end];
      for (let i = 0; i + 1 < pl.length; i++) segs.push({ key: g.key + "#" + i, a: pl[i], b: pl[i + 1], ends: [g.from, g.to] });
    }
    const hops = findHops(segs);
    // 線の本体・終わりの印(下)と、線の文字(上)を別の層に。ノードと線の文字の所は線を描かない(マスク。2026-11-24 修正8)
    const linesG = svg("g", { class: "edge-lines", mask: "url(#edge-mask)" });
    const labelsG = svg("g", { class: "edge-labels" });
    this.edgesSvg.append(linesG, labelsG);
    const labels: SVGGElement[] = [];
    for (const e of geom) {
      const { l, p1, p2, ends } = e;
      const sel = this.edgeSel.has(e.key);
      const route = routes.get(e.key) ?? null;
      const pl = route ?? [ends.start, ends.end];
      const lc = this.linkColor(l);
      const g = svg("g", { class: `edge k-${l.kind}${lc ? " c" + lc : ""}${sel ? " selected" : ""}`, "data-from": e.from, "data-to": e.to });
      g.append(svg("path", { d: `M${p1.x},${p1.y} L${p2.x},${p2.y}`, class: "hit" }));
      g.append(svg("path", { d: polyPath(pl, pl.slice(1).map((_, i) => hops.get(e.key + "#" + i) ?? [])), class: "vis" }));
      if (ends.fill) g.append(svg("path", { d: ends.fill, class: "end-fill" }));
      if (ends.stroke) g.append(svg("path", { d: ends.stroke, class: "end-stroke" }));
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      if (l.kind === "oppose") {
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
        const ux = (p2.x - p1.x) / len, uy = (p2.y - p1.y) / len;
        for (const o of [-4, 4]) {
          const cx = mx + ux * o, cy = my + uy * o;
          g.append(svg("line", { class: "oppose-tick", x1: cx - uy * 8, y1: cy + ux * 8, x2: cx + uy * 8, y2: cy - ux * 8 }));
        }
      }
      linesG.append(g);
      if (l.label) {
        // 線の上の文字(2026-11-24 統合仕様 6): 文章と同じ大きさ・不透明な薄い灰色の背景・いつも水平。ドラッグで線に沿って動く
        const at = this.labelAt(e.key, l);
        const lp = route ? pointAlong(route, at) : { x: p1.x + (p2.x - p1.x) * at, y: p1.y + (p2.y - p1.y) * at };
        const x = Math.round(lp.x * 10) / 10, y = Math.round(lp.y * 10) / 10;
        const lg = svg("g", { class: `elabel${sel ? " selected" : ""}`, "data-from": e.from, "data-to": e.to, transform: `translate(${x},${y})` }) as SVGGElement;
        const bg = svg("rect", { class: "elabel-bg", rx: 4 });
        const t = svg("text", { class: "edgelabel", "text-anchor": "middle", "dominant-baseline": "central" });
        if (l.size) t.style.fontSize = l.size + "px";
        t.textContent = l.label;
        lg.append(bg, t);
        labelsG.append(lg);
        labels.push(lg);
        (lg as unknown as { _at: Pt })._at = { x, y };
      }
    }
    // 文字の背景を、文字の大きさに合わせる
    const holes: Rect[] = [];
    for (const lg of labels) {
      const bb = lg.querySelector("text")!.getBBox();
      const bg = lg.querySelector("rect")!;
      const r = { x: bb.x - 7, y: bb.y - 3, w: bb.width + 14, h: bb.height + 6 };
      bg.setAttribute("x", String(r.x));
      bg.setAttribute("y", String(r.y));
      bg.setAttribute("width", String(r.w));
      bg.setAttribute("height", String(r.h));
      const at = (lg as unknown as { _at: Pt })._at;
      holes.push({ x: r.x + at.x, y: r.y + at.y, w: r.w, h: r.h });
    }
    // マスク: ノード(枠は除く)と線の文字の所は、線を描かない。線の端・矢印・括弧はノードの少し外なので消えない
    const fr = this.frameIds();
    for (const [id, r] of this.rects) if (!fr.has(id)) holes.push({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 });
    const big = { x: -1e6, y: -1e6, width: 2e6, height: 2e6 };
    const mask = svg("mask", { id: "edge-mask", maskUnits: "userSpaceOnUse", ...big });
    mask.append(svg("rect", { ...big, fill: "white" }));
    for (const r of holes) mask.append(svg("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 3, fill: "black" }));
    defs.querySelector("#edge-mask")?.remove();
    defs.append(mask);
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

  startEdit(id: string | null, x: number, y: number, parent: string | null, initial = "", left = false): void {
    this.commitDraft("esc");
    const ta = h("textarea", { class: "draft", rows: 1, spellcheck: "false" }) as HTMLTextAreaElement;
    ta.value = initial;
    ta.style.left = x + "px";
    ta.style.top = y + "px";
    const n = id ? this.v.get(id) : null;
    if (n?.color) ta.classList.add("c" + n.color);
    this.draft = { id, x, y, parent, ta, right: left ? x + SPOT_W : undefined };
    ta.addEventListener("keydown", (e) => this.onDraftKey(e));
    ta.addEventListener("input", () => {
      this.keepDraftClear();
      this.draftLine();
      this.updateTagPop();
    });
    ta.addEventListener("compositionend", () => this.updateTagPop());
    ta.addEventListener("blur", () => {
      if (this.draft?.ta === ta) this.commitDraft("esc");
    });
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.draftLayer.append(ta);
    if (id) this.els.get(id)?.classList.add("editing");
    this.updateSelBar();
    this.keepDraftClear();
    this.draftLine();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  /**
   * 書いている間は文字を動かさない(2026-11-26 修正13。前はかぶるたびに余白へ置き直していた)。
   * かぶっても、書いている文字がいちばん手前(下の文字・線は隠れる)。書き終えたら fitNew で余白へ。
   * 左に置いた文字は、右のはしをそのままに左へ伸ばす
   */
  private keepDraftClear(): void {
    const d = this.draft;
    if (!d) return;
    const w = d.ta.offsetWidth;
    if (d.right !== undefined) d.x = Math.round(d.right - w);
    d.ta.style.left = d.x + "px";
    d.ta.style.top = d.y + "px";
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
    if (this.tagPop && this.tagPopKey(e)) return;
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
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "q" && this.draft && !this.draft.ta.value.trim() && !this.draft.id) {
      // 何もない所を押して出た書く欄で Ctrl+Q: その場所に引用として貼る(2026-11-26 修正14)
      e.preventDefault();
      const at = { x: this.draft.x + 60, y: this.draft.y + 12 };
      this.commitDraft("esc");
      this.el.focus();
      void this.quotePaste(at);
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "l") {
      // 書いている文字から Ctrl+L: 決めてから、その文字とつなぐ物を探す(2026-11-24 利用者)
      e.preventDefault();
      const parent = this.draft?.parent ?? null;
      const id = this.commitDraft("esc") ?? parent;
      this.el.focus();
      this.setSelection(id && this.rects.has(id) ? [id] : []);
      void this.linkBySearch();
    }
  }

  // ---------- @ の候補(2026-11-24 利用者: これまでのしるし・時系列記録の種類から) ----------
  private tagPop: { el: HTMLElement; items: string[]; sel: number; start: number } | null = null;
  private closeTagPop(): void {
    this.tagPop?.el.remove();
    this.tagPop = null;
  }
  private updateTagPop(): void {
    const d = this.draft;
    if (!d) return this.closeTagPop();
    const ta = d.ta;
    const before = ta.value.slice(0, ta.selectionStart);
    const m = /(^|[\s\u3000(（「『、。,，])@([^\s\u3000@#、。,，.．!?！？()（）「」『』]*)$/.exec(before);
    if (!m) return this.closeTagPop();
    const q = m[2].toLowerCase();
    const all = this.host.tagCandidates?.() ?? allTags(this.v).map((t) => t.tag);
    const items = [...all.filter((t) => t.toLowerCase().startsWith(q)), ...all.filter((t) => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q))].filter((t) => t !== m[2]).slice(0, 8);
    if (!items.length) return this.closeTagPop();
    const start = before.length - m[2].length - 1;
    const el = this.tagPop?.el ?? h("div", { class: "tag-pop", role: "listbox" });
    el.replaceChildren(
      ...items.map((t, i) => {
        const b = h("button", { class: "tag-opt" + (i === 0 ? " on" : ""), role: "option", text: "@" + t });
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.pickTag(t);
        });
        return b;
      }),
    );
    el.style.left = d.x + "px";
    el.style.top = d.y + d.ta.offsetHeight + 4 + "px";
    if (!el.parentElement) this.draftLayer.append(el);
    this.tagPop = { el, items, sel: 0, start };
  }
  /** 候補を選んで入れる(打ちかけの所を置き換え、後ろに空白) */
  private pickTag(t: string): void {
    const p = this.tagPop, d = this.draft;
    if (!p || !d) return;
    const ta = d.ta;
    const end = ta.selectionStart;
    ta.value = ta.value.slice(0, p.start) + "@" + t + " " + ta.value.slice(end);
    const at = p.start + t.length + 2;
    ta.setSelectionRange(at, at);
    this.closeTagPop();
    ta.focus();
    this.keepDraftClear();
    this.draftLine();
  }
  /** 候補が出ている間のキー: ↑↓ で選ぶ・Enter / Tab で入れる・Esc で候補だけ閉じる */
  private tagPopKey(e: KeyboardEvent): boolean {
    const p = this.tagPop!;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      p.sel = (p.sel + (e.key === "ArrowDown" ? 1 : -1) + p.items.length) % p.items.length;
      p.el.querySelectorAll(".tag-opt").forEach((b, i) => b.classList.toggle("on", i === p.sel));
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.pickTag(p.items[p.sel]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeTagPop();
      return true;
    }
    return false;
  }

  /** 書いている文字を確定する。Enter は同じ親のまわりに次、Tab はこのノードのまわりに子 */
  commitDraft(mode: "enter" | "tab" | "esc"): string | null {
    const d = this.draft;
    if (!d) return null;
    this.draft = null;
    this.closeTagPop();
    d.ta.remove();
    queueMicrotask(() => this.updateSelBar());
    this.edgesSvg.querySelector(".draftline")?.remove();
    const text = d.ta.value.replace(/\s+$/, "");
    let id = d.id;
    try {
      if (id) {
        if (this.v.get(id)?.type === "frame") {
          this.v.update(id, { title: text.trim() }); // 枠の名前は空にもできる(消えない)
          return id;
        }
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
    if (!id || mode === "esc") return id;
    if (mode === "enter") {
      const parent = d.parent ?? this.parentOf(id);
      const p = this.spot(parent && this.rects.has(parent) ? parent : id);
      this.startEdit(null, p.x, p.y, parent, "", p.left);
    } else {
      const p = this.spot(id);
      this.startEdit(null, p.x, p.y, id, "", p.left);
    }
    return id;
  }

  /** 書き終えた文字の実際の大きさで、親やほかの物に近すぎ・重なっていたら置き直す(書く前は大きさが分からないため) */
  private fitNew(id: string, parent: string): void {
    const r = this.rects.get(id);
    const a = this.rects.get(parent);
    if (!r || !a) return;
    const others = [...this.obstacles(new Set([id, parent])), ...this.edgeBoxes(id)];
    const fr = this.frameIds();
    const boxes = [...this.rects.entries()].filter(([i]) => i !== id && i !== parent && !fr.has(i)).map(([, b]) => b);
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const myLineHits = boxes.some((b) => segHitsRect(ac.x, ac.y, r.x + r.w / 2, r.y + r.h / 2, b));
    if (gap(r, a) >= 30 && others.every((o) => gap(r, o) >= 16) && !myLineHits) return;
    const p = placeAround(a, others, { size: { w: r.w, h: r.h }, lineBlockers: boxes });
    this.v.move(this.group, [{ id, x: Math.round(p.x), y: Math.round(p.y) }]);
    this.renderNow();
  }

  /** anchor のまわりで、ほかと一番離れる所(2026-11-22 利用者の希望。core/placement.ts) */
  /**
   * Tab で置く文字がよける箱: ノード(グループは影も含めて少し広く)・ペンの線・囲い(2026-11-25 修正11「グループも囲いも避ける」)。
   * ただし、つなぎ元が中に入っている囲いはよけない(囲いの中で書き足すとき)
   */
  private tabObstacles(anchor: string, except: Set<string>): Rect[] {
    const a = this.rects.get(anchor);
    const ax = a ? a.x + a.w / 2 : NaN, ay = a ? a.y + a.h / 2 : NaN;
    const out: Rect[] = [];
    for (const [i, r] of this.rects) {
      if (i === anchor || except.has(i)) continue;
      const t = this.v.get(i)?.type;
      if (t === "frame") {
        if (ax > r.x && ax < r.x + r.w && ay > r.y && ay < r.y + r.h) continue;
        out.push({ x: r.x - 6, y: r.y - 14, w: r.w + 12, h: r.h + 20 }); // 上は名前の分も
        continue;
      }
      const v = this.visualBox(i, r);
      out.push(t === "group" ? { x: v.x - 6, y: v.y - 6, w: v.w + 12, h: v.h + 12 } : v);
    }
    out.push(...this.v.strokesOf(this.group).map(strokeBox));
    return out;
  }

  spot(anchor: string): { x: number; y: number; left: boolean } {
    const a = this.rects.get(anchor)!;
    const fr = this.frameIds();
    const others = this.tabObstacles(anchor, new Set());
    others.push(...this.edgeBoxes());
    const boxes = [...this.rects.entries()].filter(([i]) => i !== anchor && !fr.has(i)).map(([, r]) => r);
    const p = placeAround(a, others, { size: { w: SPOT_W, h: Math.min(40, a.h) }, lineBlockers: boxes });
    return { ...p, left: p.x + SPOT_W / 2 < a.x };
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
    const fr = this.frameIds();
    return [...[...this.rects.entries()].filter(([i]) => !except.has(i) && !fr.has(i)).map(([, r]) => r), ...this.v.strokesOf(this.group).map(strokeBox)];
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
      this.startEdit(null, p.x, p.y, from, text, p.left);
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
    el.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      const id = this.nodeAt(e.target);
      if (id && this.v.get(id)?.type === "group" && this.host.openTabBehind) {
        e.preventDefault();
        this.host.openTabBehind(id);
      }
    });
    el.addEventListener("dblclick", (e) => {
      if (this.pen.on) return;
      // ほかの島: その島のグループを開いて編集できるように
      const isl = (e.target as Element).closest?.<HTMLElement>(".island");
      if (isl?.dataset.ig) {
        e.preventDefault();
        return this.host.openGroup(isl.dataset.ig);
      }
      const edgeEl = (e.target as Element).closest?.(".edge, .elabel");
      if (edgeEl && !this.readOnly && edgeEl.getAttribute("data-from")) {
        e.preventDefault();
        return this.editLinkLabel(edgeEl.getAttribute("data-from")!, edgeEl.getAttribute("data-to")!);
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
    const edge = (e.target as Element).closest?.(".edge, .elabel");
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
      if (edge) {
        // 線: 押すと選ぶ(Ctrl で足す・外す)。文字はドラッグで線に沿って動かす
        if (this.readOnly) return;
        const key = edge.getAttribute("data-from") + ">" + edge.getAttribute("data-to");
        this.drag = { kind: "edge-press", key, sx: e.clientX, sy: e.clientY, ctrl, label: !!(e.target as Element).closest?.(".elabel") };
        this.el.focus({ preventScroll: true });
        return;
      }
      const ih = (e.target as Element).closest?.<HTMLElement>("[data-act=imgresize]");
      if (id && ih && !this.readOnly) {
        const r = this.rects.get(id)!;
        const nel = this.els.get(id)!;
        this.drag = { kind: "img-resize", id, corner: ih.dataset.corner!, sx: e.clientX, sy: e.clientY, x0: r.x, y0: r.y, w0: nel.offsetWidth, h0: nel.offsetHeight };
        e.preventDefault();
        return;
      }
      const gh = (e.target as Element).closest?.<HTMLElement>("[data-act=grpresize]");
      if (id && gh && !this.readOnly) {
        const r = this.rects.get(id)!;
        const nel = this.els.get(id)!;
        this.drag = { kind: "grp-resize", id, corner: gh.dataset.corner!, sx: e.clientX, sy: e.clientY, x0: r.x, y0: r.y, w0: nel.offsetWidth, h0: nel.offsetHeight };
        e.preventDefault();
        return;
      }
      if (id && (e.target as Element).closest?.("[data-act=resize]") && !this.readOnly) {
        const z = this.v.get(id)?.size ?? { w: 240, h: 160 };
        this.drag = { kind: "resize", id, sx: e.clientX, sy: e.clientY, w: z.w, h: z.h };
        e.preventDefault();
        return;
      }
      if (id) this.drag = { kind: "node-press", id, sx: e.clientX, sy: e.clientY, ctrl, target: e.target as Element, wasSelected: this.selection.size === 1 && this.selection.has(id) };
      else if (sid) this.drag = { kind: "stroke-press", id: sid, sx: e.clientX, sy: e.clientY, ctrl };
      else this.drag = { kind: "empty-press", sx: e.clientX, sy: e.clientY, ctrl, shift: e.shiftKey };
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
    // 枠を動かすと、中の物(中の枠も)が一緒に動く
    const inner = this.frameContents(ids);
    ids = [...new Set([...ids, ...inner.ids])];
    strokes = [...new Set([...strokes, ...inner.strokes])];
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
      case "grp-resize": {
        // 四方どの角でも。向かいの角は動かさない。縦横は自由
        const dx = (e.clientX - d.sx) / this.view.z, dy = (e.clientY - d.sy) / this.view.z;
        const sx = d.corner.includes("e") ? 1 : -1, sy = d.corner.includes("s") ? 1 : -1;
        const w = Math.max(60, Math.round(d.w0 + sx * dx)), hh = Math.max(40, Math.round(d.h0 + sy * dy));
        const x = sx < 0 ? d.x0 + d.w0 - w : d.x0, y = sy < 0 ? d.y0 + d.h0 - hh : d.y0;
        d.w = w;
        d.h = hh;
        const el = this.els.get(d.id);
        if (el) Object.assign(el.style, { width: w + "px", height: hh + "px", left: x + "px", top: y + "px" });
        this.rects.set(d.id, { x, y, w, h: hh });
        this.renderEdges();
        return;
      }
      case "img-resize": {
        // 縦横の比は保つ。向かいの角を動かさない。小さくなりすぎない
        const dx = (e.clientX - d.sx) / this.view.z, dy = (e.clientY - d.sy) / this.view.z;
        const sx = d.corner.includes("e") ? 1 : -1, sy = d.corner.includes("s") ? 1 : -1;
        const ratio = d.h0 / (d.w0 || 1);
        const dw = Math.abs(dx) > Math.abs(dy / ratio) ? sx * dx : (sy * dy) / ratio;
        const w = Math.max(40, Math.round(d.w0 + dw));
        const hh = w * ratio;
        const x = sx < 0 ? d.x0 + d.w0 - w : d.x0, y = sy < 0 ? d.y0 + d.h0 - hh : d.y0;
        d.w = w;
        const el = this.els.get(d.id);
        if (el) {
          el.style.setProperty("--img-w", w + "px");
          el.style.left = x + "px";
          el.style.top = y + "px";
        }
        this.rects.set(d.id, { x, y, w, h: hh });
        this.renderEdges(); // 線の端も付いてくる
        return;
      }
      case "edge-press": {
        if (!far || !d.label) return;
        this.drag = { kind: "label-drag", key: d.key };
        this.onMove(e);
        return;
      }
      case "label-drag": {
        const [from, to] = d.key.split(">");
        const a = this.rects.get(from), b = this.rects.get(to);
        if (!a || !b) return;
        const p1 = this.clip(a, b.x + b.w / 2, b.y + b.h / 2);
        const p2 = this.clip(b, a.x + a.w / 2, a.y + a.h / 2);
        const p = this.toWorld(e.clientX, e.clientY);
        const vx = p2.x - p1.x, vy = p2.y - p1.y;
        const t = ((p.x - p1.x) * vx + (p.y - p1.y) * vy) / (vx * vx + vy * vy || 1);
        this.labelAtLive = { key: d.key, at: Math.min(0.85, Math.max(0.15, t)) };
        this.renderEdges();
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
        // Shift+ドラッグ: 線だけを範囲で選ぶ(一部でも通っていれば。Ctrl も押すと足す。2026-11-24 修正8)
        const edgeMode = d.kind === "empty-press" && !!d.shift;
        const box = h("div", { class: "rubber" + (edgeMode ? " edges" : "") });
        this.el.append(box);
        this.drag = { kind: "rubber", sx: d.sx, sy: d.sy, box, base: d.ctrl ? new Set(this.selection) : new Set(), baseStrokes: d.ctrl ? new Set(this.strokeSel) : new Set(), edges: edgeMode ? (d.ctrl ? new Set(this.edgeSel) : new Set()) : undefined, baseEdges: d.ctrl ? new Set(this.edgeSel) : new Set() };
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
        if (d.edges) {
          const box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
          const sel = new Set(d.edges);
          for (const g of this.edgeGeom()) if (segHitsRect(g.p1.x, g.p1.y, g.p2.x, g.p2.y, box, 0)) sel.add(g.key);
          this.setEdgeSel(sel);
          return;
        }
        const hit = (q: Rect) => q.x < b.x && q.x + q.w > a.x && q.y < b.y && q.y + q.h > a.y;
        const sel = new Set(d.base);
        let got = 0;
        for (const [i, q] of this.rects) if (hit(q)) sel.add(i), got++;
        const ss = new Set(d.baseStrokes);
        for (const s of this.v.strokesOf(this.group)) if (hit(strokeBox(s))) ss.add(s.id), got++;
        // 囲んだ所にノードもペンの線も無く、つなぎの線だけなら、その線を選ぶ(2026-11-24 利用者)
        // Ctrl を押していれば、前に選んだ線は残して足す(ノードのときと同じ)
        if (!got && !d.base.size && !d.baseStrokes.size) {
          const box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
          const es = new Set(d.baseEdges);
          for (const g of this.edgeGeom()) if (segHitsRect(g.p1.x, g.p1.y, g.p2.x, g.p2.y, box, 0)) es.add(g.key);
          if (es.size) {
            this.setEdgeSel(es);
            return;
          }
        }
        this.setSelection(sel, ss);
        return;
      }
      case "resize": {
        const el = this.els.get(d.id);
        const w = Math.max(40, d.w + (e.clientX - d.sx) / this.view.z), hh = Math.max(30, d.h + (e.clientY - d.sy) / this.view.z);
        if (el) {
          el.style.width = w + "px";
          el.style.height = hh + "px";
        }
        const r = this.rects.get(d.id);
        if (r) {
          r.w = w;
          r.h = hh;
        }
        this.renderEdges();
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
      case "grp-resize": {
        if (!d.w || !d.h) return;
        const r = this.rects.get(d.id)!;
        this.v.tx(() => {
          this.v.setFrameSize(d.id, d.w!, d.h!);
          this.v.move(this.group, [{ id: d.id, x: Math.round(r.x), y: Math.round(r.y) }]);
        });
        return;
      }
      case "img-resize": {
        if (!d.w) return;
        const r = this.rects.get(d.id)!;
        this.v.tx(() => {
          this.v.setItemWidth(this.group, d.id, d.w!);
          this.v.move(this.group, [{ id: d.id, x: Math.round(r.x), y: Math.round(r.y) }]);
        });
        return;
      }
      case "edge-press": {
        if (d.ctrl) {
          const s = new Set(this.edgeSel);
          if (s.has(d.key)) s.delete(d.key);
          else s.add(d.key);
          this.setEdgeSel(s);
        } else this.setEdgeSel([d.key]);
        return;
      }
      case "label-drag": {
        const live = this.labelAtLive;
        this.labelAtLive = null;
        if (!live) return;
        const [from, to] = d.key.split(">");
        this.v.setLinkProps(from, to, { at: Math.round(live.at * 1000) / 1000 });
        this.renderEdges();
        return;
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
        const edge = (e.target as Element).closest?.(".edge, .elabel");
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
      case "resize": {
        const r = this.rects.get(d.id);
        if (r && (Math.round(r.w) !== d.w || Math.round(r.h) !== d.h)) this.v.setFrameSize(d.id, r.w, r.h);
        else this.renderNow();
        return;
      }
      case "pan":
        this.el.classList.remove("panning");
        return;
    }
  }

  /**
   * 文字: 1 回クリックですぐ書き直す(選ぶだけなら Ctrl+クリックか範囲選択)。
   * グループ・ノート: 1 回クリックで開く。カード: 1 回目 = 選ぶ、選んであるものをもう一度 = 開く。
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
    // キャンバスの上のチェックの箱: 押すだけ(開かない。ノートは 1 回クリックで開くようになったため。2026-11-26 修正13)
    if (target.closest(".task-box")) return;
    if (target.closest("[data-act=tree]")) {
      this.setSelection([id]);
      return this.host.groupTree?.(id, target.closest("[data-act=tree]")!);
    }
    // 引用(2026-11-25 修正11): 1 回クリックで元の場所へ。選ぶのは Ctrl+クリックか範囲選択、動かすのはドラッグ。
    // カードの引用だけは、クリック=選ぶ(右の欄に解説)・右上の ↗=飛ぶ
    if (this.isQuote(id)) {
      // 引用したグループは、1 回クリックでそのグループ自身の中へ(統合仕様 7)
      const g = this.quotedGroup(id);
      if (g) return this.host.openGroup(g);
      if (target.closest("[data-act=jump]")) return this.jump(id);
      const t = node.type === "alias" && node.target ? this.v.get(node.target) : node;
      this.setSelection([id]); // 戻ったときに、この引用が選ばれているように
      if (t?.type === "card") return;
      return this.jump(id);
    }
    if (target.closest("[data-act=body]")) {
      this.setSelection([id]);
      return this.host.openBody(id);
    }
    // まだ選んでいないタロットカード(出たものを並べるモード): 押すと入力画面
    if (node.type === "card" && node.card?.deck === "tarot" && !node.card.id && !this.readOnly) {
      this.setSelection([id]);
      return this.assignCard(id);
    }
    // ノートの文章の引用: 押すと元の所へ(選ぶのは Ctrl+クリックか範囲選択。2026-11-26 修正14)
    if (node.type === "text" && node.cite) {
      this.setSelection([id]);
      return this.openCite(id);
    }
    if (node.type === "text" && !node.file && !node.paper) {
      this.setSelection([id]);
      return this.open(id, target);
    }
    // 添付したファイルは 1 回クリックで開く(2026-11-27 利用者。画像はキャンバスに見えているので、選ぶだけ)
    if (node.type === "text" && node.file && !isImageFile(node.file)) {
      this.setSelection([id]);
      return this.open(id, target);
    }
    // グループは 1 回クリックで中へ(2026-11-24 利用者)。選ぶだけなら Ctrl+クリックか範囲選択
    // ノートも 1 回クリックで開く(2026-11-26 修正13)
    if (!wasSelected && node.type !== "group" && node.type !== "note") {
      this.setSelection([id]);
      return;
    }
    this.open(id, target);
  }

  /** いまキャンバスの上で書いているノード(チェックリスト・表) */
  private inline: string | null = null;
  /** ノートを開く: チェックリスト・表のノートは、ポップアップではなくそのまま書き込む(2026-11-25 利用者) */
  openNote(id: string): void {
    const n = this.v.get(id);
    if (!n) return;
    // 表・チェックリストは大画面のノートでは開かない(2026-11-26 修正13)。書けない画面では選ぶだけ
    if (noteKind(n)) {
      if (this.host.editInline && !this.readOnly) this.startInline(id);
      else this.setSelection([id]);
      return;
    }
    this.host.openBody(id);
  }
  private startInline(id: string): void {
    if (this.inline === id) return;
    this.inline = id;
    this.renderNow();
    const el = this.el.querySelector<HTMLElement>(`.node[data-id="${id}"]`);
    if (!el) {
      this.inline = null;
      return;
    }
    el.querySelector(".cv-body")?.setAttribute("hidden", "");
    const mount = h("div", { class: "cv-edit" });
    let closeEd = () => {};
    // 名前: 書いている間は、題がそのまま書き直せる(見た目は同じ)。
    // 題の無いチェックリスト・表は、書いている間も題の行を出さない(見た目を変えない)。名前は右クリックの「名前を変える」で付ける。
    // 題の入力は編集欄より先に作る(あとから差し込むと、本文のカーソルが表の外へずれる)
    const label = el.querySelector<HTMLElement>(".note-head .label");
    if (label) {
      const inp = h("input", { class: "label cv-title", value: this.v.get(id)?.title ?? "", placeholder: T.titleOptional, spellcheck: "false" }) as HTMLInputElement;
      label.replaceWith(inp);
      for (const ev of ["pointerdown", "mousedown", "click", "dblclick"]) inp.addEventListener(ev, (e) => e.stopPropagation());
      const commit = () => {
        const t = inp.value.trim();
        if (t !== (this.v.get(id)?.title ?? "")) this.v.update(id, { title: t });
      };
      inp.addEventListener("input", commit);
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
          e.preventDefault();
          mount.querySelector<HTMLElement>(".ProseMirror")?.focus();
        } else if (e.key === "Escape") closeEd();
      });
      inp.addEventListener("focusout", (e) => {
        const to = (e as FocusEvent).relatedTarget as Element | null;
        if (to && (el.contains(to) || to.closest?.(".backdrop, .ctxmenu"))) return;
        setTimeout(() => {
          if (!el.contains(document.activeElement) && !document.querySelector(".backdrop, .ctxmenu")) closeEd();
        }, 0);
      });
    }
    el.append(mount);
    const ed = this.host.editInline!(id, mount, () => {
      if (this.inline === id) this.inline = null;
      this.requestRender();
      this.el.focus({ preventScroll: true });
    });
    closeEd = () => ed.close();
    // メニューを閉じたあとなどでフォーカスが外れていたら、本文へ戻す(ProseMirror が覚えている位置へ。DOM の focus だと先頭に行ってしまう)
    requestAnimationFrame(() => {
      if (this.inline === id && !el.contains(document.activeElement)) ed.focus();
    });
  }

  /** 紙で出たカードを、略号・名前で探して当てはめる(まだ選んでいないカードを押したときも) */
  assignCard(id: string): void {
    const cur = this.v.get(id)?.card;
    if (!cur || cur.deck !== "tarot") return;
    openCardSearch({ id: cur.id, reversed: cur.reversed }, (cid, rev) => {
      const def = cardDef("tarot", cid);
      this.v.tx(() => {
        this.v.setCard(id, { ...cur, id: cid, reversed: rev });
        if (def) this.v.update(id, { title: def.ja });
      });
    });
  }

  /** 開く: 文字は書き直し、グループは中へ、ノート・カードは本文 */
  open(id: string, _target?: Element): void {
    const n = this.v.get(id);
    if (!n) return;
    if (this.isQuote(id)) {
      const g = this.quotedGroup(id);
      return g ? this.host.openGroup(g) : this.jump(id); // 引用は元の場所へ(グループはそのグループ自身の中へ)
    }
    if (n.type === "group") return this.host.openGroup(id);
    if (n.type === "frame") return this.renameFrame(id);
    if (n.type === "text" && n.paper) return this.host.openPaper?.(n.paper);
    if (n.type === "text" && n.file) return this.host.openFile?.(n.file);
    if (n.type === "text" && n.cite) return this.openCite(id);
    if (n.type === "text") {
      const r = this.rects.get(id);
      if (r) this.startEdit(id, r.x, r.y, null, n.title);
      return;
    }
    // 本文はノートだけ(2026-11-23 利用者)。カードは選ぶと右の欄に詳細が出る
    if (n.type === "note") this.openNote(id);
    else if (n.body.trim()) this.host.openBody(id);
    else this.setSelection([id]);
  }

  // ---------- ボードの中を探す(Ctrl+K。2026-11-24 利用者。2026-11-26 に Ctrl+F と入れ替え) ----------
  private findBox: HTMLElement | null = null;
  findInBoard(): void {
    if (this.findBox) {
      const i = this.findBox.querySelector("input")!;
      i.focus();
      i.select();
      return;
    }
    const inp = h("input", { class: "find-input", type: "text", placeholder: T.findPh, spellcheck: "false", title: T.findTip }) as HTMLInputElement;
    const cnt = h("span", { class: "find-count" });
    const box = h("div", { class: "find-box" }, inp, cnt);
    let hits: string[] = [];
    let k = -1;
    const textOf = (id: string) => {
      const n0 = this.v.get(id);
      const n = n0?.type === "alias" && n0.target ? this.v.get(n0.target) : n0;
      if (!n) return "";
      return [n.card ? cardName(n.card) : "", n.title, n.body].join(" ").toLowerCase();
    };
    const mark = () => {
      const set = new Set(hits);
      for (const [id, el] of this.els) el.classList.toggle("found", set.has(id));
    };
    const go = (d: number) => {
      if (!hits.length) return;
      k = (k + d + hits.length) % hits.length;
      this.centerOn(hits[k]);
      cnt.textContent = `${k + 1}/${hits.length}`;
    };
    const run = () => {
      const words = inp.value.toLowerCase().split(/\s+/).filter(Boolean);
      const pos = (id: string) => this.rects.get(id)!;
      hits = words.length ? [...this.rects.keys()].filter((id) => words.every((w) => textOf(id).includes(w))) : [];
      hits.sort((a, b) => pos(a).y - pos(b).y || pos(a).x - pos(b).x);
      k = -1;
      mark();
      cnt.textContent = words.length && !hits.length ? T.findNone : "";
      if (hits.length) go(1);
    };
    const close = () => {
      box.remove();
      this.findBox = null;
      hits = [];
      mark();
      this.el.focus({ preventScroll: true });
    };
    inp.addEventListener("input", run);
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        go(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
    box.addEventListener("pointerdown", (e) => e.stopPropagation());
    (box as HTMLElement & { close?: () => void }).close = close;
    this.findBox = box;
    this.el.append(box);
    inp.focus();
  }
  closeFind(): void {
    (this.findBox as (HTMLElement & { close?: () => void }) | null)?.close?.();
  }

  /** 引用(ほかのグループの物の引用・同じボードの中の引用) */
  isQuote(id: string): boolean {
    return this.v.isRefIn(this.group, id) || this.v.get(id)?.type === "alias";
  }

  /** 引用(ボードの中の引用も)がグループなら、そのグループの ID */
  private quotedGroup(id: string): string | null {
    const n = this.v.get(id);
    const t = n?.type === "alias" ? (n.target ? this.v.get(n.target) : undefined) : n;
    return t?.type === "group" ? t.id : null;
  }

  /** 引用の元の場所へ */
  jump(id: string): void {
    const n = this.v.get(id);
    const target = n?.type === "alias" ? n.target : id;
    if (!target || !this.v.exists(target)) return toast(T.aliasMissing);
    if (this.host.jump) this.host.jump(target, id);
    else this.host.goToNode(target);
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
    const over0 = d.ids.length ? this.nodeAtPoint(e.clientX, e.clientY, new Set(d.ids)) : null;
    const over = over0 && this.v.get(over0)?.type === "frame" ? null : over0; // 枠の上は、ただ動かす
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
        const title = this.autoTitle([over, ...d.ids]);
        const g = this.v.tx(() => {
          const g = this.v.bundle(this.group, [over, ...d.ids], title, d.strokes);
          this.v.move(this.group, [{ id: g.id, x: tpos.x, y: tpos.y }]);
          return g;
        });
        this.renderNow();
        this.setSelection([g.id]);
        if (!title) this.renameGroup(g.id);
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
  /** このボードの中で、線でつながっている物を全部(directed = 矢印は向きの先だけ) */
  connectedFrom(start: string[], directed: boolean): string[] {
    const here = new Set(this.rects.keys());
    const adj = new Map<string, Set<string>>();
    const add = (a: string, b: string) => (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    for (const id of here) {
      for (const l of this.v.get(id)?.links ?? []) {
        if (!here.has(l.to)) continue;
        add(id, l.to);
        if (!directed || l.kind !== "arrow") add(l.to, id);
      }
    }
    const seen = new Set(start.filter((i) => here.has(i)));
    const q = [...seen];
    while (q.length) for (const b of adj.get(q.shift()!) ?? []) if (!seen.has(b)) (seen.add(b), q.push(b));
    return [...seen];
  }
  handleKey(e: KeyboardEvent): boolean {
    if (this.draft) return false;
    if (this.readOnly) return e.ctrlKey && e.key === "0" ? (this.fitAll(), true) : false;
    const ids = [...this.selection];
    const k = e.key.toLowerCase();
    if (e.key === "Escape" && this.pen.on) return false; // ペンモードを抜けるのは app
    // 選んだ線: R で反転・Delete で外す・Esc で選ぶのをやめる(統合仕様 4.2)
    if (this.edgeSel.size && !ids.length && !this.strokeSel.size) {
      const keys = [...this.edgeSel];
      if (e.key === "Escape") {
        this.setEdgeSel([]);
        return true;
      }
      if (!e.ctrlKey && !e.altKey && k === "r") {
        this.reverseEdges(keys);
        return true;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        this.removeEdges(keys);
        return true;
      }
      // 数字キー: 1〜5 でその番号の線の種類に(メニューの並びと同じ。2026-11-25 利用者)
      const num = !e.ctrlKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key) ? NEW_LINK_KINDS[Number(e.key) - 1] : undefined;
      if (num) {
        this.v.tx(() => this.edgeLinks(keys).forEach((x) => this.v.setLinkProps(x.from, x.to, { kind: num })));
        this.renderEdges();
        return true;
      }
    }
    // 数字キー: 選んだ文字・ノートの背景色(1〜8、0 で色なし)。線を選んでいるときは線の種類
    if (ids.length && !this.edgeSel.size && !e.ctrlKey && !e.altKey && !e.metaKey && /^[0-8]$/.test(e.key)) {
      const tg = ids.filter((i) => this.fillable(i));
      if (tg.length) {
        this.v.tx(() => tg.forEach((i) => this.v.update(i, { fill: Number(e.key) })));
        return true;
      }
    }
    if (e.key === "Escape" && (ids.length || this.strokeSel.size)) {
      this.setSelection([]); // 選択を外す
      return true;
    }
    if (e.key === "Escape" && refCutFrom) {
      refClip = [];
      refCutFrom = null;
      this.markCut();
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && k === "c" && ids.length) {
      this.copySelection(ids);
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && k === "x" && ids.length) {
      this.copySelection(ids, true);
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && k === "k") {
      this.findInBoard();
      return true;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!ids.length && !this.strokeSel.size) return false;
      this.v.tx(() => {
        this.deleteItems(ids, true);
        this.v.removeStrokes(this.group, [...this.strokeSel]);
      });
      return true;
    }
    // Alt+A: 選んだ物と線でつながっている物を、先の先までたどって全部選ぶ(向きは見ない)。
    // Ctrl+Alt+A: 矢印の向きの先だけをたどる(向きの無い線は両方へ)。2026-11-27 利用者
    if (e.altKey && k === "a" && ids.length) {
      this.setSelection(this.connectedFrom(ids, e.ctrlKey));
      return true;
    }
    if (e.ctrlKey && k === "a") {
      this.setSelection(this.rects.keys(), this.v.strokesOf(this.group).map((s) => s.id));
      return true;
    }
    // 引用は Q(2026-11-26 修正14): Ctrl+Q = 引用として貼る・Ctrl+Shift+Q = 引用で新しいグループ(前は Ctrl+Shift+G)
    if (e.ctrlKey && e.shiftKey && k === "q") {
      this.quoteGroupSelection();
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && k === "q") {
      void this.quotePaste();
      return true;
    }
    if (e.ctrlKey && k === "g") {
      this.bundleSelection();
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && k === "b") {
      this.frameSelection();
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
    // 選んでいる物(枠も)から Tab: つながった子の文字を書き始める(2026-11-24)
    if (e.key === "Tab" && !e.ctrlKey && !e.shiftKey && ids.length === 1 && this.rects.has(ids[0])) {
      const p = this.spot(ids[0]);
      this.startEdit(null, p.x, p.y, ids[0], "", p.left);
      return true;
    }
    return false;
  }

  /**
   * Ctrl+C: 選んだ物を覚える。貼る(Ctrl+V)と引用として入る(同じボードなら、ボードの中の引用)。
   * Ctrl+X(cut): 貼った所へ移す(元のグループからは外れる)。システムのコピーにも目印の文字を入れる
   */
  copySelection(ids: string[], cut = false): void {
    // ボードの中の引用をコピーしたら、元の物をコピーしたことにする
    const pick = (id: string) => (!cut && this.v.get(id)?.type === "alias" ? this.v.get(id)!.target ?? id : id);
    refClip = ids.map((id) => ({ id: pick(id), ...(this.v.itemPos(this.group, id) ?? { x: 0, y: 0 }) }));
    refCutFrom = cut ? this.group : null;
    // システムのコピーには Markdown を入れる(外のエディタや AI にそのまま貼れる。2026-11-24 統合仕様 2)。
    // bresuto の中で貼ると、同じ文字なので引用(切り取りなら移動)になる。外で別の物をコピーすると、文字が変わるので使わない
    refClipMark = selectionToMarkdown(this.v, this.group, ids).trim() || (cut ? T.cutMark : T.copiedMark)(ids.length);
    void navigator.clipboard?.writeText(refClipMark).catch(() => {});
    setClip({ kind: "nodes" }, refClipMark);
    toast((cut ? T.cutToast : T.copiedToast)(ids.length));
    this.markCut();
  }

  /** 切り取った物を薄く見せる(貼るまで) */
  private markCut(): void {
    const cut = refCutFrom === this.group ? new Set(refClip.map((r) => r.id)) : new Set<string>();
    for (const [id, el] of this.els) el.classList.toggle("cut", cut.has(id));
  }

  /** Ctrl+V(app の paste から): コピーした物を、このグループに引用として貼る。見えている真ん中に、元の並びのまま */
  pasteRefs(at?: { x: number; y: number }): boolean {
    if (!refClip.length || this.readOnly) return false;
    const c = at ?? this.visibleCenter();
    const x0 = Math.min(...refClip.map((r) => r.x)), y0 = Math.min(...refClip.map((r) => r.y));
    const x1 = Math.max(...refClip.map((r) => r.x)), y1 = Math.max(...refClip.map((r) => r.y));
    const dx = c.x - (x0 + x1) / 2, dy = c.y - (y0 + y1) / 2;
    const made: string[] = [];
    if (refCutFrom) return this.pasteCut(dx, dy);
    let refused = 0;
    this.v.tx(() => {
      for (const r of refClip) {
        if (!this.v.exists(r.id)) continue;
        const x = Math.round(r.x + dx), y = Math.round(r.y + dy);
        // 画像は引用にせず、ふつうに複製する(2026-11-25 修正11)
        const src = this.v.get(r.id);
        if (src?.type === "text" && src.file && isImageFile(src.file)) {
          const id = this.v.duplicateImage(r.id, this.group, x, y, r.w);
          if (id) made.push(id);
          continue;
        }
        // このボードにもうある物: ボードの中の引用を置く(2026-11-24 利用者)
        if (this.v.itemPos(this.group, r.id) || r.id === this.group) {
          made.push(this.v.create({ type: "alias", target: r.id, group: this.group, x, y }).id);
          continue;
        }
        if (!this.v.canContain(this.group, r.id) && this.v.get(r.id)?.type === "group") {
          refused++; // 自分の上のグループは引用できない
          continue;
        }
        if (this.v.addRef(this.group, r.id, x, y)) made.push(r.id);
      }
    });
    this.renderNow();
    this.setSelection(made);
    toast(made.length ? T.pastedRefs(made.length) + (refused ? T.cycleRefused : "") : T.pastedNone);
    return true;
  }

  /**
   * Ctrl+V(2026-11-26 修正14): コピーした物を、ふつうに複製して貼る(引用は Ctrl+Q)。切り取った物は移す。
   * 文字・ノート・カード・囲い・画像を複製し、その中どうしの線も写す。グループは複製しない(Ctrl+Q で引用)
   */
  pasteCopies(at?: { x: number; y: number }): boolean {
    if (!refClip.length || this.readOnly) return false;
    const c = at ?? this.visibleCenter();
    const x0 = Math.min(...refClip.map((r) => r.x)), y0 = Math.min(...refClip.map((r) => r.y));
    const x1 = Math.max(...refClip.map((r) => r.x)), y1 = Math.max(...refClip.map((r) => r.y));
    const dx = c.x - (x0 + x1) / 2, dy = c.y - (y0 + y1) / 2;
    if (refCutFrom) return this.pasteCut(dx, dy);
    const made = new Map<string, string>();
    let skipped = 0;
    this.v.tx(() => {
      for (const r of refClip) {
        const src = this.v.get(r.id);
        if (!src) continue;
        const x = Math.round(r.x + dx), y = Math.round(r.y + dy);
        if (src.type === "text" && src.file && isImageFile(src.file)) {
          const id = this.v.duplicateImage(r.id, this.group, x, y, r.w);
          if (id) made.set(r.id, id);
          continue;
        }
        if (src.type === "group" || src.type === "alias") {
          skipped++;
          continue;
        }
        const n = this.v.create({ type: src.type, title: src.title, body: src.body, group: this.group, x, y, color: src.color, fill: src.fill, file: src.file, paper: src.paper, cite: src.cite, kind: src.kind, card: src.card, spread: src.spread, size: src.size });
        made.set(r.id, n.id);
      }
      for (const [from, to] of made) for (const l of this.v.get(from)?.links ?? []) if (made.has(l.to)) this.v.addLink(to, made.get(l.to)!, l.kind);
    });
    this.renderNow();
    this.setSelection([...made.values()]);
    toast(made.size ? T.pastedCopies(made.size) + (skipped ? T.pastedGroupsSkipped(skipped) : "") : skipped ? T.pastedGroupsOnly : T.pastedNone);
    return true;
  }

  /** Ctrl+Q: コピーした物を引用として貼る。ノートの文章なら引用の文字(元の所とつながる)、ボードの物ならこれまでの引用 */
  async quotePaste(at?: { x: number; y: number }): Promise<void> {
    if (this.readOnly) return;
    const clip = await currentClip();
    if (clip?.kind === "passage") return this.placeCite(clip, at ?? this.visibleCenter());
    if (clip?.kind === "nodes" && refClip.length) {
      this.pasteRefs(at);
      return;
    }
    toast(T.quoteNothing);
  }
  private placeCite(clip: PassageClip, at: { x: number; y: number }): void {
    if (!this.v.exists(clip.note)) return toast(T.quoteNothing);
    const anchor = this.host.anchorPassage?.(clip) ?? null;
    const id = this.v.create({ type: "text", title: clip.text, cite: anchor ? citeOf(clip.note, anchor) : clip.note, group: this.group, x: Math.round(at.x - 60), y: Math.round(at.y - 12) }).id;
    this.renderNow();
    this.setSelection([id]);
    toast(T.citePlaced);
  }
  private openCite(id: string): void {
    const c = parseCite(this.v.get(id)?.cite);
    if (c && this.v.exists(c.note)) this.host.openCite?.(c.note, c.anchor);
  }
  /** 引用の文字に見せる文章: 元のノートの目印の所(見つからなければ、引用したときの文章) */
  citeText(n: TDNode): string {
    const c = parseCite(n.cite);
    const note = this.v.get(c?.note ?? (n.cite ?? "").slice(0, 10));
    return (c && note ? anchorText(note.body, c.anchor) : null) ?? n.title;
  }

  /** 切り取った物を、このグループへ移す */
  private pasteCut(dx: number, dy: number): boolean {
    const from = refCutFrom!;
    const moved: string[] = [];
    let refused = 0;
    this.v.tx(() => {
      for (const r of refClip) {
        if (!this.v.exists(r.id) || !this.v.itemPos(from, r.id)) continue;
        const x = Math.round(r.x + dx), y = Math.round(r.y + dy);
        if (from === this.group) {
          this.v.move(this.group, [{ id: r.id, x, y }]);
          moved.push(r.id);
          continue;
        }
        if (this.v.itemPos(this.group, r.id)) {
          refused++; // もうここにある
          continue;
        }
        try {
          this.v.moveToGroup(from, this.group, r.id, x, y);
          moved.push(r.id);
        } catch (err) {
          if (err instanceof CycleError) refused++;
          else throw err;
        }
      }
    });
    refClip = [];
    refCutFrom = null;
    refClipMark = "";
    this.renderNow();
    this.markCut();
    this.setSelection(moved);
    toast(moved.length ? T.pastedCut(moved.length) + (refused ? T.pastedSkipped(refused) : "") : T.pastedNone);
    return true;
  }

  bundleSelection(): void {
    const ids = [...this.selection];
    const strokes = [...this.strokeSel];
    if (!ids.length && !strokes.length) return;
    const title = this.autoTitle(ids);
    const g = this.v.bundle(this.group, ids, title, strokes);
    this.renderNow();
    this.setSelection([g.id]);
    if (!title) this.renameGroup(g.id); // 題が決まったら、名前の入力は出さない(直すのは鉛筆か右クリック)
  }
  /** 束ねる物の中の、決めた色の背景の文字(左上のもの)。無ければ "" */
  private autoTitle(ids: string[]): string {
    const items = ids.flatMap((id) => {
      const n = this.v.get(id), p = this.v.itemPos(this.group, id);
      return n && p ? [{ type: n.type, title: n.title, fill: n.fill, file: n.file, paper: n.paper, x: p.x, y: p.y }] : [];
    });
    return autoGroupTitle(items, groupPrefs.titleFill);
  }

  /** 選んだ物の外接の箱(この画面の座標) */
  private selBox(ids: string[], strokes: string[]): Rect | null {
    const bs: Rect[] = ids.map((i) => this.rects.get(i)).filter((r): r is Rect => !!r);
    for (const s of this.v.strokesOf(this.group)) if (strokes.includes(s.id)) bs.push(strokeBox(s));
    if (!bs.length) return null;
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Ctrl+Shift+Q(前は Ctrl+Shift+G): 選んだ物はそのまま、それを引用した新しいグループを、選んだ物の右に置く(2026-11-24 利用者) */
  quoteGroupSelection(): void {
    const ids = [...this.selection];
    const strokes = [...this.strokeSel];
    const b = this.selBox(ids, strokes);
    if (!b) return;
    const title = this.autoTitle(ids);
    const g = this.v.quoteGroup(this.group, ids, Math.round(b.x + b.w + 60), Math.round(b.y + b.h / 2 - 14), title, strokes);
    this.renderNow();
    this.setSelection([g.id]);
    if (!title) this.renameGroup(g.id);
  }

  private frameIds(): Set<string> {
    const out = new Set<string>();
    for (const id of this.rects.keys()) if (this.v.get(id)?.type === "frame") out.add(id);
    return out;
  }

  /** 枠の中にある物(真ん中が枠の内側)。中の枠の中身も含む */
  private frameContents(ids: string[]): { ids: string[]; strokes: string[] } {
    const outIds = new Set<string>(), outStrokes = new Set<string>();
    const stack = ids.filter((i) => this.v.get(i)?.type === "frame");
    const seen = new Set<string>();
    const inBox = (f: Rect, b: Rect) => {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      return cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h;
    };
    while (stack.length) {
      const fid = stack.pop()!;
      if (seen.has(fid)) continue;
      seen.add(fid);
      const f = this.rects.get(fid);
      if (!f) continue;
      for (const [id, r] of this.rects) {
        if (id === fid || outIds.has(id)) continue;
        // 中の枠は丸ごと内側にあるときだけ(大きい外の枠を拾わない)
        const isFrame = this.v.get(id)?.type === "frame";
        if (isFrame ? r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h : inBox(f, r)) {
          outIds.add(id);
          if (isFrame) stack.push(id);
        }
      }
      for (const s of this.v.strokesOf(this.group)) if (inBox(f, strokeBox(s))) outStrokes.add(s.id);
    }
    return { ids: [...outIds], strokes: [...outStrokes] };
  }

  /** Ctrl+B: 選んだ物を枠で囲む(所属は変えない。2026-11-24 利用者) */
  frameSelection(): void {
    const ids = [...this.selection];
    const strokes = [...this.strokeSel];
    const b = this.selBox(ids, strokes);
    if (!b || this.readOnly) return;
    const pad = 20;
    const f = this.v.create({ type: "frame", group: this.group, x: Math.round(b.x - pad), y: Math.round(b.y - pad - 10), size: { w: Math.round(b.w + pad * 2), h: Math.round(b.h + pad * 2 + 10) } });
    this.renderNow();
    this.setSelection([f.id]);
  }

  /** 枠の名前: 名前の所で、ノードの名前を書くときと同じ入力で書く(特別な入力欄は出さない。2026-11-25 利用者) */
  renameFrame(id: string): void {
    const r = this.rects.get(id);
    const n = this.v.get(id);
    if (!r || !n) return;
    this.startEdit(id, Math.round(r.x + 12), Math.round(r.y - 12), null, n.title);
    this.draft!.ta.classList.add("for-frame");
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

  private fillable(id: string): boolean {
    const n = this.v.get(id);
    return !!n && !this.isQuote(id) && ((n.type === "text" && !n.file && !n.paper) || n.type === "note");
  }

  /** 文字の背景の色 */
  private fillItem(ids: string[]): MenuItem {
    const cur = this.v.get(ids[0])?.fill ?? 0;
    const set = (c: number) => this.v.tx(() => ids.forEach((i) => this.v.update(i, { fill: c })));
    return {
      label: T.fill,
      swatches: Array.from({ length: PRESET_COLORS + 1 }, (_, c) => ({ color: c, title: c ? `${T.fill} ${c}` : T.fillNone, active: c === cur, key: String(c), action: () => set(c) })),
    };
  }

  /**
   * ノードの右クリック(2026-11-24 利用者が見本 X を選んだ。線のメニューくらい小さく):
   * 絵のボタン 1 段(開く/書き直す・リンク・束ねる・引用で新しいグループ・枠・削除)→ 文字色・背景色 →「別のグループへ ›」「その他 ›」。
   * 前からある操作は、小メニューの中に全部ある
   */
  private nodeMenu(id: string, x: number, y: number): void {
    const n = this.v.get(id);
    if (!n) return;
    const ids = this.selection.has(id) ? [...this.selection] : [id];
    const isRef = this.isQuote(id);
    const allRefs = ids.every((i) => this.v.isRefIn(this.group, i));
    const many = ids.length > 1;
    const bar: NonNullable<MenuItem["bar"]> = [];
    if (!many && isRef) {
      const g = this.quotedGroup(id);
      if (g) bar.push({ icon: "open", label: T.mOpen, title: T.openGroup, action: () => this.host.openGroup(g) });
      else bar.push({ icon: "open", label: T.mOrigin, title: T.jumpTip + " (↗・ダブルクリック)", action: () => this.jump(id) });
    } else if (!many) {
      if (n.type === "group") bar.push({ icon: "open", label: T.mOpen, title: T.openGroup, action: () => this.host.openGroup(id) });
      else if (n.type === "text" && n.paper) bar.push({ icon: "open", label: T.mOpen, title: PT.title, action: () => this.host.openPaper?.(n.paper!) });
      else if (n.type === "text" && n.file) bar.push({ icon: "open", label: T.mOpen, title: T.openFile, action: () => this.host.openFile?.(n.file!) });
      else if (n.type === "text") bar.push({ icon: "edit", label: T.mEdit, title: T.editText + " (R)", key: "r", action: () => this.editText(id) });
      else if (n.type === "note") bar.push({ icon: "open", label: T.mOpen, title: T.openNote, action: () => this.openNote(id) });
      else bar.push({ icon: "open", label: T.mOpen, action: () => this.open(id) });
    }
    bar.push({ icon: "link", label: T.linkShort, title: T.linkSearch, action: () => this.linkBySearch() });
    bar.push({ icon: "bundle", label: T.bundleShort, title: `${T.bundleShort}: ${T.bundleDesc} (Ctrl+G)`, action: () => this.bundleSelection() });
    bar.push({ icon: "quotegroup", label: T.quoteGroupShort, title: `${T.quoteGroup}: ${T.quoteGroupDesc} (Ctrl+Shift+Q)`, action: () => this.quoteGroupSelection() });
    bar.push({ icon: "frame", label: T.frameShort, title: `${T.frameShort2}: ${T.frameDesc} (Ctrl+B)`, action: () => this.frameSelection() });
    // 原本を消す(ゴミ箱)と、引用を外すだけ を分ける
    bar.push({ icon: "trash", label: allRefs ? T.removeRefShort : T.deleteShort, title: (allRefs ? T.deleteRef : T.delete) + " (Delete)", danger: true, action: () => this.deleteItems(ids, true) });

    const items: MenuItem[] = [];
    if (many) items.push({ label: T.selCount(ids.length), heading: true });
    items.push({ label: "", bar });
    const texts = ids.every((i) => this.v.get(i)?.type === "text" && !this.v.get(i)?.file && !this.v.get(i)?.paper);
    items.push({ ...this.colorItem(ids), label: texts ? T.textColorShort : T.color });
    const fills = ids.filter((i) => this.fillable(i));
    if (fills.length) items.push({ ...this.fillItem(fills), label: T.fillShort });
    // ノート(チェックリスト・表も)の名前: 右クリックして R(題が無いものは、ここで付ける)
    if (!many && !isRef && n.type === "note")
      items.push({
        label: T.rename,
        key: "r",
        action: async () => {
          const t = await askText(T.rename, n.title);
          if (t !== null) this.v.update(id, { title: t.trim() });
        },
      });
    if (!many && !isRef && n.type === "card" && n.card?.deck === "tarot") {
      items.push({ label: T.cardAssign, action: () => this.assignCard(id) });
    }
    items.push({ separator: true, label: "" });
    // 別のグループへ(移す・入れる・引用・外す)
    const rel: MenuItem[] = [...this.groupMenuItems(ids)];
    rel.push({ separator: true, label: "" });
    if (allRefs) rel.push({ label: T.removeRef, desc: T.removeRefDesc, action: () => this.v.tx(() => ids.forEach((i) => this.v.removeFromGroup(this.group, i))) });
    else
      rel.push({
        label: T.removeFromGroup,
        desc: T.removeFromGroupDesc,
        action: () => {
          let refused = false;
          this.v.tx(() => ids.forEach((i) => (refused = !this.v.removeFromGroup(this.group, i) || refused)));
          if (refused && this.group === ROOT_ID) toast(T.rootLastParent);
        },
      });
    items.push({ label: T.mRelMenu, sub: rel });
    // その他
    const more: MenuItem[] = [
      { label: T.copyShort, hint: "Ctrl+C", desc: T.copyDesc, action: () => this.copySelection(ids) },
      { label: T.cutShort, hint: "Ctrl+X", desc: T.cutDesc, action: () => this.copySelection(ids, true) },
    ];
    if (this.host.openBeside && !many) more.push({ label: T.mBeside, hint: n.type === "group" ? "中ボタン" : undefined, action: () => this.host.openBeside!(id) });
    if (!many && !isRef && n.type === "group") more.push({ label: T.rename, action: () => this.renameGroup(id) }, { label: T.unbundle, desc: T.unbundleDesc, action: () => this.v.unbundle(id) });
    if (!many && !isRef && n.type === "frame") more.push({ label: T.rename, action: () => this.renameFrame(id) });
    if (!many && !isRef && n.type === "text" && n.file) more.push({ label: T.rename, action: () => this.editText(id) });
    if (!many && !isRef && n.type === "text" && n.cite) more.push({ label: T.citeToPlain, action: () => this.v.update(id, { title: this.citeText(n), cite: null }) });
    if (!many && !isRef && n.type === "card" && n.card?.deck === "tarot") more.push({ label: T.cardFlip, checked: n.card.reversed, action: () => this.v.setCard(id, { ...n.card!, reversed: !n.card!.reversed }) });
    items.push({ label: T.mMoreMenu, sub: more });
    showMenu(x, y, items);
  }

  /** ほかのグループへ入れる・引用する(選んだときのバーの「グループへ」) */
  private groupMenuItems(ids: string[]): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: T.moveTo,
        desc: T.moveToDesc,
        key: "m",
        action: async () => {
          const g = await this.host.pickGroup(T.pickMoveTitle);
          if (!g || g === this.group) return;
          try {
            this.v.tx(() => ids.forEach((i, k) => this.v.moveToGroup(this.group, g, i, (k % 5) * 160, 40 + Math.floor(k / 5) * 60)));
            toast(T.movedTo(this.v.get(g)?.title || T.untitledGroup));
          } catch (err) {
            if (err instanceof CycleError) toast(T.cycleRefused);
            else throw err;
          }
        },
      },
      {
        label: T.addToGroup,
        desc: T.addToGroupDesc,
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
        desc: T.quoteIntoDesc,
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
  /** チェックリスト・表を、その場所にノードとして置いて開く(題だけがキャンバスに出る) */
  attachNodeAt(kind: "check" | "table", x: number, y: number, pasted?: string): void {
    const content = kind === "check" ? makeChecklist() : makeTable(2, 2); // 最初は 2 列(2026-11-25 修正11)
    const body = pasted ?? serializeMarkdown(mdSchema.nodes.doc.create(null, [content, mdSchema.nodes.paragraph.create()]));
    const n = this.v.create({ type: "note", kind: kind === "check" ? "check" : "table", title: "", group: this.group, x: Math.round(x), y: Math.round(y) }); // 題は最初は無し(「表」などとも出さない)
    this.v.setBody(n.id, body);
    this.renderNow();
    // 中身が見える大きさなので、ほかのものにかぶるなら下へずらす
    for (let guard = 0; guard < 20; guard++) {
      const me = this.rects.get(n.id);
      const hit = me && [...this.rects].find(([id, r]) => id !== n.id && r.x < me.x + me.w && me.x < r.x + r.w && r.y < me.y + me.h && me.y < r.y + r.h);
      if (!me || !hit) break;
      const p = this.v.itemPos(this.group, n.id)!;
      this.v.move(this.group, [{ id: n.id, x: p.x, y: Math.round(p.y + hit[1].y + hit[1].h + 16 - me.y) }]);
      this.renderNow();
    }
    this.setSelection([n.id]);
    if (!pasted) this.openNote(n.id);
  }
  /** 添付の選び方(右上の「添付」と空きの右クリックで共通) */
  attachItems(x: number, y: number): MenuItem[] {
    return [
      {
        label: "",
        bar: [
          { icon: "file", label: T.attachFile, title: T.attachFileTip, action: () => this.pickFilesAt(x, y) },
          { icon: "check", label: T.attachChecklist, title: T.attachChecklistTip, action: () => this.attachNodeAt("check", x, y) },
          { icon: "table", label: T.attachTable, title: T.attachTableTip, action: () => this.attachNodeAt("table", x, y) },
        ],
      },
    ];
  }
  /** 右上の「添付」ボタンから: 見えている画面の真ん中に置く */
  openAttachMenu(anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const p = this.visibleCenter();
    showMenu(r.left, r.bottom + 4, this.attachItems(Math.round(p.x), Math.round(p.y)));
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
          this.openNote(n.id);
        },
      },
      { label: T.attachHead, heading: true },
      ...this.attachItems(px, py),
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

  /** 線の文字をその場で書く(線のダブルクリック・右クリック)。Enter・Esc・外を押すと決まる・空にすると消える */
  editLinkLabel(from: string, to: string): void {
    const l = this.v.get(from)?.links.find((x) => x.to === to);
    const a = this.rects.get(from), b = this.rects.get(to);
    if (!l || !a || !b) return;
    this.commitDraft("esc");
    const p1 = this.clip(a, b.x + b.w / 2, b.y + b.h / 2);
    const p2 = this.clip(b, a.x + a.w / 2, a.y + a.h / 2);
    const at = this.labelAt(from + ">" + to, l);
    let mx = p1.x + (p2.x - p1.x) * at, my = p1.y + (p2.y - p1.y) * at;
    // 文字がもうあるなら、その場所で(よけて曲がった線では、まっすぐの線の上とは違う)
    const m0 = /translate\(([-\d.]+),([-\d.]+)\)/.exec(this.edgesSvg.querySelector(`.elabel[data-from="${from}"][data-to="${to}"]`)?.getAttribute("transform") ?? "");
    if (m0) (mx = +m0[1]), (my = +m0[2]);
    const inp = h("input", { class: "edgelabel-input", type: "text", spellcheck: "false", placeholder: T.labelPrompt }) as HTMLInputElement;
    inp.value = l.label ?? "";
    if (l.size) inp.style.fontSize = l.size + "px";
    const fit = () => (inp.style.width = Math.max(80, [...(inp.value || T.labelPrompt)].length * (l.size ?? 15) + 24) + "px");
    fit();
    inp.style.left = mx + "px";
    inp.style.top = my + "px";
    this.edgesSvg.querySelector(`.elabel[data-from="${from}"][data-to="${to}"]`)?.setAttribute("visibility", "hidden");
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      inp.remove();
      if (ok && inp.value.trim() !== (l.label ?? "")) this.v.setLinkLabel(from, to, inp.value.trim());
      else this.renderEdges();
      this.el.focus({ preventScroll: true });
    };
    inp.addEventListener("input", fit);
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      // Esc でも、書いた文字は残す(2026-11-24 利用者)
      if (e.key === "Enter" || e.key === "Escape") finish(true);
    });
    inp.addEventListener("blur", () => finish(true));
    inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.draftLayer.append(inp);
    inp.focus();
    inp.select();
  }

  // ---------- 線を選ぶ・まとめて直す(2026-11-24 統合仕様 4) ----------
  setEdgeSel(keys: Iterable<string>): void {
    const ks = new Set(keys);
    if (ks.size && (this.selection.size || this.strokeSel.size)) this.setSelection([]);
    this.edgeSel = ks;
    for (const g of this.edgesSvg.querySelectorAll<SVGGElement>("g.edge, g.elabel")) g.classList.toggle("selected", ks.has(g.getAttribute("data-from") + ">" + g.getAttribute("data-to")));
  }
  private edgeLinks(keys: Iterable<string>): { from: string; to: string; l: Link }[] {
    const out: { from: string; to: string; l: Link }[] = [];
    for (const k of keys) {
      const [from, to] = k.split(">");
      const l = this.v.get(from)?.links.find((x) => x.to === to);
      if (l) out.push({ from, to, l });
    }
    return out;
  }
  /** 線の色: その線に付けた色、無ければその種類のいつもの色(2026-11-24 利用者) */
  linkColor(l: Link): number {
    return l.color || this.host.kindColor?.(l.kind) || 0;
  }

  /** 選んだ線の向きを逆に(種類・色・文字はそのまま)。逆向きの線がもうある所はしない */
  reverseEdges(keys: string[]): void {
    let refused = 0;
    const next: string[] = [];
    this.v.tx(() => {
      for (const { from, to } of this.edgeLinks(keys)) {
        if (this.v.reverseLink(from, to)) next.push(to + ">" + from);
        else refused++;
      }
    });
    this.edgeSel = new Set(next);
    this.renderEdges();
    if (refused) toast(T.reverseRefused(refused));
  }
  removeEdges(keys: string[]): void {
    this.v.tx(() => {
      for (const { from, to } of this.edgeLinks(keys)) this.v.removeLink(from, to);
    });
    this.edgeSel.clear();
  }

  /** 線の右クリック: 上から 反転・削除 → 色 → 線の種類(統合仕様 4.3)。選んである線なら、選んだ線全部に */
  private edgeMenu(from: string, to: string, x: number, y: number): void {
    const key = from + ">" + to;
    if (!this.edgeSel.has(key)) this.setEdgeSel([key]);
    const keys = [...this.edgeSel];
    const links = this.edgeLinks(keys);
    if (!links.length) return;
    const same = <T,>(f: (l: Link) => T): T | undefined => (links.every((x) => f(x.l) === f(links[0].l)) ? f(links[0].l) : undefined);
    const kind = same((l) => l.kind);
    const color = same((l) => l.color ?? 0);
    const set = (p: Parameters<Vault["setLinkProps"]>[2]) => this.v.tx(() => links.forEach((x) => this.v.setLinkProps(x.from, x.to, p)));
    const items: MenuItem[] = [];
    if (links.length > 1) items.push({ label: T.edgesCount(links.length), heading: true });
    items.push({
      label: "",
      bar: [
        { icon: "reverse", label: T.linkReverseShort, title: T.linkReverse + " (R)", key: "r", action: () => this.reverseEdges(keys) },
        { icon: "trash", label: T.edgeDelete, title: T.linkRemove + " (Delete)", danger: true, action: () => this.removeEdges(keys) },
      ],
    });
    items.push({
      label: T.color,
      swatches: Array.from({ length: PRESET_COLORS + 1 }, (_, c) => ({ color: c, title: c ? `${T.color} ${c}` : T.colorDefault, active: c === color, action: () => set({ color: c }) })),
    });
    items.push({ label: T.linkKind, heading: true });
    for (const k of NEW_LINK_KINDS) items.push({ label: T.kinds[k], preview: kindPreview(k), checked: kind === k, action: () => set({ kind: k }) });
    // 古い種類(太線・対立)の線は、そのまま見せる(選び直すと新しい種類になる)
    if (kind && !NEW_LINK_KINDS.includes(kind)) items.push({ label: T.kinds[kind] + T.oldKind, preview: kindPreview(kind), checked: true, disabled: true });
    // 線の設定(種類ごとのいつもの色を、1 つずつ決める画面。2026-11-24 利用者)
    if (this.host.openLineSettings) items.push({ separator: true, label: "" }, { label: T.lineSettings, action: () => this.host.openLineSettings!() });
    showMenu(x, y, items);
  }

}
