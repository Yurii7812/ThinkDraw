// 画面全体: 上部バー・キャンバス・グラフパネル・履歴・状態の保存・自動保存
import { ROOT_ID } from "../core/types";
import { Vault } from "../core/vault";
import { Canvas, type View } from "./canvas";
import { BodyPopup } from "./editor";
import { GraphPanel, type GraphMode } from "./graph";
import { openPicker } from "./picker";
import { SHORTCUTS, T } from "./strings";
import { cardTip, openDrawDialog, placeDraw } from "./tarot";
import { api, closeMenu, h, menuOpen, toast } from "./ui";

type Theme = "system" | "light" | "dark";
interface AppState {
  views: Record<string, View>;
  graphOpen: boolean;
  graphMode: GraphMode;
  lastGroup: string;
  lastSpread?: string | null;
  lastCount?: number;
}
interface Config {
  theme?: Theme;
  reversed?: boolean;
}
const STATE_FILE = "state.json";

class App {
  vault!: Vault;
  canvas!: Canvas;
  graph!: GraphPanel;
  popup: BodyPopup | null = null;
  state: AppState = { views: {}, graphOpen: false, graphMode: "groups", lastGroup: ROOT_ID };
  config: Config = {};
  dir = "";
  private backStack: string[] = [];
  private fwdStack: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private stateTimer: ReturnType<typeof setTimeout> | undefined;
  private graphTimer: ReturnType<typeof setTimeout> | undefined;
  private titleEl!: HTMLElement;
  private btnBack!: HTMLButtonElement;
  private btnFwd!: HTMLButtonElement;
  private main!: HTMLElement;

  async boot(): Promise<void> {
    this.config = (await api().getConfig()) ?? {};
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
      this.state = { ...this.state, ...JSON.parse((await api().readApp(STATE_FILE)) ?? "{}") };
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
    const search = h("button", { class: "searchbox", text: T.searchPlaceholder });
    search.addEventListener("click", () => this.search());
    const bar = h(
      "header",
      { class: "topbar" },
      h("div", { class: "tb-left" }, this.btnBack, this.btnFwd, btn("i-home", T.goHome + " (Ctrl+Home)", () => this.openGroup(ROOT_ID))),
      h("div", { class: "tb-center" }, this.titleEl),
      h(
        "div",
        { class: "tb-right" },
        search,
        btn("draw", T.draw, () => this.draw(), T.draw),
        btn("i-theme", T.theme, () => this.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")),
        btn("i-graph", T.graph + " (Ctrl+E)", () => this.toggleGraph()),
        btn("i-settings", T.settings + " (Ctrl+/)", () => this.settings()),
      ),
    );
    this.main = h("main", { class: "main" });
    document.body.replaceChildren(bar, this.main);
    this.canvas = new Canvas(
      {
        vault: this.vault,
        openGroup: (id) => this.openGroup(id),
        openBody: (id) => this.openBody(id),
        pickGroup: async () => {
          const r = await openPicker(this.vault, { title: T.pickGroupTitle, mode: "group" });
          return r && "id" in r ? r.id : null;
        },
        cardHover: (id, e) => cardTip(this.vault, id, e),
        cardImageUrl: (deck, file) => `../../assets/decks/${deck}/${file}`,
        onViewChange: (g, v) => {
          this.state.views[g] = v;
          this.saveState();
        },
        onSelectionChange: () => {},
      },
      this.main,
    );
    this.graph = new GraphPanel(
      {
        vault: this.vault,
        currentGroup: () => this.canvas.group,
        openGroup: (id) => this.openGroup(id),
        goToNode: (id) => this.goToNode(id, false),
        onModeChange: (m) => {
          this.state.graphMode = m;
          this.saveState();
        },
      },
      this.main,
    );
    this.graph.mode = this.state.graphMode;
    this.main.classList.toggle("graph-open", this.state.graphOpen);
    if (this.state.graphOpen) requestAnimationFrame(() => this.graph.render());
    this.bindKeys();
  }

  // ---------- 保存 ----------
  private onVaultChange(ids: Set<string>): void {
    this.canvas.requestRender();
    this.scheduleFlush();
    if (this.state.graphOpen) {
      clearTimeout(this.graphTimer);
      this.graphTimer = setTimeout(() => this.graph.render(), 120);
    }
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
    if (this.state.graphOpen) this.graph.render();
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
  /** そのノード(が含まれるグループ)へ移る */
  goToNode(id: string, openBody: boolean): void {
    if (!this.vault.exists(id)) return;
    let g = this.canvas.group;
    if (!this.vault.memberPos(g, id)) {
      const parents = this.vault.parentsOf(id);
      g = parents.includes(ROOT_ID) ? ROOT_ID : parents.sort()[0] ?? ROOT_ID;
    }
    this.openGroup(g, id);
    if (openBody) this.openBody(id);
  }

  // ---------- ポップアップ ----------
  openBody(id: string): void {
    if (!this.vault.exists(id)) return;
    const expanded = this.popup?.expanded ?? false;
    this.closePopup();
    this.canvas.commitDraft("esc");
    this.popup = new BodyPopup(
      {
        vault: this.vault,
        goToGroup: (g, focus) => this.openGroup(g, focus),
        goToNode: (n, ob) => this.goToNode(n, ob),
        closedEditor: () => {
          this.popup = null;
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

  // ---------- 検索・引く・グラフ・設定 ----------
  async search(): Promise<void> {
    const r = await openPicker(this.vault, { title: T.searchTitle, mode: "search" });
    if (!r || !("id" in r)) return;
    const n = this.vault.get(r.id);
    if (n?.type === "group") this.openGroup(r.id);
    else this.goToNode(r.id, false);
  }

  async draw(): Promise<void> {
    const o = await openDrawDialog(!!this.config.reversed, { spread: this.state.lastSpread ?? null, count: this.state.lastCount ?? 3 });
    if (!o) return;
    if (o.reversed !== !!this.config.reversed) {
      this.config.reversed = o.reversed;
      api().setConfig({ reversed: o.reversed });
    }
    this.state.lastSpread = o.spread;
    this.state.lastCount = o.count;
    this.saveState();
    const ids = placeDraw(this.vault, this.canvas.group, this.canvas.visibleCenter(), o);
    this.canvas.renderNow();
    this.canvas.setSelection(ids);
    this.canvas.ensureVisible(ids);
  }

  toggleGraph(): void {
    this.state.graphOpen = !this.state.graphOpen;
    this.main.classList.toggle("graph-open", this.state.graphOpen);
    this.saveState();
    if (this.state.graphOpen) requestAnimationFrame(() => this.graph.render());
  }

  settings(): void {
    const theme = this.config.theme ?? "system";
    const radios = (["system", "light", "dark"] as Theme[]).map((t) => {
      const r = h("input", { type: "radio", name: "theme", value: t });
      r.checked = t === theme;
      r.addEventListener("change", () => this.setTheme(t));
      return h("label", { class: "check" }, r, t === "system" ? T.themeSystem : t === "light" ? T.themeLight : T.themeDark);
    });
    const rev = h("input", { type: "checkbox" });
    rev.checked = !!this.config.reversed;
    rev.addEventListener("change", () => {
      this.config.reversed = rev.checked;
      api().setConfig({ reversed: rev.checked });
    });
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
      h("div", { class: "set-row" }, h("label", { class: "check" }, rev, T.drawReversed)),
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
      if (document.querySelector(".backdrop") || menuOpen()) return; // 窓が開いている
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
        this.toggleGraph();
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
