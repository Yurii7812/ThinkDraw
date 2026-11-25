// 画面全体: 上部バー・キャンバス・右の欄(詳細|グラフ)・ペン・履歴・状態の保存・自動保存
import { NEW_LINK_KINDS, ROOT_ID } from "../core/types";
import { kindPreview } from "./edgeshape";
import { Vault } from "../core/vault";
import { Canvas, PRESET_COLORS, refClipboard, type PenState, type View } from "./canvas";
import { BodyPopup } from "./editor";
import type { GraphMode } from "./graph";
import { exportGroup, type ExportKind } from "./exporter";
import { cleanKind, dayGroupTitle } from "../core/records";
import { allTags } from "../core/tags";
import { CUSTOM_FILE, parseCustomSets, setCustomPromptSets, type CustomPromptSet } from "../decks/prompts";
import { findDayGroup, findRecordNote, isDayGroup, KINDS_FILE, parseKinds, RecordsView, type RecordEntry, type RecordKind } from "./records";
import { showGroupTree } from "./grouptree";
import type { Rect } from "../core/placement";
import { openPicker } from "./picker";
import { SidePanel, type SideTab } from "./side";
import { PT, SHORTCUTS, T } from "./strings";
import { PaperView } from "./paperview";
import { paperStore } from "./paperstore";
import { cardTip, closeDrawMenu, DEFAULT_CONFIG, drawLabel, drawMenuOpen, openDrawMenu, runDraw, type DrawConfig, type DrawKind } from "./tarot";
import { api, askText, closeMenu, h, menuOpen, showMenu, svg, toast, type MenuItem } from "./ui";

type Theme = "system" | "light" | "dark";
interface AppState {
  views: Record<string, View>;
  graphOpen: boolean; // 右の欄を手で開いているか(名前は前の版のまま)。カードを選んで自動で開いた分は含めない
  graphMode: GraphMode;
  sideTab: SideTab;
  lastGroup: string;
  peekGroup?: string | null; // 横に開いているグループ
  recordKind?: string | null; // (前の版)記録一覧の種類の絞り込み
  recordMarker?: string | null; // 時系列記録のマーカーの絞り込み
  splitRatio?: number; // 画面を分けたときの左の幅の割合
  surround?: boolean; // 左の画面で「まわり」を出しているか
  islandScope?: number | null; // 島の範囲(0・1・2・全部 = null)
  tabs?: TabState[]; // タブ(2026-11-24)。1 つのときも覚える
  activeTab?: number;
}
/** タブ 1 枚: 開いているグループと、そのタブの戻る・進む */
interface TabState {
  group: string;
  back: Loc[];
  fwd: Loc[];
}
/** 履歴の 1 つ(2026-11-24 統合仕様 1): グループ・見ていた場所と倍率・選んでいた物。前の版はグループの ID だけ */
interface Loc {
  g: string;
  v?: View;
  sel?: string[];
}
function toLoc(x: unknown): Loc | null {
  if (typeof x === "string") return { g: x };
  if (x && typeof x === "object" && typeof (x as Loc).g === "string") return x as Loc;
  return null;
}
interface Config {
  theme?: Theme;
  draw?: Partial<DrawConfig>;
  pen?: Partial<PenState>;
  /** 線の種類ごとのいつもの色(2026-11-24) */
  edgeColors?: Record<string, number>;
}
const STATE_FILE = "state.json";
const HISTORY_MAX = 50; // 戻る・進むで覚える数
const HISTORY_MENU = 12; // 右クリックの一覧に出す数
/** 履歴に足す。直前と同じ場所なら足さない。古いものから捨てる */
function pushHist(stack: Loc[], loc: Loc): void {
  const top = stack[stack.length - 1];
  if (top && top.g === loc.g && JSON.stringify(top.v) === JSON.stringify(loc.v)) return;
  stack.push(loc);
  if (stack.length > HISTORY_MAX) stack.splice(0, stack.length - HISTORY_MAX);
}

/** 右上のボタンの絵(線だけの小さな SVG) */
const TOP_ICONS: Record<string, string> = {
  attach: '<path d="M20 11.5 12.5 19a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7L10.2 16.7a1.7 1.7 0 0 1-2.4-2.4L14.5 7.6"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  paper: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 11h6M10 15h6M4 6v15h12"/>',
  records: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  beside: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>',
  surround: '<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="1.5"/><circle cx="19" cy="7" r="1.5"/><circle cx="6" cy="19" r="1.5"/><path d="M10 11 6 7M14 11l4-3M10.5 14 7 18"/>',
  whole: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  export: '<path d="M12 4v11M8 8l4-4 4 4"/><path d="M5 14v6h14v-6"/>',
  draw: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="m12 8 1.2 2.6 2.8.4-2 2 .5 2.8-2.5-1.4-2.5 1.4.5-2.8-2-2 2.8-.4z"/>',
};

let paperHooked = false;

class App {
  vault!: Vault;
  canvas!: Canvas;
  /** 横に開いている、もう 1 枚のキャンバス(見ながら書く・右から左へドラッグで引用) */
  peek: Canvas | null = null;
  private peekWrap: HTMLElement | null = null;
  records: RecordsView | null = null;
  paper: PaperView | null = null;
  /** 紙PKM の画面が出ているか(閉じても取り込みの途中は残すので、画面は消さずに外すだけ) */
  paperOpen = false;
  private kinds: RecordKind[] = [];
  private customSets: CustomPromptSet[] = [];
  private leftPane!: HTMLElement;
  private leftTitle!: HTMLElement;
  private splitBar: HTMLElement | null = null;
  /** 全体の画面(見るだけ)。分割の右側か、全画面 */
  whole: Canvas | null = null;
  private wholeWrap: HTMLElement | null = null;
  private peekTitle: HTMLElement | null = null;
  side!: SidePanel;
  popup: BodyPopup | null = null;
  private sideAuto = false; // カードを選んで自動で開いている間だけ true(保存しない)
  private sidePrevTab: SideTab | null = null; // 自動で開く前の欄(自動で閉じるとき、これに戻す)
  state: AppState = { views: {}, graphOpen: false, graphMode: "local", sideTab: "map", lastGroup: ROOT_ID };
  config: Config = {};
  draw: DrawConfig = { ...DEFAULT_CONFIG };
  dir = "";
  private tabs: TabState[] = [];
  private activeTab = 0;
  private tabBar!: HTMLElement;
  private backStack: Loc[] = [];
  private fwdStack: Loc[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private stateTimer: ReturnType<typeof setTimeout> | undefined;
  private sideTimer: ReturnType<typeof setTimeout> | undefined;
  private titleEl!: HTMLElement;
  private titleBox!: HTMLElement;
  private renameBtn!: HTMLElement;
  private upBtn!: HTMLButtonElement;
  private btnBack!: HTMLButtonElement;
  private btnFwd!: HTMLButtonElement;
  private btnDraw!: HTMLButtonElement;
  private btnPen!: HTMLButtonElement;
  private penBar!: HTMLElement;
  private main!: HTMLElement;

  async boot(): Promise<void> {
    this.config = (await api().getConfig()) ?? {};
    this.draw = { ...DEFAULT_CONFIG, ...(this.config.draw ?? {}) };
    this.applyTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    const dir = await api().initialVault();
    if (dir) await this.start(dir);
    else this.welcome();
  }

  // ---------- テーマ ----------
  private applyTheme(): void {
    const t = this.config.theme ?? "system";
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }
  private setTheme(t: Theme): void {
    this.config.theme = t;
    api().setConfig({ theme: t });
    this.applyTheme();
  }

  // ---------- 最初の画面(SPEC 12 章で未決。いまはフォルダを選ぶだけ) ----------
  private welcome(): void {
    const b = h("button", { class: "btn primary big", text: T.openFolder });
    b.addEventListener("click", async () => {
      const d = await api().chooseVault();
      if (d) {
        document.body.replaceChildren();
        await this.start(d);
      }
    });
    document.body.replaceChildren(
      h("div", { class: "welcome" }, h("h1", { text: T.appName }), h("p", { text: T.welcomeTitle }), h("p", { class: "muted", text: T.welcomeBody }), b),
    );
  }

  private async start(dir: string): Promise<void> {
    this.dir = dir;
    const files = await api().readAll();
    this.vault = new Vault({ write: (n, c) => api().write(n, c), trash: (n, c) => api().trash(n, c) });
    this.vault.load(files);
    void paperStore.load();
    if (!paperHooked) {
      paperHooked = true;
      api().onPaperProgress((p) => this.paper?.onProgress(p));
      // 紙のページの ID を直したら、キャンバスの「紙」ノードの名前も変わる
      paperStore.on(() => {
        this.canvas?.requestRender();
        this.peek?.requestRender();
      });
    }
    try {
      const st = JSON.parse((await api().readApp(STATE_FILE)) ?? "{}");
      if (st.graphMode !== "local" && st.graphMode !== "groups") delete st.graphMode;
      this.state = { ...this.state, ...st };
    } catch {
      /* 壊れていたら初期値 */
    }
    this.kinds = parseKinds(await api().readApp(KINDS_FILE));
    this.customSets = parseCustomSets(await api().readApp(CUSTOM_FILE));
    setCustomPromptSets(this.customSets);
    this.buildUi();
    if (this.vault.broken.length) toast(T.brokenFiles(this.vault.broken.length), 5000);
    this.vault.onChange((ids) => this.onVaultChange(ids));
    api().onChanged(({ name, content }) => {
      if (this.vault.applyExternal(name, content)) toast(T.externalChange);
    });
    api().onFlush(() => this.flushAll());
    await api().watch();
    const isGroup = (id: string) => this.vault.get(id)?.type === "group";
    const locs = (a: unknown[] | undefined) => (a ?? []).map(toLoc).filter((l): l is Loc => !!l && isGroup(l.g));
    this.tabs = (this.state.tabs ?? []).filter((t) => t && isGroup(t.group)).map((t) => ({ group: t.group, back: locs(t.back), fwd: locs(t.fwd) }));
    if (!this.tabs.length) this.tabs = [{ group: isGroup(this.state.lastGroup) ? this.state.lastGroup : ROOT_ID, back: [], fwd: [] }];
    this.activeTab = Math.min(Math.max(0, this.state.activeTab ?? 0), this.tabs.length - 1);
    this.backStack = [...this.tabs[this.activeTab].back];
    this.fwdStack = [...this.tabs[this.activeTab].fwd];
    const g = this.tabs[this.activeTab].group;
    this.canvas.show(g, this.state.views[g] ?? null);
    if (this.state.surround) this.toggleSurround(true);
    const pg = this.state.peekGroup;
    if (pg && this.vault.get(pg)?.type === "group") this.openPeek(pg);
    this.updateBar();
    this.scheduleFlush(); // 根を作ったとき・迷子を根に入れたときに書く
  }

  private buildUi(): void {
    // 右上のボタンは絵だけ(名前はホバーの説明。2026-11-23 利用者「文字はなるべく無くていい」)
    const btn = (cls: string, title: string, fn: () => void, text = "", icon = "") => {
      const b = h("button", { class: "tbtn " + cls + (icon ? " has-ico" : ""), title, "aria-label": title });
      if (icon) {
        const ico = svg("svg", { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": "true", class: "tb-ico" });
        ico.innerHTML = TOP_ICONS[icon] ?? "";
        b.append(ico);
      } else if (text) b.append(h("span", { class: "tb-text", text }));
      if (icon && text) b.dataset.label = text;
      b.addEventListener("click", fn);
      return b;
    };
    this.btnBack = btn("i-back", T.back + " (Ctrl+[)", () => this.back());
    this.btnFwd = btn("i-fwd", T.forward + " (Ctrl+])", () => this.forward());
    // 右クリックで一覧(2026-11-23 利用者の希望): ← は戻れる先、→ は進める先
    this.btnBack.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.historyMenu(this.btnBack, "back");
    });
    this.btnFwd.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.historyMenu(this.btnFwd, "fwd");
    });
    this.titleEl = h("button", { class: "group-title" });
    // 題を押すと上のグループの一覧(本文はノートだけなので、グループの本文は開かない)
    this.titleEl.addEventListener("click", () => this.ancestorMenu(this.titleEl));
    // 横の鉛筆で名前を変える(2026-11-24 統合仕様 10)。題を押すと上のグループの一覧なのはそのまま
    this.renameBtn = h("button", { class: "tbtn title-edit", title: T.groupRename, "aria-label": T.groupRename });
    this.renameBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/></svg>';
    this.renameBtn.addEventListener("click", () => this.editTitle());
    this.titleBox = h("div", { class: "tb-center" }, this.titleEl, this.renameBtn);
    // 上のグループへ(← → の右隣。2026-11-23 利用者の希望)。所属先が 1 つならすぐ上がり、複数なら選ぶ
    this.upBtn = h("button", { class: "tbtn group-up", title: T.upMenu + " (Ctrl+↑)", "aria-label": T.upMenu, text: "↑" });
    this.upBtn.addEventListener("click", () => this.goUp());
    this.upBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.ancestorMenu();
    });
    const search = h("button", { class: "searchbox", text: T.searchPlaceholder });
    search.addEventListener("click", () => this.search());
    this.btnDraw = btn("draw", T.drawMenu, () => this.openDraw(), T.draw, "draw");
    this.btnPen = btn("i-pen", T.penOn, () => this.togglePen(), T.pen, "pen");
    // ボードに添付(ファイル・チェックリスト・表をノードとして置く)。いま使っている画面に入る
    const attachBtn = btn("attach-btn", T.attachBtnTip, () => (this.peek && this.main.dataset.active === "right" ? this.peek : this.canvas).openAttachMenu(attachBtn), T.attachBtn, "attach");
    const bar = h(
      "header",
      { class: "topbar" },
      h("div", { class: "tb-left" }, this.btnBack, this.btnFwd, this.upBtn, btn("i-home", T.goHome + " (Ctrl+Home)", () => this.openGroup(ROOT_ID))),
      this.titleBox,
      h(
        "div",
        { class: "tb-right" },
        search,
        btn("records-btn", T.recordsTip, () => this.toggleRecords(), T.recordsBtn, "records"),
        btn("paper-btn", PT.btnTip, () => this.togglePaper(), PT.title, "paper"),
        attachBtn,
        this.btnPen,
        btn("surround-btn", T.surroundTip, () => this.toggleSurround(), T.surroundBtn, "surround"),
        btn("whole-btn", T.wholeTip, () => this.toggleWhole(), T.wholeBtn, "whole"),
        btn("export", T.exportTip, (() => this.openExport()) as () => void, T.exportBtn, "export"),
        h("div", { class: "split" }, this.btnDraw),
        btn("i-theme", T.theme, () => this.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")),
        btn("i-settings", T.settings + " (Ctrl+/)", () => this.settings()),
      ),
    );
    this.updateDrawTitle();
    this.main = h("main", { class: "main" });
    this.penBar = h("div", { class: "penbar" });
    // 左の画面(分けていないときは、これ 1 枚)。分けたときだけ見出しを出す
    this.leftTitle = h("button", { class: "pane-title", title: T.panePick });
    this.leftTitle.addEventListener("click", async () => {
      const r = await openPicker(this.vault, { title: T.panePick, mode: "group" });
      if (r && "id" in r) this.openGroup(r.id);
    });
    const leftUp = h("button", { class: "tbtn pane-up", title: T.upMenu, "aria-label": T.upMenu, text: "↑" });
    leftUp.addEventListener("click", () => this.goUp());
    this.leftPane = h("div", { class: "pane left-pane" }, h("div", { class: "pane-head" }, leftUp, this.leftTitle));
    this.main.append(this.leftPane);
    // タブ(2026-11-24)。1 枚だけのときは出さない
    this.tabBar = h("nav", { class: "tabbar hidden", "aria-label": T.tabsLabel });
    document.body.replaceChildren(bar, this.tabBar, this.main);
    this.canvas = new Canvas(
      {
        vault: this.vault,
        kindColor: (k: string) => this.config.edgeColors?.[k] ?? 0,
        openGroup: (id) => this.openGroup(id),
        openBody: (id) => this.openBody(id),
        editInline: (id, mount, done) => this.editInline(id, mount, done),
        goToNode: (id) => this.goToNode(id, false, true),
        pickGroup: async (title) => {
          const r = await openPicker(this.vault, { title, mode: "group" });
          return r && "id" in r ? r.id : null;
        },
        cardHover: (id, e) => cardTip(this.vault, id, e),
        onViewChange: (g, v) => {
          this.state.views[g] = v;
          this.saveState();
        },
        onSelectionChange: (ids) => this.onSelection(ids),
        dropOutside: (ids, cx, cy, link) => (this.peek ? this.dropInto(this.canvas, this.peek, ids, cx, cy, link) : false),
        dragOutside: (ids, cx, cy) => this.dragOver(this.peek, cx, cy, ids),
        quoteToOther: (ids) => this.peek && this.quoteAcross(this.canvas, this.peek, ids),
        hasOther: () => !!this.peek,
        openBeside: (id) => this.openInTab(id),
        openTabBehind: (id) => this.openInTab(id, false),
        jump: (target, from) => this.jump(target, from),
        tagCandidates: () => this.tagCandidates(),
        openLineSettings: () => this.lineSettings(),
        extraEmptyMenu: (g, x, y) => this.dayMenu(g, x, y),
        groupTree: (id, el) => showGroupTree(this.vault, id, el, (g) => this.openGroup(g)),
        openFile: (rel) => void api().openAsset(rel),
        openPaper: (pid) => this.togglePaper(pid),
        onScopeChange: (n) => this.saveScope(n),
      },
      this.leftPane,
    );
    this.canvas.el.addEventListener("focusin", () => this.setActivePane("left"));
    this.canvas.el.addEventListener("pointerdown", () => this.setActivePane("left"));
    this.main.append(this.penBar);
    this.side = new SidePanel(
      {
        vault: this.vault,
        currentGroup: () => this.canvas.group,
        selectedNode: () => (this.canvas.selection.size === 1 ? [...this.canvas.selection][0] : null),
        selection: () => [...this.canvas.selection],
        openGroup: (id) => this.openGroup(id),
        goToNode: (id) => this.goToNode(id, false),
        onModeChange: (m) => {
          this.state.graphMode = m;
          this.saveState();
        },
        addConnected: (from, text, edit) => this.canvas.addConnected(from, text, edit),
        select: (id) => this.canvas.setSelection([id]),
        openBody: (id) => this.openBody(id),
        openNode: (id) => this.canvas.open(id),
        bundleSelection: () => this.canvas.bundleSelection(),
        onTabChange: (t) => {
          this.state.sideTab = t;
          this.saveState();
        },
      },
      this.main,
    );
    this.side.graph.mode = this.state.graphMode;
    // 右の欄はカード(タロット・易・発想カード)の詳細だけ(2026-11-23 利用者「地図やグラフは要らない」)
    this.state.graphOpen = false;
    this.state.sideTab = "detail";
    this.side.setTab("detail", false);
    this.applySide();
    this.canvas.setPen({ ...this.config.pen, on: false });
    this.renderPenBar();
    this.bindKeys();
  }

  // ---------- 選択と右の欄 ----------
  private onSelection(ids: string[]): void {
    // カードを 1 つ選んだときだけ、右の欄の「詳細」を自動で開く(文字では開かない)。
    // 自動で開いた分は、選択を外すか別の種類を選ぶと閉じる(手で開いたものは閉じない・保存もしない)
    const one0 = ids.length === 1 ? this.vault.get(ids[0]) : undefined;
    // ボードの中の引用は、元の物として扱う(タロットなら右の欄が出る)
    const one = one0?.type === "alias" && one0.target ? this.vault.get(one0.target) : one0;
    // 発想カードは問いを札の下に出すので、右の欄は開かない(2026-11-24)
    const t = one?.card?.deck === "prompt" ? "text" : one?.type;
    if (t === "card") {
      if (!this.sideVisible()) {
        this.sideAuto = true;
        this.sidePrevTab = this.side.tab;
        this.applySide();
      }
      // 手で開いている欄でも、カードを選んだら「詳細」へ(保存はしない)
      if (this.side.tab !== "detail") {
        this.sidePrevTab ??= this.side.tab;
        this.side.setTab("detail", false);
      }
    } else if (this.sideAuto && t !== "text") {
      // 空きをクリックして選択が外れたとき、複数選択、グループ・ノートを選んだときに閉じる。
      // 文字は閉じない(欄の語を押して置いた文字や、読みながら書き直す文字で、欄が消えないように)
      this.sideAuto = false;
      this.restoreSideTab();
      this.applySide();
    }
    this.renderSideSoon();
  }
  private renderSideSoon(): void {
    if (!this.sideVisible()) return;
    clearTimeout(this.sideTimer);
    this.sideTimer = setTimeout(() => this.side.render(), 60);
  }

  // ---------- 保存 ----------
  private onVaultChange(ids: Set<string>): void {
    this.canvas.requestRender();
    this.records?.render();
    this.wholeSoon();
    if (this.peek) {
      if (this.vault.exists(this.peek.group)) {
        this.peek.requestRender();
        this.updatePeekTitle();
      } else this.closePeek();
    }
    this.scheduleFlush();
    this.renderSideSoon();
    if (!this.vault.exists(this.canvas.group)) {
      // 開いていたグループが消えた
      this.backStack = this.backStack.filter((l) => this.vault.exists(l.g));
      this.canvas.show(ROOT_ID, this.state.views[ROOT_ID] ?? null);
    }
    if (ids.has(this.canvas.group)) this.updateBar();
  }
  private scheduleFlush(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.vault.flush().catch((e) => toast(T.saveFailed(String(e?.message ?? e)), 6000));
    }, 300);
  }
  async flushAll(): Promise<void> {
    this.popup?.save();
    this.canvas.commitDraft("esc");
    clearTimeout(this.flushTimer);
    await this.vault.flush();
    clearTimeout(this.stateTimer);
    await api().writeApp(STATE_FILE, JSON.stringify(this.state));
  }
  private saveState(): void {
    clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => api().writeApp(STATE_FILE, JSON.stringify(this.state)), 800);
  }

  // ---------- 移動 ----------
  private updateBar(): void {
    const g = this.vault.get(this.canvas.group);
    this.titleEl.textContent = this.canvas.group === ROOT_ID ? T.home : g?.title || T.untitledGroup;
    this.btnBack.disabled = !this.backStack.length;
    this.btnFwd.disabled = !this.fwdStack.length;
    document.title = `${this.titleEl.textContent} — ${T.appName}`;
    this.upBtn.disabled = this.canvas.group === ROOT_ID;
    this.renameBtn.hidden = this.canvas.group === ROOT_ID; // ホームの名前は変えない(今までどおり)
    this.leftTitle.textContent = this.titleEl.textContent + " ▾";
    this.syncTab();
    this.renderSideSoon();
  }

  /** 上のグループ名をその場で直す。Enter で決める・Esc でやめる。日付グループは日付をそのまま、題だけ */
  private editTitle(): void {
    const g = this.canvas.group;
    const n = this.vault.get(g);
    if (!n || g === ROOT_ID || this.titleBox.querySelector("input")) return;
    const day = isDayGroup(this.vault, g);
    const input = h("input", { class: "title-input", type: "text", spellcheck: "false", placeholder: day ? T.recordsTitlePh : T.untitledGroup }) as HTMLInputElement;
    input.value = day ? day.title : n.title;
    const ok = h("button", { class: "tbtn title-ok", title: "OK (Enter)", "aria-label": "OK", text: "✓" });
    const wrap = h("div", { class: "title-edit-row" }, day ? h("span", { class: "title-date", text: day.date + "-" }) : null, input, ok);
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (save && this.vault.exists(g)) {
        const t = day ? dayGroupTitle(day.date, input.value) : input.value.replace(/\s*\n\s*/g, " ").trim();
        if (t !== n.title) this.vault.update(g, { title: t });
      }
      this.titleBox.replaceChildren(this.titleEl, this.renameBtn);
      this.updateBar();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => setTimeout(() => finish(true), 0));
    ok.addEventListener("mousedown", (e) => e.preventDefault());
    ok.addEventListener("click", () => finish(true));
    this.titleBox.replaceChildren(wrap);
    input.focus();
    input.select();
  }

  // ---------- タブ(2026-11-24 利用者) ----------
  /** 今のタブに、今のグループと戻る・進むを書き戻し、タブの列を描き直す */
  private syncTab(): void {
    if (!this.tabs.length) return;
    this.tabs[this.activeTab] = { group: this.canvas.group, back: [...this.backStack], fwd: [...this.fwdStack] };
    this.state.tabs = this.tabs;
    this.state.activeTab = this.activeTab;
    this.saveState();
    this.renderTabs();
  }
  private loadTab(i: number): void {
    this.activeTab = i;
    const t = this.tabs[i];
    this.backStack = [...t.back];
    this.fwdStack = [...t.fwd];
    this.closePopup();
    if (this.records) this.closeRecords();
    this.showGroup(this.vault.get(t.group)?.type === "group" ? t.group : ROOT_ID, "in");
  }
  switchTab(i: number): void {
    if (i === this.activeTab || i < 0 || i >= this.tabs.length) return;
    this.syncTab();
    this.loadTab(i);
  }
  /** 新しいタブでグループを開く。activate = false なら後ろで開く(中ボタン) */
  newTab(group: string = this.canvas.group, activate = true, focusNode?: string): void {
    if (this.vault.get(group)?.type !== "group") return;
    this.syncTab();
    this.tabs.splice(this.activeTab + 1, 0, { group, back: [], fwd: [] });
    if (activate) {
      this.loadTab(this.activeTab + 1);
      if (focusNode) {
        this.canvas.centerOn(focusNode);
        this.canvas.setSelection([focusNode]);
      }
    } else {
      this.syncTab();
      toast(T.tabOpenedBehind(this.groupName(group)));
    }
  }
  closeTab(i: number = this.activeTab): void {
    if (this.tabs.length <= 1) return;
    this.syncTab();
    this.tabs.splice(i, 1);
    if (i === this.activeTab) this.loadTab(Math.min(i, this.tabs.length - 1));
    else {
      if (i < this.activeTab) this.activeTab--;
      this.syncTab();
    }
  }
  /** このタブ以外を全部閉じる / このタブより右を閉じる */
  closeTabs(keep: number, which: "others" | "right"): void {
    this.syncTab();
    const cur = this.tabs[this.activeTab];
    this.tabs = which === "others" ? [this.tabs[keep]] : this.tabs.slice(0, keep + 1);
    const at = this.tabs.indexOf(cur);
    if (at >= 0) {
      this.activeTab = at;
      this.syncTab();
    } else this.loadTab(which === "others" ? 0 : keep);
  }
  private renderTabs(): void {
    if (!this.tabBar) return;
    this.tabBar.classList.toggle("hidden", this.tabs.length < 2);
    if (this.tabs.length < 2) return void this.tabBar.replaceChildren();
    const els = this.tabs.map((t, i) => {
      const x = h("button", { class: "tab-x", title: T.tabClose + " (Ctrl+W)", "aria-label": T.tabClose, text: "×" });
      const el = h("div", { class: "tab" + (i === this.activeTab ? " active" : ""), role: "tab", "aria-selected": String(i === this.activeTab), title: this.groupName(t.group) }, h("span", { class: "tab-t", text: this.groupName(t.group) }), x);
      el.addEventListener("mousedown", (e) => {
        if (e.button === 1) e.preventDefault(); // 中ボタンのスクロールを出さない
      });
      el.addEventListener("click", (e) => {
        if (e.target === x) return this.closeTab(i);
        this.switchTab(i);
      });
      el.addEventListener("auxclick", (e) => e.button === 1 && this.closeTab(i));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: T.tabClose, hint: "Ctrl+W", action: () => this.closeTab(i) },
          { label: T.tabCloseOthers, action: () => this.closeTabs(i, "others") },
          { label: T.tabCloseRight, disabled: i === this.tabs.length - 1, action: () => this.closeTabs(i, "right") },
          { separator: true, label: "" },
          { label: T.tabDuplicate, hint: "Ctrl+T", action: () => this.newTab(t.group) },
        ]);
      });
      return el;
    });
    const plus = h("button", { class: "tab-new", title: T.tabNew + " (Ctrl+T)", "aria-label": T.tabNew, text: "＋" });
    plus.addEventListener("click", () => this.newTab());
    this.tabBar.replaceChildren(...els, plus);
  }
  /** 題の横の▾: 所属先とホームへ移る */
  goUp(): void {
    const g = this.canvas.group;
    if (g === ROOT_ID) return;
    const parents = this.vault.parentsOf(g).filter((p) => this.vault.get(p)?.type === "group" || p === ROOT_ID);
    if (parents.length === 1) return this.openGroup(parents[0]);
    this.openUpMenu();
  }

  // ---------- 日記(Ctrl+D): ホーム › 記録 › 2026 › 2026-11 › 2026-11-23 のグループと、その中の「日記」ノート ----------
  /** 今日の日のグループ(なければ作る)。前の版でホームに直接作った年のグループは「記録」の中へ移す */
  private today(): string {
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  }
  todayGroup(): string {
    return this.dayGroupFor(this.today());
  }
  /** その日の日付グループ(なければ ホーム › 記録 › 年 › 月 の下に作る) */
  dayGroupFor(ymd: string): string {
    const y = ymd.slice(0, 4), ym = ymd.slice(0, 7);
    let day = "";
    this.vault.tx(() => {
      const rec = this.childGroup(ROOT_ID, T.recordsGroup);
      for (const it of this.vault.itemsOf(ROOT_ID)) {
        const n = this.vault.get(it.id);
        if (!it.ref && n?.type === "group" && /^\d{4}$/.test(n.title) && !this.vault.itemPos(rec, it.id)) {
          const others = this.vault.itemsOf(rec).filter((i) => !i.ref);
          this.vault.moveToGroup(ROOT_ID, rec, it.id, 0, others.length ? Math.max(...others.map((i) => i.y)) + 80 : 0);
        }
      }
      const year = this.childGroup(rec, y);
      const month = this.childGroup(year, ym);
      // 題の付いた日付グループ(2026-11-24-○○)もその日のグループとして使い、日付だけのものを重ねて作らない(統合仕様 11)
      day = findDayGroup(this.vault, ymd) ?? this.childGroup(month, ymd);
    });
    return day;
  }
  // ---------- 紙PKM(Ctrl+P) ----------
  togglePaper(start?: string): void {
    if (this.paperOpen && !start) return this.closePaper();
    if (this.records) this.closeRecords();
    this.closePopup();
    this.canvas.commitDraft("esc");
    if (this.paper) {
      if (start) this.paper.show(start);
      this.main.append(this.paper.el);
      this.paperOpen = true;
      this.paper.el.focus();
      return;
    }
    this.paper = new PaperView(
      {
        close: () => this.closePaper(),
        place: (pid) => this.placePaper(pid),
        usedIn: (pid) =>
          [...this.vault.nodes.values()]
            .filter((n) => n.paper === pid)
            .flatMap((n) => this.vault.parentsOf(n.id).map((g) => ({ id: n.id, group: g, groupTitle: g === ROOT_ID ? T.home : this.vault.get(g)?.title || T.untitledGroup }))),
        goTo: (g, id) => {
          this.closePaper();
          this.openGroup(g);
          this.canvas.renderNow();
          this.canvas.centerOn(id);
          this.canvas.setSelection([id]);
        },
      },
      start,
    );
    this.main.append(this.paper.el);
    this.paperOpen = true;
    this.paper.el.focus();
  }
  closePaper(): void {
    if (!this.paper || !this.paperOpen) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    this.paper.el.remove();
    this.paperOpen = false;
    this.canvas.el.focus({ preventScroll: true });
  }
  /** 紙のページを、いま使っている画面のグループの真ん中に置く(文字のノードが内部IDで指す) */
  private placePaper(pid: string): void {
    const c = this.peek && this.main.dataset.active === "right" ? this.peek : this.canvas;
    const fz = paperStore.fzOf(pid);
    const p = c.visibleCenter();
    const n = this.vault.create({ type: "text", title: PT.nodeLabel(fz ?? "?"), group: c.group, x: Math.round(p.x), y: Math.round(p.y), paper: pid });
    this.closePaper();
    c.renderNow();
    c.setSelection([n.id]);
    toast(PT.placed(fz ?? "?"));
  }
  // ---------- 記録一覧(Ctrl+J) ----------
  toggleRecords(): void {
    if (this.records) return this.closeRecords();
    this.closePopup();
    this.canvas.commitDraft("esc");
    const app = this;
    this.records = new RecordsView({
      vault: this.vault,
      get kinds() {
        return app.kinds;
      },
      marker: this.state.recordMarker ?? null,
      onMarker: (m) => {
        this.state.recordMarker = m;
        this.records!["host"].marker = m;
        this.saveState();
      },
      open: (e) => this.openRecord(e),
      newNote: (date, kind) => this.writeRecord(kind, date),
      renameDay: (date, title) => {
        const g = this.dayGroupFor(date);
        this.vault.update(g, { title: dayGroupTitle(date, title) });
        this.records?.render();
      },
      dayGroup: (date) => this.dayGroupFor(date),
      setMarkers: (date, markers) => this.vault.setMarkers(this.dayGroupFor(date), markers),
      preview: (el, g) => this.showPreview(el, g),
      saveKinds: (ks) => this.saveKinds(ks),
      close: () => this.closeRecords(),
    });
    this.main.append(this.records.el);
    this.records.el.focus();
  }
  closeRecords(): void {
    this.records?.el.remove();
    this.records = null;
    this.previewCanvas?.el.remove();
    this.canvas.el.focus({ preventScroll: true });
  }
  /** Ctrl+J の、その日のボードの縮小(見るだけ。押した物の所へ開く)。キャンバスの部品をそのまま使う(データは写さない) */
  private previewCanvas: Canvas | null = null;
  private showPreview(el: HTMLElement, g: string | null): void {
    if (!g) {
      this.previewCanvas?.el.remove();
      return;
    }
    if (!this.previewCanvas) {
      const open = (grp: string, node?: string) => {
        this.closeRecords();
        this.openGroup(grp, node);
      };
      const pc: Canvas = new Canvas(
        {
          vault: this.vault,
          kindColor: (k: string) => this.config.edgeColors?.[k] ?? 0,
          openGroup: (id) => open(id),
          openBody: (id) => open(pc.group, id),
          goToNode: (id) => open(pc.group, id),
          pickGroup: async () => null,
          cardHover: () => {},
          onViewChange: () => {},
          onSelectionChange: () => {},
        },
        el,
      );
      pc.readOnly = true;
      pc.el.classList.add("preview-canvas");
      this.previewCanvas = pc;
    }
    const pc = this.previewCanvas;
    el.prepend(pc.el);
    pc.show(g, null);
    requestAnimationFrame(() => pc.fitAll());
  }
  private openRecord(e: RecordEntry): void {
    this.closeRecords();
    if (e.type === "note") {
      this.openGroup(e.day);
      this.canvas.renderNow();
      this.canvas.setSelection([e.id]);
      this.openBody(e.id);
    } else if (e.type === "day" && e.id !== e.day && this.vault.exists(e.id)) {
      // しるしの一覧から: その文字のあるグループを開いて、その文字を見せる
      this.openGroup(e.day);
      this.canvas.renderNow();
      this.canvas.centerOn(e.id);
    } else this.openGroup(e.type === "group" ? e.id : e.day);
  }
  /** 今日のその種類の記録(ノート「2026-11-23-種類」)を開く。なければ作り、上位・下位の記録と線でつなぐ */
  writeRecord(kind: string, date?: string): void {
    if (this.records) this.closeRecords();
    const ymd = date ?? this.today();
    const day = this.dayGroupFor(ymd);
    let note = "";
    this.vault.tx(() => {
      note = this.ensureRecordNote(day, ymd, kind);
    });
    this.openGroup(day);
    this.canvas.renderNow();
    this.canvas.setSelection([note]);
    this.openBody(note);
  }
  /** 日のグループ(2026-11-23・2026-11-23-題)の空きの右クリック: 種類ごとに、その日の記録を新しく作る。新しい種類でも作れる */
  private dayMenu(group: string, x: number, y: number): MenuItem[] {
    const day = isDayGroup(this.vault, group);
    if (!day) return [];
    const date = day.date;
    const make = (kind: string) => () => {
      let note = "";
      this.vault.tx(() => (note = this.ensureRecordNote(group, date, kind, { x, y })));
      this.openBody(note);
    };
    const items: MenuItem[] = [{ label: T.dayMenuHead(date), disabled: true }];
    for (const k of this.kinds) items.push({ label: T.dayMenuNew(k.name), action: make(k.name) });
    items.push({
      label: T.dayMenuNewKind,
      action: async () => {
        const name = cleanKind((await askText(T.dayMenuNewKindAsk)) ?? "");
        if (!name) return;
        if (!this.kinds.some((k) => k.name === name)) this.saveKinds([...this.kinds, { name, parents: [] }]);
        make(name)();
      },
    });
    return items;
  }
  saveKinds(ks: RecordKind[]): void {
    this.kinds = ks;
    void api().writeApp(KINDS_FILE, JSON.stringify({ kinds: ks }, null, 2));
    this.records?.render();
  }

  /** その日の記録ノートを新しく作る(同じ日・同じ種類でも、毎回新しいノート。統合仕様 13) */
  private ensureRecordNote(day: string, ymd: string, kind: string, at?: { x: number; y: number }): string {
    const def = this.kinds.find((k) => k.name === kind);
    const parentNotes = (def?.parents ?? []).map((p) => findRecordNote(this.vault, day, p)).filter((x): x is string => !!x);
    const childNotes = this.kinds.filter((k) => k.parents.includes(kind)).map((k) => findRecordNote(this.vault, day, k.name)).filter((x): x is string => !!x);
    // 置き場所: 上位のノートの右に、なければ下位の左に、どちらもなければ下に足す
    const items = this.vault.itemsOf(day).filter((i) => !i.ref);
    const posOf = (id: string) => this.vault.itemPos(day, id)!;
    let x = 0, y = items.length ? Math.max(...items.map((i) => i.y)) + 120 : 0;
    if (parentNotes.length) {
      const p = posOf(parentNotes[0]);
      const sibs = items.filter((i) => i.x > p.x + 100 && Math.abs(i.y - p.y) < 400).length;
      (x = p.x + 300), (y = p.y + sibs * 110);
    } else if (childNotes.length) {
      const c = posOf(childNotes[0]);
      (x = c.x - 300), (y = c.y);
    }
    if (at && !parentNotes.length) ((x = at.x), (y = at.y));
    // 置いてある物と重ならない所へ
    const taken = items.map((i) => ({ x: i.x, y: i.y, w: 200, h: 60 }));
    for (let k = 0; k < 50 && taken.some((r) => Math.abs(r.x - x) < 200 && Math.abs(r.y - y) < 60); k++) y += 70;
    const id = this.vault.create({ type: "note", title: `${ymd}-${kind}`, group: day, x, y }).id;
    // 上位のノート 1 枚からだけ線を引く(全部へ自動ではつながない)
    if (parentNotes[0]) this.vault.addLink(parentNotes[0], id);
    if (childNotes.length && !parentNotes.length && !findRecordNote(this.vault, day, kind, id)) for (const c of childNotes) this.vault.addLink(id, c);
    return id;
  }

  /** Ctrl+D: 今日のグループ(ホーム › 記録 › 年 › 月 › 日)を開く。日記のノートは開かない(2026-11-23 利用者) */
  openToday(): void {
    if (this.records) this.closeRecords();
    this.openGroup(this.todayGroup());
  }
  /** parent の中の、名前が title のグループ(なければ作る。並びは日付順になるよう、下へ足す) */
  private childGroup(parent: string, title: string): string {
    const items = this.vault.itemsOf(parent).filter((i) => !i.ref);
    const hit = items.find((i) => this.vault.get(i.id)?.type === "group" && this.vault.get(i.id)?.title === title);
    if (hit) return hit.id;
    const x = items.length ? Math.min(...items.map((i) => i.x)) : 0;
    const y = items.length ? Math.max(...items.map((i) => i.y)) + 80 : 0;
    return this.vault.create({ type: "group", title, group: parent, x, y }).id;
  }

  private openUpMenu(): void {
    const g = this.canvas.group;
    const name = (id: string) => (id === ROOT_ID ? T.home : this.vault.get(id)?.title || T.untitledGroup);
    const parents = this.vault.parentsOf(g).filter((p) => this.vault.get(p)?.type === "group" || p === ROOT_ID);
    const items: MenuItem[] = parents.map((p) => ({ label: name(p), action: () => this.openGroup(p) }));
    if (!parents.includes(ROOT_ID)) items.push({ separator: true } as MenuItem, { label: T.home, action: () => this.openGroup(ROOT_ID) });
    const r = this.upBtn.getBoundingClientRect();
    showMenu(r.left, r.bottom + 2, items);
  }
  openGroup(id: string, focusNode?: string): void {
    if (this.vault.get(id)?.type !== "group") return;
    this.closePopup();
    if (id !== this.canvas.group) {
      pushHist(this.backStack, this.here());
      this.fwdStack = [];
      this.showGroup(id, "in");
    }
    if (focusNode) this.canvas.centerOn(focusNode);
  }
  /** 今いる場所(グループ・見ている場所・選んでいる物) */
  private here(): Loc {
    return { g: this.canvas.group, v: this.canvas.getView(), sel: [...this.canvas.selection] };
  }
  /** 履歴の場所へ(グループ・見ていた場所・選んでいた物を戻す) */
  private restoreLoc(loc: Loc, anim: "in" | "out"): void {
    const g = this.vault.exists(loc.g) ? loc.g : ROOT_ID;
    if (g !== this.canvas.group) this.showGroup(g, anim);
    if (loc.v) this.canvas.setView(loc.v);
    const sel = (loc.sel ?? []).filter((i) => this.canvas.rectOf(i));
    if (sel.length) this.canvas.setSelection(sel);
    this.updateBar();
  }

  /** 線の設定: 種類ごとに、見本の線と色の見本を並べ、1 つずつ決める(2026-11-24 利用者) */
  lineSettings(): void {
    const rows = h("div", { class: "ls-rows" });
    const fill = () => {
      rows.replaceChildren(
        ...NEW_LINK_KINDS.map((k) => {
          const cur = this.config.edgeColors?.[k] ?? 0;
          const pv = svg("svg", { class: "ls-preview" + (cur ? " c" + cur : ""), viewBox: "0 0 64 14", width: 96, height: 21, "aria-hidden": "true" });
          pv.innerHTML = kindPreview(k);
          const sws = h("div", { class: "ls-sws" });
          for (let c = 0; c <= PRESET_COLORS; c++) {
            const b = h("button", { class: `sw c${c}${c === cur ? " active" : ""}`, title: c ? `${T.color} ${c}` : T.colorNoDefault, "aria-label": `${T.kinds[k]}: ${c ? T.color + " " + c : T.colorNoDefault}` });
            b.addEventListener("click", () => {
              this.setKindColor(k, c);
              fill();
            });
            sws.append(b);
          }
          return h("div", { class: "ls-row", "data-kind": k }, pv, h("span", { class: "ls-name", text: T.kinds[k] }), sws);
        }),
      );
    };
    fill();
    const ok = h("button", { class: "btn primary", text: "OK" });
    const box = h("div", { class: "modal line-settings" }, h("div", { class: "modal-title", text: T.lineSettingsTitle }), h("p", { class: "muted small", text: T.lineSettingsHelp }), rows, h("div", { class: "row-end" }, ok));
    const back = h("div", { class: "backdrop" }, box);
    const close = () => {
      back.remove();
      removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.stopPropagation();
        close();
      }
    };
    ok.addEventListener("click", close);
    back.addEventListener("mousedown", (e) => e.target === back && close());
    addEventListener("keydown", onKey, true);
    document.body.append(back);
    ok.focus();
  }

  /** 線の種類のいつもの色を変える(アプリの設定に覚える。開いている画面を描き直す) */
  private setKindColor(kind: string, c: number): void {
    const m = { ...(this.config.edgeColors ?? {}) };
    if (c) m[kind] = c;
    else delete m[kind];
    this.config.edgeColors = m;
    api().setConfig({ edgeColors: m });
    for (const cv of [this.canvas, this.peek, this.whole]) cv?.requestRender();
  }

  /** @ の候補: 使ったしるし(マーカー・文字とノートの @)と、時系列記録の種類。よく使う順 */
  tagCandidates(): string[] {
    return allTags(this.vault, this.kinds.map((k) => k.name)).map((t) => t.tag);
  }

  // ---------- 引用から飛ぶ・戻る(2026-11-24 利用者・統合仕様 1) ----------
  // 飛ぶのも履歴に入れる(同じボードの中でも)。飛んだ直後は左下に「↩ 戻る」(押すと Ctrl+← と同じ)
  private returnBtn: HTMLElement | null = null;
  private jumped = false;
  private jumping = false;
  /** 引用の ↗: 元の場所へ。同じボードにあればそこを見せ、無ければ所属しているグループへ */
  jump(target: string, from: string): void {
    if (!this.vault.exists(target)) return;
    const c = this.canvas;
    const here = this.vault.itemPos(c.group, target);
    this.jumping = true;
    try {
      if (here && from !== target) {
        pushHist(this.backStack, this.here());
        this.fwdStack = [];
        c.centerOn(target);
        this.updateBar();
      } else this.goToNode(target, false, true);
    } finally {
      this.jumping = false;
    }
    this.jumped = true;
    this.renderReturn();
  }
  private renderReturn(): void {
    if (!this.jumped || !this.backStack.length) {
      this.returnBtn?.remove();
      this.returnBtn = null;
      return;
    }
    if (!this.returnBtn) {
      this.returnBtn = h("button", { class: "return-btn", title: T.returnTip, text: T.returnBtn });
      this.returnBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      this.returnBtn.addEventListener("click", () => this.back());
    }
    if (this.returnBtn.parentElement !== this.canvas.el) this.canvas.el.append(this.returnBtn);
  }

  private showGroup(id: string, anim: "in" | "out"): void {
    if (!this.jumping && this.jumped) {
      // ほかの方法で移ったら、戻るボタンは消す
      this.jumped = false;
      this.renderReturn();
    }
    this.canvas.show(id, this.state.views[id] ?? null, anim);
    if (this.whole) {
      // 全体の画面(右)は、左の画面と同じグループを見せる
      this.whole.show(id, null);
      this.whole.fitAll();
    }
    this.state.lastGroup = id;
    this.saveState();
    this.updateBar();
    this.renderSideSoon();
  }
  back(): void {
    const loc = this.backStack.pop();
    if (!loc) return;
    pushHist(this.fwdStack, this.here());
    this.restoreLoc(loc, "out");
    this.jumped = false;
    this.renderReturn();
  }
  /** ← / → の右クリック: 履歴の一覧。近い順。押すとそこまで一度に戻る/進む */
  private historyMenu(anchor: HTMLElement, dir: "back" | "fwd"): void {
    const stack = dir === "back" ? this.backStack : this.fwdStack;
    // ブラウザと同じく、近いものから決まった数だけ(古い分は「ほか N 件」)
    const all = [...stack].reverse();
    const items: MenuItem[] = all.slice(0, HISTORY_MENU).map((loc, i) => ({
      label: this.groupName(loc.g),
      action: () => {
        const from = dir === "back" ? this.backStack : this.fwdStack;
        const to = dir === "back" ? this.fwdStack : this.backStack;
        let cur = this.here(); // 途中は表示せずに通り過ぎる
        for (let k = 0; k <= i && from.length; k++) {
          pushHist(to, cur);
          cur = from.pop()!;
        }
        this.restoreLoc(cur, dir === "back" ? "out" : "in");
      },
    }));
    if (all.length > HISTORY_MENU) items.push({ separator: true } as MenuItem, { label: T.historyMore(all.length - HISTORY_MENU), disabled: true } as MenuItem);
    if (!items.length) items.push({ label: T.historyEmpty, disabled: true } as MenuItem);
    const r = anchor.getBoundingClientRect();
    showMenu(r.left, r.bottom + 2, items);
  }
  /** ↑ の右クリック: 上のグループの一覧(親、その親…ホームまで。近い順。字下げで段を示す) */
  private ancestorMenu(anchor: HTMLElement = this.upBtn): void {
    const items: MenuItem[] = [];
    const seen = new Set<string>([this.canvas.group]);
    let level = [this.canvas.group];
    for (let depth = 0; level.length && depth < 20; depth++) {
      const next: string[] = [];
      for (const g of level)
        for (const p of this.vault.parentsOf(g)) {
          if (seen.has(p) || (p !== ROOT_ID && this.vault.get(p)?.type !== "group")) continue;
          seen.add(p);
          next.push(p);
          items.push({ label: "　".repeat(depth) + this.groupName(p), action: () => this.openGroup(p) });
        }
      level = next;
    }
    if (!items.length) items.push({ label: T.historyEmpty, disabled: true } as MenuItem);
    const r = anchor.getBoundingClientRect();
    showMenu(r.left, r.bottom + 2, items);
  }
  private groupName(id: string): string {
    return id === ROOT_ID ? T.home : this.vault.get(id)?.title || T.untitledGroup;
  }

  forward(): void {
    const loc = this.fwdStack.pop();
    if (!loc) return;
    pushHist(this.backStack, this.here());
    this.restoreLoc(loc, "in");
    this.jumped = false;
    this.renderReturn();
  }
  /** そのノード(が含まれるグループ)へ移る。home = 引用ではなく、所属しているグループへ */
  goToNode(id: string, openBody: boolean, home = false): void {
    if (!this.vault.exists(id)) return;
    let g = this.canvas.group;
    const here = this.vault.itemPos(g, id);
    if (!here || (home && here.ref)) {
      const parents = this.vault.parentsOf(id);
      g = parents.includes(ROOT_ID) ? ROOT_ID : parents.sort()[0] ?? ROOT_ID;
    }
    this.openGroup(g, id);
    if (home) {
      this.canvas.renderNow();
      this.canvas.setSelection([id]); // 引用元へ飛んだときは、そのノードを選んでおく
    }
    if (openBody) this.openBody(id);
  }

  // ---------- ポップアップ ----------
  openBody(id: string): void {
    if (!this.vault.exists(id)) return;
    // ノートは最初から大画面で開く(2026-11-22 利用者の希望)。ほかは小さいポップアップ
    const expanded = this.vault.get(id)!.type === "note";
    this.closePopup();
    this.canvas.commitDraft("esc");
    this.popup = new BodyPopup(
      {
        vault: this.vault,
        goToGroup: (g, focus) => this.openGroup(g, focus),
        goToNode: (n, ob) => this.goToNode(n, ob),
        closedEditor: () => {
          this.popup = null;
          this.canvas.el.focus();
        },
        openSearch: () => this.search(),
      },
      id,
      this.main,
      expanded,
    );
  }
  /** キャンバスの上でそのまま書く編集欄(チェックリスト・表) */
  private editInline(id: string, mount: HTMLElement, done: () => void): () => void {
    this.closePopup();
    const ed = new BodyPopup(
      { vault: this.vault, goToGroup: (g, focus) => this.openGroup(g, focus), goToNode: (n, ob) => this.goToNode(n, ob), closedEditor: done, openSearch: () => this.search() },
      id,
      mount,
      false,
      true,
    );
    return () => ed.close();
  }
  private closePopup(): void {
    this.popup?.close();
    this.popup = null;
  }

  // ---------- 検索・引く・右の欄・設定 ----------
  async search(): Promise<void> {
    const r = await openPicker(this.vault, { title: T.searchTitle, mode: "search" });
    if (!r || !("id" in r)) return;
    const n = this.vault.get(r.id);
    if (r.newTab) {
      // Ctrl+Enter・Ctrl+クリック: 新しいタブで開く(グループはその中、ほかはそれのあるグループ)
      if (n?.type === "group") return this.newTab(r.id);
      const ps = this.vault.parentsOf(r.id);
      return this.newTab(ps.includes(ROOT_ID) ? ROOT_ID : ps.sort()[0] ?? ROOT_ID, true, r.id);
    }
    if (n?.type === "group") this.openGroup(r.id);
    else this.goToNode(r.id, false);
  }

  private updateDrawTitle(): void {
    this.btnDraw.title = T.drawMenu;
  }
  private saveDraw(): void {
    this.config.draw = this.draw;
    api().setConfig({ draw: this.draw });
    this.updateDrawTitle();
  }
  openDraw(tab?: "tarot" | "iching" | "prompt" | "settings"): void {
    if (drawMenuOpen()) {
      closeDrawMenu();
      return;
    }
    const lastTab = this.draw.last.k === "iching" ? "iching" : this.draw.last.k.startsWith("prompt") ? "prompt" : "tarot";
    openDrawMenu(this.btnDraw.parentElement!, this.draw, tab ?? lastTab, this.canvas.selection.size === 1, (k, q) => this.doDraw(k, q), () => this.saveDraw(), {
      sets: () => this.customSets,
      save: (sets) => {
        this.customSets = sets;
        setCustomPromptSets(sets);
        void api().writeApp(CUSTOM_FILE, JSON.stringify({ sets }, null, 2));
        this.canvas.renderNow();
      },
    });
  }
  drawAgain(): void {
    this.doDraw(this.draw.last, "");
  }
  private doDraw(k: DrawKind, question: string): void {
    if (!(k.k === "tarot" && k.blank)) {
      this.draw.last = k;
      this.saveDraw();
    }
    const anchor = this.canvas.selection.size === 1 ? [...this.canvas.selection][0] : null;
    const ids = runDraw(
      { vault: this.vault, group: this.canvas.group, center: this.canvas.visibleCenter(), anchor, spotNear: (id) => this.canvas.spot(id), obstacles: this.canvas.obstacles() },
      this.draw,
      k,
      question,
    );
    this.canvas.renderNow();
    this.canvas.setSelection(ids.length === 1 ? ids : []);
    this.canvas.ensureVisible(ids);
  }

  private restoreSideTab(): void {
    if (this.sidePrevTab && this.side.tab === "detail") this.side.setTab(this.sidePrevTab, false);
    this.sidePrevTab = null;
  }
  /** 右の欄が見えているか(手で開いた分 + カードを選んで自動で開いた分) */
  private sideVisible(): boolean {
    return this.state.graphOpen || this.sideAuto;
  }
  private applySide(): void {
    this.main.classList.toggle("side-open", this.sideVisible());
    if (this.sideVisible()) requestAnimationFrame(() => this.side.render());
  }
  /** 手での開閉。自動で開いているときに押すと閉じる */
  toggleSide(open?: boolean): void {
    this.state.graphOpen = open ?? !this.sideVisible();
    this.sideAuto = false;
    this.sidePrevTab = null;
    this.applySide();
    this.saveState();
  }

  // ---------- 横の画面 ----------
  private openPeek(group: string, focus?: string): void {
    if (this.whole) this.closeWhole();
    if (!this.peek) {
      this.peekTitle = h("button", { class: "pane-title peek-title", title: T.panePick });
      this.peekTitle.addEventListener("click", () => this.pickBeside());
      const up = h("button", { class: "tbtn pane-up", title: T.upMenu, "aria-label": T.upMenu, text: "↑" });
      up.addEventListener("click", () => this.peekUp(up));
      const close = h("button", { class: "tbtn peek-close", title: T.besideClose, "aria-label": T.besideClose, text: "×" });
      close.addEventListener("click", () => this.closePeek());
      const head = h("div", { class: "pane-head", title: T.besideHint }, up, this.peekTitle, h("span", { class: "pane-space" }), close);
      this.peekWrap = h("div", { class: "pane peek" }, head);
      this.splitBar = h("div", { class: "split-bar", title: T.splitBarTip });
      this.splitBar.addEventListener("pointerdown", (e) => this.dragSplit(e));
      this.splitBar.addEventListener("dblclick", () => this.setSplit(0.5));
      this.leftPane.after(this.splitBar, this.peekWrap);
      this.main.classList.add("split");
      this.setSplit(this.state.splitRatio ?? 0.5);
      this.peek = new Canvas(
        {
          vault: this.vault,
          kindColor: (k: string) => this.config.edgeColors?.[k] ?? 0,
          openGroup: (id) => this.openPeek(id),
          openBody: (id) => this.openBody(id),
          editInline: (id, mount, done) => this.editInline(id, mount, done),
          goToNode: (id) => this.openBeside(id),
          pickGroup: async (title) => {
            const r = await openPicker(this.vault, { title, mode: "group" });
            return r && "id" in r ? r.id : null;
          },
          cardHover: (id, e) => cardTip(this.vault, id, e),
          onViewChange: (g, v) => {
            this.state.views[g] = v;
            this.saveState();
          },
          onSelectionChange: () => {},
          dropOutside: (ids, cx, cy, link) => this.dropInto(this.peek!, this.canvas, ids, cx, cy, link),
          dragOutside: (ids, cx, cy) => this.dragOver(this.canvas, cx, cy, ids),
          quoteToOther: (ids) => this.quoteAcross(this.peek!, this.canvas, ids),
          hasOther: () => true,
          openBeside: (id) => this.openInTab(id),
          extraEmptyMenu: (g, x, y) => this.dayMenu(g, x, y),
          groupTree: (id, el) => showGroupTree(this.vault, id, el, (g) => this.openPeek(g)),
          openFile: (rel) => void api().openAsset(rel),
          openPaper: (pid) => this.togglePaper(pid),
        },
        this.peekWrap,
      );
      this.peek.el.classList.add("peek-canvas");
      this.peek.el.addEventListener("focusin", () => this.setActivePane("right"));
      this.peek.el.addEventListener("pointerdown", () => this.setActivePane("right"));
    }
    if (this.peek.group !== group || !this.peek.el.isConnected) this.peek.show(group, this.state.views[group] ?? null);
    else this.peek.requestRender();
    if (focus) {
      this.peek.renderNow();
      this.peek.centerOn(focus);
      this.peek.setSelection([focus]);
    }
    this.state.peekGroup = group;
    this.saveState();
    this.updatePeekTitle();
  }
  private updatePeekTitle(): void {
    if (!this.peek || !this.peekTitle) return;
    const g = this.vault.get(this.peek.group);
    this.peekTitle.textContent = (this.peek.group === ROOT_ID ? T.home : g?.title || T.untitledGroup) + " ▾";
    this.peekWrap?.querySelector<HTMLButtonElement>(".pane-up")?.toggleAttribute("disabled", this.peek.group === ROOT_ID);
  }
  closePeek(): void {
    this.peek?.commitDraft("esc");
    this.peekWrap?.remove();
    this.splitBar?.remove();
    this.splitBar = null;
    this.main.classList.remove("split");
    this.leftPane.style.flex = "";
    this.setActivePane("left");
    this.peek = null;
    this.peekWrap = null;
    this.peekTitle = null;
    this.state.peekGroup = null;
    this.saveState();
    this.canvas.el.focus({ preventScroll: true });
  }
  /** 「まわり」: この画面のまま、つながりを外へ広げて見る(外の物は見るだけ。ドラッグで引用) */
  private savedScope(): number {
    const s = this.state.islandScope;
    return s === null ? Infinity : typeof s === "number" ? s : 1;
  }
  private saveScope(n: number): void {
    this.state.islandScope = isFinite(n) ? n : null;
    this.saveState();
  }
  toggleSurround(on = !this.canvas.surround): void {
    this.canvas.scope = this.savedScope();
    this.canvas.setSurround(on);
    document.querySelector(".tbtn.surround-btn")?.classList.toggle("on", on);
    this.state.surround = on;
    this.saveState();
    if (on) this.canvas.fitAll();
  }

  // ---------- 全体の画面(見るだけ) ----------
  toggleWhole(): void {
    if (this.whole) this.closeWhole();
    else this.openWhole();
  }
  private openWhole(): void {
    if (this.peek) this.closePeek();
    const full = h("button", { class: "tbtn whole-full-btn", title: T.wholeFullTip, "aria-label": T.wholeFullTip, text: "⛶" });
    full.addEventListener("click", () => this.main.classList.toggle("whole-full"));
    const fit = h("button", { class: "tbtn", title: T.fitAll, "aria-label": T.fitAll, text: "◎" });
    fit.addEventListener("click", () => this.whole?.fitAll());
    const close = h("button", { class: "tbtn whole-close", title: T.wholeClose, "aria-label": T.wholeClose, text: "×" });
    close.addEventListener("click", () => this.closeWhole());
    const head = h("div", { class: "pane-head" }, h("span", { class: "pane-title whole-title", text: T.wholeTitle }), h("span", { class: "muted small whole-hint", text: T.wholeHint }), h("span", { class: "pane-space" }), fit, full, close);
    this.wholeWrap = h("div", { class: "pane whole-pane" }, head);
    // 右側は、左と同じグループを、そのままの見た目で、まわりのつながりまで広げて見せる(見るだけ)
    const w = new Canvas(
      {
        vault: this.vault,
        kindColor: (k: string) => this.config.edgeColors?.[k] ?? 0,
        openGroup: (g) => {
          this.main.classList.remove("whole-full");
          this.openGroup(g);
        },
        openBody: (id) => this.openBody(id),
        goToNode: (id) => {
          this.main.classList.remove("whole-full");
          this.goToNode(id, false, true);
        },
        pickGroup: async () => null,
        cardHover: (id, e) => cardTip(this.vault, id, e),
        onViewChange: () => {},
        onSelectionChange: () => {},
        dropOutside: (ids, cx, cy, link) => this.dropInto(w, this.canvas, ids, cx, cy, link),
        dragOutside: (ids, cx, cy) => this.dragOver(this.canvas, cx, cy, ids),
        onScopeChange: (n) => this.saveScope(n),
      },
      this.wholeWrap,
    );
    w.scope = this.savedScope();
    w.readOnly = true;
    w.el.classList.add("whole-canvas");
    w.setSurround(true);
    this.whole = w;
    this.splitBar = h("div", { class: "split-bar", title: T.splitBarTip });
    this.splitBar.addEventListener("pointerdown", (e) => this.dragSplit(e));
    this.splitBar.addEventListener("dblclick", () => this.setSplit(0.5));
    this.leftPane.after(this.splitBar, this.wholeWrap);
    this.main.classList.add("split");
    this.setSplit(this.state.splitRatio ?? 0.5);
    w.show(this.canvas.group, null);
    w.fitAll();
  }
  closeWhole(): void {
    this.wholeWrap?.remove();
    this.splitBar?.remove();
    this.splitBar = null;
    this.wholeWrap = null;
    this.whole = null;
    this.main.classList.remove("split", "whole-full");
    this.leftPane.style.flex = "";
    this.canvas.el.focus({ preventScroll: true });
  }
  private wholeTimer: ReturnType<typeof setTimeout> | undefined;
  private wholeSoon(): void {
    if (!this.whole) return;
    clearTimeout(this.wholeTimer);
    this.wholeTimer = setTimeout(() => this.whole?.requestRender(), 200);
  }

  /** 左右どちらを今使っているか(見出しに色を付けるだけ) */
  private setActivePane(p: "left" | "right"): void {
    this.main.dataset.active = p;
  }
  /** 左の画面の幅の割合(0.2〜0.8) */
  private setSplit(r: number): void {
    const v = Math.min(0.8, Math.max(0.2, r));
    this.leftPane.style.flex = `0 0 ${(v * 100).toFixed(2)}%`;
    this.state.splitRatio = v;
  }
  private dragSplit(e: PointerEvent): void {
    e.preventDefault();
    const bar = this.splitBar!;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
    const side = this.main.querySelector<HTMLElement>(".side-panel");
    const move = (ev: PointerEvent) => {
      const r = this.main.getBoundingClientRect();
      const sideW = side && getComputedStyle(side).display !== "none" ? side.getBoundingClientRect().width : 0;
      this.setSplit((ev.clientX - r.left) / Math.max(1, r.width - sideW));
    };
    const up = () => {
      bar.classList.remove("dragging");
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      this.saveState();
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  }
  /** 右の画面の ↑: 右の画面のまま上のグループへ(所属先が複数なら選ぶ) */
  private peekUp(anchor: HTMLElement): void {
    if (!this.peek || this.peek.group === ROOT_ID) return;
    const parents = this.vault.parentsOf(this.peek.group).filter((p) => this.vault.get(p)?.type === "group" || p === ROOT_ID);
    if (parents.length === 1) return this.openPeek(parents[0]);
    const r = anchor.getBoundingClientRect();
    showMenu(r.left, r.bottom + 2, parents.map((p) => ({ label: this.groupName(p), action: () => this.openPeek(p) })));
  }
  private async pickBeside(): Promise<void> {
    const r = await openPicker(this.vault, { title: T.besidePick, mode: "group" });
    if (r && "id" in r) this.openPeek(r.id);
  }
  toggleBeside(): void {
    if (this.peek) this.closePeek();
    else void this.pickBeside();
  }
  /** 新しいタブで開く: グループならその中を、ほかはそれのある所(所属先、なければ引用している所)を開いて選ぶ */
  openInTab(id: string, activate = true): void {
    const n = this.vault.get(id);
    if (!n) return;
    if (n.type === "group") return this.newTab(id, activate);
    const ps = this.vault.parentsOf(id);
    const g = ps.includes(ROOT_ID) ? ROOT_ID : ps.sort()[0] ?? this.vault.quotedBy(id)[0];
    if (g) this.newTab(g, activate, activate ? id : undefined);
  }
  /** 横に開く: グループならその中を、ほかは所属先(なければ引用している所)を開いて、そのノードを見せる */
  openBeside(id: string): void {
    const n = this.vault.get(id);
    if (!n) return;
    if (n.type === "group") return this.openPeek(id);
    const g = this.vault.parentsOf(id)[0] ?? this.vault.quotedBy(id)[0];
    if (g) this.openPeek(g, id);
  }
  /** 反対側の画面の上をドラッグしている間: 落とせる画面に枠、落とす先のノードに印(cx = null で消す) */
  private dragOver(to: Canvas | null, cx: number | null, cy: number, _ids: string[]): boolean {
    const panes = [this.leftPane, this.peekWrap].filter((x): x is HTMLElement => !!x);
    const clear = () => {
      for (const p of panes) p.classList.remove("drop-zone");
      this.canvas.markDropOut(null);
      this.peek?.markDropOut(null);
    };
    if (!to || cx === null) return clear(), false;
    const r = to.el.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return clear(), false;
    (to === this.canvas ? this.leftPane : this.peekWrap)?.classList.add("drop-zone");
    to.markDropOut(to.nodeAtPoint(cx, cy));
    return true;
  }
  /** 右クリックの「反対側の画面に引用する」: 反対側の画面の真ん中あたりに置く */
  private quoteAcross(from: Canvas, to: Canvas, ids: string[]): void {
    const r = to.el.getBoundingClientRect();
    this.dropInto(from, to, ids, r.left + r.width / 2, r.top + r.height / 2, false);
  }

  /** from の画面から to の画面へ落とした: to のグループに引用として置く(すでにあれば置かない)。ノードの上なら線でつなぐ */
  private dropInto(from: { rectOf(id: string): Rect | undefined }, to: Canvas, ids: string[], cx: number, cy: number, link: boolean): boolean {
    const r = to.el.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return false;
    const over = to.nodeAtPoint(cx, cy);
    const p = to.toWorld(cx, cy);
    const base = from.rectOf(ids[0]);
    const placed: string[] = [];
    this.vault.tx(() => {
      for (const id of ids) {
        if (id === to.group || !this.vault.exists(id)) continue;
        const b = from.rectOf(id);
        const x = Math.round(p.x + (b && base ? b.x - base.x : 0));
        const y = Math.round(p.y + (b && base ? b.y - base.y : 0));
        if (!this.vault.itemPos(to.group, id)) this.vault.addRef(to.group, id, x, y);
        placed.push(id);
        if (link && over && over !== id) this.vault.addLink(over, id);
      }
    });
    to.renderNow();
    to.setSelection(placed);
    to.el.focus({ preventScroll: true });
    return true;
  }

  // ---------- 書き出し ----------
  private openExport(): void {
    const el = document.querySelector(".tbtn.export") as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    // 今使っている側の画面。選んでいる物があれば、その範囲だけ(グループ全体は下のメニューから)
    const c = this.peek && this.main.dataset.active === "right" ? this.peek : this.canvas;
    const sel = c.selection.size || c.strokeSel.size ? { ids: [...c.selection], strokes: [...c.strokeSel] } : undefined;
    const go = (k: ExportKind, s?: typeof sel) => () => void exportGroup(this.vault, c.group, c, k, s);
    const formats = (s?: typeof sel): MenuItem[] => [
      { label: T.exportMd, action: go("md", s) },
      { label: T.exportPng, action: go("png", s) },
      { label: T.exportHtml, action: go("html", s) },
      { separator: true, label: "" },
      { label: T.exportCopy, action: go("copy", s) },
    ];
    const items: MenuItem[] = sel
      ? [{ label: T.exportSelHead(sel.ids.length + sel.strokes.length), disabled: true }, ...formats(sel), { separator: true, label: "" }, { label: T.exportWhole, sub: formats() }]
      : formats();
    showMenu(r?.left ?? 200, (r?.bottom ?? 40) + 2, items);
  }

  // ---------- ペン ----------
  togglePen(on?: boolean): void {
    this.canvas.setPen({ on: on ?? !this.canvas.pen.on });
    this.renderPenBar();
  }
  private setPen(p: Partial<PenState>): void {
    this.canvas.setPen(p);
    const { on: _on, ...keep } = this.canvas.pen;
    this.config.pen = keep;
    api().setConfig({ pen: keep });
    this.renderPenBar();
  }
  private renderPenBar(): void {
    const p = this.canvas.pen;
    this.btnPen.classList.toggle("on", p.on);
    this.penBar.hidden = !p.on;
    if (!p.on) return;
    // 2026-11-24 統合仕様 9: 絵のボタン(ペン・蛍光ペン・消しゴム)・実際の太さの見本・丸い色。細かな太さは「…」のときだけ
    const ICON: Record<PenState["tool"], string> = {
      pen: '<path d="M5 19l1.2-4.2L16 5l3 3-9.8 9.8z"/><path d="M14 7l3 3"/>',
      hl: '<path d="M7 15l8-10 4 3-8 10z"/><path d="M7 15l-2 4h5l1-2"/>',
      eraser: '<path d="M4 15l8-9 7 6-7 8H8z"/><path d="M8.5 11l6.5 5.5M8 20h11"/>',
    };
    const tool = (t: PenState["tool"], label: string) => {
      const ico = svg("svg", { viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true" });
      ico.innerHTML = ICON[t];
      const b = h("button", { class: "pb-tool" + (p.tool === t ? " on" : ""), title: label, "aria-label": label, "data-tool": t }, ico);
      b.addEventListener("click", () => this.setPen({ tool: t }));
      return b;
    };
    const presets = [2, 4, 8];
    const sizes = presets.map((w, i) => {
      const b = h("button", { class: "pb-size" + (p.width === w ? " on" : ""), title: `${T.penSize}: ${T.penSizes[i]}`, "aria-label": `${T.penSize}: ${T.penSizes[i]}` }, h("i", { style: `height:${w}px` }));
      b.addEventListener("click", () => this.setPen({ width: w }));
      return b;
    });
    const more = h("button", { class: "pb-more" + (presets.includes(p.width) ? "" : " on"), title: T.penSizeFine, text: presets.includes(p.width) ? "…" : String(p.width) });
    more.addEventListener("click", () => {
      const range = h("input", { type: "range", min: 1, max: 30, value: String(p.width), title: T.penSize }) as HTMLInputElement;
      const num = h("span", { class: "pb-w", text: String(p.width) });
      range.addEventListener("input", () => {
        num.textContent = range.value;
        this.canvas.setPen({ width: +range.value });
      });
      range.addEventListener("change", () => this.setPen({ width: +range.value }));
      range.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        pop.remove();
        this.canvas.el.focus({ preventScroll: true });
      });
      const pop = h("div", { class: "pb-pop" }, range, num);
      this.penBar.append(pop);
      range.focus();
      const off = (e: MouseEvent) => {
        if (pop.contains(e.target as Node)) return;
        pop.remove();
        removeEventListener("mousedown", off, true);
      };
      addEventListener("mousedown", off, true);
    });
    const colors = Array.from({ length: PRESET_COLORS + 1 }, (_, c) => {
      const b = h("button", { class: `sw ink c${c}${p.color === c ? " active" : ""}`, title: c ? `${T.color} ${c}` : T.inkDefault, "aria-label": c ? `${T.color} ${c}` : T.inkDefault });
      b.addEventListener("click", () => this.setPen({ color: c }));
      return b;
    });
    this.penBar.replaceChildren(
      tool("pen", T.penPen), tool("hl", T.penHl), tool("eraser", T.penEraser),
      h("span", { class: "pb-sep" }), ...sizes, more,
      h("span", { class: "pb-sep" }), h("div", { class: "pb-colors" }, ...colors),
    );
    this.penBar.title = T.penExitTip;
  }

  settings(): void {
    const theme = this.config.theme ?? "system";
    const radios = (["system", "light", "dark"] as Theme[]).map((t) => {
      const r = h("input", { type: "radio", name: "theme", value: t });
      r.checked = t === theme;
      r.addEventListener("change", () => this.setTheme(t));
      return h("label", { class: "check" }, r, t === "system" ? T.themeSystem : t === "light" ? T.themeLight : T.themeDark);
    });
    const drawSet = h("button", { class: "btn", text: T.drawSettings });
    const lineSet = h("button", { class: "btn", text: T.lineSettings });
    lineSet.addEventListener("click", () => this.lineSettings());
    const open = h("button", { class: "btn", text: T.openFolder });
    open.addEventListener("click", async () => {
      const d = await api().chooseVault();
      if (d) {
        await this.flushAll();
        location.reload();
      }
    });
    // ショートカットは見出しごとのカードに、キーはキーの形で(2026-11-23 利用者「羅列で見づらい」)
    const isKey = (k: string) => [...k].length <= 6 && !/クリック|ドラッグ|ホイール|ペン/.test(k);
    const keyRow = (combo: string[]) => h("span", { class: "combo" }, ...combo.flatMap((k, i) => [i ? h("span", { class: "plus", text: "+" }) : null, h(isKey(k) ? "kbd" : "span", { class: isKey(k) ? "" : "act", text: k })]).filter(Boolean) as HTMLElement[]);
    const table = h(
      "div",
      { class: "sc-grid" },
      ...SHORTCUTS.map((sec) =>
        h(
          "section",
          { class: "sc-card" },
          h("div", { class: "sc-title" }, h("span", { class: "sc-icon", text: sec.icon }), sec.title),
          ...sec.items.map((it) =>
            h("div", { class: "sc-row" }, h("div", { class: "sc-keys" }, ...it.keys.flatMap((c, i) => [i ? h("span", { class: "or", text: "/" }) : null, keyRow(c)]).filter(Boolean) as HTMLElement[]), h("div", { class: "sc-desc", text: it.desc })),
          ),
        ),
      ),
    );
    const close = h("button", { class: "btn primary", text: "OK" });
    const box = h(
      "div",
      { class: "modal settings wide" },
      h("div", { class: "modal-title", text: T.settingsTitle }),
      h("div", { class: "set-row" }, h("span", { class: "set-label", text: T.theme }), ...radios),
      h("div", { class: "set-row" }, h("span", { class: "set-label", text: T.draw }), drawSet),
      h("div", { class: "set-row" }, h("span", { class: "set-label", text: T.lineSettingsShort }), lineSet),
      h("div", { class: "set-row" }, h("span", { class: "set-label", text: T.vaultLabel }), h("code", { text: this.dir }), open),
      h("div", { class: "modal-title sub", text: T.shortcutsTitle }),
      table,
      h("p", { class: "muted small", text: T.credits }),
      h("div", { class: "row-end" }, close),
    );
    const back = h("div", { class: "backdrop" }, box);
    const done = () => {
      back.remove();
      removeEventListener("keydown", onKey, true);
    };
    drawSet.addEventListener("click", () => {
      done();
      this.openDraw("settings");
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done();
      }
    };
    addEventListener("keydown", onKey, true);
    close.addEventListener("click", done);
    back.addEventListener("mousedown", (e) => e.target === back && done());
    document.body.append(back);
  }

  // ---------- キー ----------
  private bindKeys(): void {
    addEventListener("mouseup", (e) => {
      if (e.button === 3) this.back();
      if (e.button === 4) this.forward();
    });
    // ファイルを貼り付けると、今使っている画面の真ん中に添付(ノートを書いている間はノートに入る)
    addEventListener("paste", (e) => {
      const files = e.clipboardData?.files;
      const inField = (e.target as Element)?.closest?.("input, textarea, .ProseMirror");
      if (inField || this.popup || this.records || this.paperOpen) return;
      const c = this.peek && this.main.dataset.active === "right" ? this.peek : this.canvas;
      // Ctrl+C でコピーした物(目印の文字が入っている)は、引用として貼る
      const norm = (t: string) => t.replace(/\r\n/g, "\n").trim();
      if (!files?.length && refClipboard.size && norm(e.clipboardData?.getData("text/plain") ?? "") === norm(refClipboard.mark)) {
        e.preventDefault();
        c.pasteRefs();
        return;
      }
      if (!files?.length) return;
      e.preventDefault();
      const p = c.visibleCenter();
      void c.attachFilesAt(files, p.x, p.y);
    });
    addEventListener("keydown", (e) => {
      if (document.querySelector(".backdrop") || menuOpen() || drawMenuOpen()) return; // 窓が開いている
      const inField = (e.target as Element)?.closest?.("input, textarea, .ProseMirror");
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "k") {
        e.preventDefault();
        this.search();
        return;
      }
      // タブ: Ctrl+T 新しいタブ(今のグループ)・Ctrl+W 閉じる・Ctrl+Tab / Ctrl+PageDown 次・Ctrl+Shift+Tab / Ctrl+PageUp 前
      if (e.ctrlKey && !e.shiftKey && k === "t") {
        e.preventDefault();
        this.newTab();
        return;
      }
      if (e.ctrlKey && !e.shiftKey && k === "w") {
        e.preventDefault();
        this.closeTab();
        return;
      }
      if (e.ctrlKey && (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp")) {
        e.preventDefault();
        if (this.tabs.length > 1) {
          const d = e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
          this.switchTab((this.activeTab + d + this.tabs.length) % this.tabs.length);
        }
        return;
      }
      if (e.ctrlKey && (e.key === "[" || e.code === "BracketLeft")) {
        e.preventDefault();
        this.back();
        return;
      }
      if (e.ctrlKey && (e.key === "]" || e.code === "BracketRight")) {
        e.preventDefault();
        this.forward();
        return;
      }
      // 移動の履歴: Ctrl+← 戻る・Ctrl+→ 進む(統合仕様 1)。書いている最中はふつうのカーソル移動
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !inField && !this.paperOpen && !this.records) {
        e.preventDefault();
        if (e.key === "ArrowLeft") this.back();
        else this.forward();
        return;
      }
      if (e.ctrlKey && e.key === "Home") {
        e.preventDefault();
        this.openGroup(ROOT_ID);
        return;
      }
      if (e.key === "Escape" && this.main.classList.contains("whole-full")) {
        e.preventDefault();
        this.main.classList.remove("whole-full");
        return;
      }
      if (e.ctrlKey && k === "j") {
        e.preventDefault();
        this.toggleRecords();
        return;
      }
      if (e.ctrlKey && k === "p") {
        e.preventDefault();
        this.togglePaper();
        return;
      }
      if (e.key === "Escape" && this.paperOpen && !document.fullscreenElement) {
        e.preventDefault();
        this.closePaper();
        return;
      }
      if (this.paperOpen) return; // 紙PKM の画面ではキャンバスのキーを使わない
      if (e.key === "Escape" && this.records && !this.popup) {
        e.preventDefault();
        this.closeRecords();
        return;
      }
      if (e.ctrlKey && k === "d") {
        e.preventDefault();
        this.openToday();
        return;
      }
      if (e.ctrlKey && e.key === "ArrowUp" && !inField) {
        e.preventDefault();
        this.goUp();
        return;
      }
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        this.settings();
        return;
      }
      if (inField) return;
      if (e.key === "Escape" && this.popup) {
        this.closePopup();
        return;
      }
      if (e.key === "Escape" && this.canvas.pen.on) {
        this.togglePen(false);
        return;
      }
      if (e.key === "Escape" && this.sideVisible()) {
        this.toggleSide(false);
        return;
      }
      if (e.ctrlKey && k === "z") {
        e.preventDefault();
        if (!this.vault.undo()) toast(T.undoNothing);
        return;
      }
      if (e.ctrlKey && k === "y") {
        e.preventDefault();
        this.vault.redo();
        return;
      }
      if (e.ctrlKey && e.key === "\\") {
        e.preventDefault();
        this.toggleBeside();
        return;
      }
      const active = this.peek && this.peek.el.contains(document.activeElement) ? this.peek : this.canvas;
      if (e.key === "Escape" && active === this.peek && !this.peek.selection.size) {
        this.closePeek();
        return;
      }
      if (active.handleKey(e)) {
        e.preventDefault();
        closeMenu();
      }
    });
  }
}

const app = new App();
(window as unknown as { __app: App }).__app = app; // 画面の試験から中を覗くため
app.boot();
