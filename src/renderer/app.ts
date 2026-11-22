// 画面全体: 上部バー・キャンバス・右の欄(詳細|グラフ)・ペン・履歴・状態の保存・自動保存
import { ROOT_ID } from "../core/types";
import { Vault } from "../core/vault";
import { Canvas, PRESET_COLORS, type PenState, type View } from "./canvas";
import { BodyPopup } from "./editor";
import type { GraphMode } from "./graph";
import { openPicker } from "./picker";
import { SidePanel, type SideTab } from "./side";
import { SHORTCUTS, T } from "./strings";
import { cardTip, closeDrawMenu, DEFAULT_CONFIG, drawLabel, drawMenuOpen, openDrawMenu, runDraw, type DrawConfig, type DrawKind } from "./tarot";
import { api, closeMenu, h, menuOpen, showMenu, toast, type MenuItem } from "./ui";

type Theme = "system" | "light" | "dark";
interface AppState {
  views: Record<string, View>;
  graphOpen: boolean; // 右の欄を手で開いているか(名前は前の版のまま)。カードを選んで自動で開いた分は含めない
  graphMode: GraphMode;
  sideTab: SideTab;
  lastGroup: string;
}
interface Config {
  theme?: Theme;
  draw?: Partial<DrawConfig>;
  pen?: Partial<PenState>;
}
const STATE_FILE = "state.json";

class App {
  vault!: Vault;
  canvas!: Canvas;
  side!: SidePanel;
  popup: BodyPopup | null = null;
  private sideAuto = false; // カードを選んで自動で開いている間だけ true(保存しない)
  private sidePrevTab: SideTab | null = null; // 自動で開く前の欄(自動で閉じるとき、これに戻す)
  state: AppState = { views: {}, graphOpen: false, graphMode: "local", sideTab: "map", lastGroup: ROOT_ID };
  config: Config = {};
  draw: DrawConfig = { ...DEFAULT_CONFIG };
  dir = "";
  private backStack: string[] = [];
  private fwdStack: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private stateTimer: ReturnType<typeof setTimeout> | undefined;
  private sideTimer: ReturnType<typeof setTimeout> | undefined;
  private titleEl!: HTMLElement;
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
    try {
      const st = JSON.parse((await api().readApp(STATE_FILE)) ?? "{}");
      if (st.graphMode !== "local" && st.graphMode !== "groups") delete st.graphMode;
      this.state = { ...this.state, ...st };
    } catch {
      /* 壊れていたら初期値 */
    }
    this.buildUi();
    if (this.vault.broken.length) toast(T.brokenFiles(this.vault.broken.length), 5000);
    this.vault.onChange((ids) => this.onVaultChange(ids));
    api().onChanged(({ name, content }) => {
      if (this.vault.applyExternal(name, content)) toast(T.externalChange);
    });
    api().onFlush(() => this.flushAll());
    await api().watch();
    const g = this.vault.get(this.state.lastGroup)?.type === "group" ? this.state.lastGroup : ROOT_ID;
    this.canvas.show(g, this.state.views[g] ?? null);
    this.updateBar();
    this.scheduleFlush(); // 根を作ったとき・迷子を根に入れたときに書く
  }

  private buildUi(): void {
    const btn = (cls: string, title: string, fn: () => void, text = "") => {
      const b = h("button", { class: "tbtn " + cls, title, "aria-label": title, text });
      b.addEventListener("click", fn);
      return b;
    };
    this.btnBack = btn("i-back", T.back + " (Ctrl+[)", () => this.back());
    this.btnFwd = btn("i-fwd", T.forward + " (Ctrl+])", () => this.forward());
    this.titleEl = h("button", { class: "group-title" });
    this.titleEl.addEventListener("click", () => this.openBody(this.canvas.group));
    this.upBtn = h("button", { class: "group-up", title: T.upMenu, "aria-label": T.upMenu, text: "▾" });
    this.upBtn.addEventListener("click", () => this.openUpMenu());
    const search = h("button", { class: "searchbox", text: T.searchPlaceholder });
    search.addEventListener("click", () => this.search());
    this.btnDraw = btn("draw", "", () => this.drawAgain(), T.draw);
    const caret = btn("draw-caret", T.drawMenu, () => this.openDraw(), "▾");
    this.btnPen = btn("i-pen", T.penOn, () => this.togglePen(), T.pen);
    const bar = h(
      "header",
      { class: "topbar" },
      h("div", { class: "tb-left" }, this.btnBack, this.btnFwd, btn("i-home", T.goHome + " (Ctrl+Home)", () => this.openGroup(ROOT_ID))),
      h("div", { class: "tb-center" }, this.titleEl, this.upBtn),
      h(
        "div",
        { class: "tb-right" },
        search,
        this.btnPen,
        h("div", { class: "split" }, this.btnDraw, caret),
        btn("i-theme", T.theme, () => this.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")),
        btn("i-graph", T.sidePanel + " (Ctrl+E)", () => this.toggleSide()),
        btn("i-settings", T.settings + " (Ctrl+/)", () => this.settings()),
      ),
    );
    this.updateDrawTitle();
    this.main = h("main", { class: "main" });
    this.penBar = h("div", { class: "penbar" });
    document.body.replaceChildren(bar, this.main);
    this.canvas = new Canvas(
      {
        vault: this.vault,
        openGroup: (id) => this.openGroup(id),
        openBody: (id) => this.openBody(id),
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
      },
      this.main,
    );
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
    this.side.setTab(this.state.sideTab, false);
    this.applySide();
    this.canvas.setPen({ ...this.config.pen, on: false });
    this.renderPenBar();
    this.bindKeys();
  }

  // ---------- 選択と右の欄 ----------
  private onSelection(ids: string[]): void {
    // カードを 1 つ選んだときだけ、右の欄の「詳細」を自動で開く(文字では開かない)。
    // 自動で開いた分は、選択を外すか別の種類を選ぶと閉じる(手で開いたものは閉じない・保存もしない)
    const t = ids.length === 1 ? this.vault.get(ids[0])?.type : undefined;
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
    this.scheduleFlush();
    this.renderSideSoon();
    if (!this.vault.exists(this.canvas.group)) {
      // 開いていたグループが消えた
      this.backStack = this.backStack.filter((g) => this.vault.exists(g));
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
    this.upBtn.style.display = this.canvas.group === ROOT_ID ? "none" : "";
    this.renderSideSoon();
  }
  /** 題の横の▾: 所属先とホームへ移る */
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
      this.backStack.push(this.canvas.group);
      this.fwdStack = [];
      this.showGroup(id, "in");
    }
    if (focusNode) this.canvas.centerOn(focusNode);
  }
  private showGroup(id: string, anim: "in" | "out"): void {
    this.canvas.show(id, this.state.views[id] ?? null, anim);
    this.state.lastGroup = id;
    this.saveState();
    this.updateBar();
    this.renderSideSoon();
  }
  back(): void {
    const g = this.backStack.pop();
    if (!g) return;
    this.fwdStack.push(this.canvas.group);
    this.showGroup(this.vault.exists(g) ? g : ROOT_ID, "out");
  }
  forward(): void {
    const g = this.fwdStack.pop();
    if (!g) return;
    this.backStack.push(this.canvas.group);
    this.showGroup(this.vault.exists(g) ? g : ROOT_ID, "in");
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
  private closePopup(): void {
    this.popup?.close();
    this.popup = null;
  }

  // ---------- 検索・引く・右の欄・設定 ----------
  async search(): Promise<void> {
    const r = await openPicker(this.vault, { title: T.searchTitle, mode: "search" });
    if (!r || !("id" in r)) return;
    const n = this.vault.get(r.id);
    if (n?.type === "group") this.openGroup(r.id);
    else this.goToNode(r.id, false);
  }

  private updateDrawTitle(): void {
    this.btnDraw.title = `${T.draw}: ${drawLabel(this.draw.last)}(▾ で種類を選ぶ)`;
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
    openDrawMenu(this.btnDraw.parentElement!, this.draw, tab ?? lastTab, this.canvas.selection.size === 1, (k, q) => this.doDraw(k, q), () => this.saveDraw());
  }
  drawAgain(): void {
    this.doDraw(this.draw.last, "");
  }
  private doDraw(k: DrawKind, question: string): void {
    this.draw.last = k;
    this.saveDraw();
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
    const tool = (t: PenState["tool"], label: string) => {
      const b = h("button", { class: "pb-tool" + (p.tool === t ? " on" : ""), text: label, title: label });
      b.addEventListener("click", () => this.setPen({ tool: t }));
      return b;
    };
    const sizes = [2, 4, 8].map((w, i) => {
      const b = h("button", { class: "pb-size" + (p.width === w ? " on" : ""), title: `${T.penSize}: ${T.penSizes[i]}` }, h("i", { style: `width:${w + 2}px;height:${w + 2}px` }));
      b.addEventListener("click", () => this.setPen({ width: w }));
      return b;
    });
    const range = h("input", { type: "range", min: 1, max: 30, value: String(p.width), title: T.penSize });
    range.addEventListener("input", () => this.setPen({ width: +range.value }));
    const colors = Array.from({ length: PRESET_COLORS + 1 }, (_, c) => {
      const b = h("button", { class: `sw ink c${c}${p.color === c ? " active" : ""}`, title: c ? `${T.color} ${c}` : T.inkDefault });
      b.addEventListener("click", () => this.setPen({ color: c }));
      return b;
    });
    const done = h("button", { class: "btn small", text: T.penDone });
    done.addEventListener("click", () => this.togglePen(false));
    this.penBar.replaceChildren(
      tool("pen", T.penPen), tool("hl", T.penHl), tool("eraser", T.penEraser),
      h("span", { class: "pb-sep" }), ...sizes, range, h("span", { class: "pb-w", text: String(p.width) }),
      h("span", { class: "pb-sep" }), ...colors,
      h("span", { class: "pb-sep" }), done,
    );
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
    const open = h("button", { class: "btn", text: T.openFolder });
    open.addEventListener("click", async () => {
      const d = await api().chooseVault();
      if (d) {
        await this.flushAll();
        location.reload();
      }
    });
    const table = h("table", { class: "shortcuts" }, ...SHORTCUTS.map(([k, d]) => h("tr", {}, h("th", { text: k }), h("td", { text: d }))));
    const close = h("button", { class: "btn primary", text: "OK" });
    const box = h(
      "div",
      { class: "modal settings" },
      h("div", { class: "modal-title", text: T.settingsTitle }),
      h("div", { class: "set-row" }, h("span", { class: "set-label", text: T.theme }), ...radios),
      h("div", { class: "set-row" }, h("span", { class: "set-label", text: T.draw }), drawSet),
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
    addEventListener("keydown", (e) => {
      if (document.querySelector(".backdrop") || menuOpen() || drawMenuOpen()) return; // 窓が開いている
      const inField = (e.target as Element)?.closest?.("input, textarea, .ProseMirror");
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "k") {
        e.preventDefault();
        this.search();
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
      if (e.ctrlKey && e.key === "Home") {
        e.preventDefault();
        this.openGroup(ROOT_ID);
        return;
      }
      if (e.ctrlKey && k === "e") {
        e.preventDefault();
        this.toggleSide();
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
      if (this.canvas.handleKey(e)) {
        e.preventDefault();
        closeMenu();
      }
    });
  }
}

const app = new App();
(window as unknown as { __app: App }).__app = app; // 画面の試験から中を覗くため
app.boot();
