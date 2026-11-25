// 本文のポップアップ(SPEC 4.3)。見た目で編集し(ProseMirror)、Markdown で保存する。
import { baseKeymap, setBlockType, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { hrefToNodeId, nodeHref } from "../core/links";
import { ROOT_ID } from "../core/types";
import type { Vault } from "../core/vault";
import { cardName } from "../decks";
import { openPicker } from "./picker";
import { T } from "./strings";
import { addColRight, addRowBelow, cellAt, cellBelow, deleteTable, nextCell, parseMarkdown, prevCell, schema, serializeMarkdown } from "./mdschema";
import { api, h, showMenu, svg, toast } from "./ui";

export interface EditorHost {
  vault: Vault;
  goToGroup(id: string, focusNode?: string): void;
  goToNode(id: string, openBody: boolean): void;
  closedEditor(): void;
  openSearch(): void;
}

export { parseMarkdown, serializeMarkdown };

/** 本文の画像の src(vault の中の相対パス)を、画面で読める URL にする */
export function resolveSrc(src: string): string {
  if (/^(https?:|data:|vault:|file:)/.test(src)) return src;
  return "vault://local/" + src.split("/").map(encodeURIComponent).join("/");
}

// ---------- URL のリンクカード(本文に URL だけの行があるとき) ----------
const urlKey = new PluginKey<DecorationSet>("urlcards");
const titleCache = new Map<string, string | null>();

function urlCardPlugin(): Plugin {
  const build = (doc: PMNode, view?: EditorView) => {
    const decos: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name !== "paragraph") return node.type.name !== "code_block";
      const t = node.textContent.trim();
      if (!/^https?:\/\/\S+$/.test(t) || node.childCount > 2) return false;
      decos.push(
        Decoration.widget(pos + node.nodeSize, () => {
          const title = titleCache.get(t);
          const card = h(
            "div",
            { class: "urlcard", contenteditable: "false", title: t },
            h("span", { class: "ico ico-url" }),
            h("div", { class: "uc-main" }, h("div", { class: "uc-title", text: title ?? (titleCache.has(t) ? t : T.urlLoading) }), h("div", { class: "uc-url", text: t })),
          );
          card.addEventListener("mousedown", (e) => {
            e.preventDefault();
            api().openExternal(t);
          });
          if (!titleCache.has(t)) {
            titleCache.set(t, null);
            api()
              .urlTitle(t)
              .then((title) => {
                titleCache.set(t, title);
                if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(urlKey, "refresh"));
              });
          }
          return card;
        }, { side: 1, key: `${t}:${titleCache.get(t) ?? ""}` }),
      );
      return false;
    });
    return DecorationSet.create(doc, decos);
  };
  let viewRef: EditorView | undefined;
  return new Plugin({
    key: urlKey,
    view(v) {
      viewRef = v;
      return {};
    },
    state: {
      init: (_c, st) => build(st.doc),
      apply: (tr, old) => (tr.docChanged || tr.getMeta(urlKey) ? build(tr.doc, viewRef) : old),
    },
    props: { decorations: (st) => urlKey.getState(st) },
  });
}

function placeholderPlugin(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(st) {
        const d = st.doc;
        if (d.childCount === 1 && d.firstChild!.isTextblock && d.firstChild!.content.size === 0)
          return DecorationSet.create(d, [Decoration.node(0, d.firstChild!.nodeSize, { class: "pm-empty", "data-placeholder": text })]);
        return null;
      },
    },
  });
}

/** 右上のボタンの絵(線だけの小さな SVG。2026-11-23 利用者「分かりづらいのでアイコンを」) */
const TOOL_ICONS: Record<string, string> = {
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M10 5h7M7 19h7M14 5l-4 14"/>',
  heading: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  list: '<circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/><path d="M10 7h10M10 12h10M10 17h10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  attach: '<path d="M20 11.5 12.5 19a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7L10.2 16.7a1.7 1.7 0 0 1-2.4-2.4L14.5 7.6"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
  table: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M9 5v14M15 5v14"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
};

export class BodyPopup {
  readonly id: string;
  private el: HTMLElement;
  private view: EditorView;
  private titleInput: HTMLInputElement | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSaved: string;
  private lastTitle: string;
  private unsub: () => void;
  private footer: HTMLElement;
  private bubble: HTMLElement | null = null;

  constructor(private host: EditorHost, id: string, parent: HTMLElement, expanded = false, private inline = false) {
    this.id = id;
    const v = host.vault;
    const n = v.get(id)!;
    this.lastSaved = n.body;
    this.lastTitle = n.title;

    const btn = (label: string, cls: string, fn: () => void, icon = "") => {
      const ico = svg("svg", { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": "true", class: "tb-ico" });
      ico.innerHTML = TOOL_ICONS[icon || cls.replace(/^b-/, "")] ?? "";
      const b = h("button", { class: "tb " + cls, title: label, "aria-label": label }, ico);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", fn);
      return b;
    };
    const head = h("div", { class: "pop-head" });
    if (n.type === "card" && n.card) {
      head.append(h("div", { class: "pop-title static", text: cardName(n.card) }));
    } else {
      const ti = h("input", { class: "pop-title", placeholder: n.type === "group" ? T.untitledGroup : T.titlePlaceholder, value: id === ROOT_ID ? T.home : n.title });
      if (id === ROOT_ID) ti.disabled = true;
      ti.addEventListener("input", () => this.scheduleSave());
      ti.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          this.view.focus();
        }
        if (e.key === "Escape") this.close();
      });
      this.titleInput = ti;
      head.append(ti);
    }
    const tools = h(
      "div",
      { class: "pop-tools" },
      btn(T.bold, "b-bold", () => this.cmd(toggleMark(schema.marks.strong))),
      btn(T.italic, "b-italic", () => this.cmd(toggleMark(schema.marks.em))),
      btn(T.heading, "b-heading", () => this.cmd(setBlockType(schema.nodes.heading, { level: 2 }))),
      btn(T.bulletList, "b-list", () => this.cmd(wrapInList(schema.nodes.bullet_list))),
      btn(T.checkToggle, "b-check", () => this.toggleCheck(), "check"),
      btn(T.makeLink, "b-link", () => this.makeLink()),
      btn(T.tableOps, "b-tableops", () => this.attachMenu(), "table"),
      h("span", { class: "spacer" }),
      btn(T.expand, "b-expand", () => this.toggleExpand()),
      btn(T.close, "b-close", () => this.close()),
    );
    // キャンバスの上でそのまま書くときは、道具も枠も出さない(ふだんの表示と同じ見た目。2026-11-25 利用者)
    if (!inline) head.append(tools);

    const editorEl = h("div", { class: "pop-body" });
    this.footer = h("div", { class: "pop-foot" });
    this.el = h("div", { class: "popup" + (expanded ? " expanded" : "") + (inline ? " inline" : ""), role: "dialog" }, inline ? null : head, editorEl, inline ? null : this.footer);
    if (inline) {
      // キャンバスの操作(ドラッグ・選択)に取られないように
      for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "wheel"]) this.el.addEventListener(ev, (e) => e.stopPropagation());
      this.el.addEventListener("focusout", (e) => {
        const to = (e as FocusEvent).relatedTarget as Element | null;
        if (to && (this.el.contains(to) || to.closest?.(".backdrop, .ctxmenu, .cv-title"))) return;
        setTimeout(() => {
          const a = document.activeElement;
          if (!this.el.contains(a) && !a?.closest?.(".cv-title") && !document.querySelector(".backdrop, .ctxmenu")) this.close();
        }, 0);
      });
    }
    parent.append(this.el);

    const state = EditorState.create({
      doc: parseMarkdown(n.body),
      plugins: [
        history(),
        markdownInputRules(),
        keymap({
          Backspace: undoInputRule, // 「# 」で見出しになった直後の Backspace で元の文字に戻す
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-Shift-z": redo,
          "Mod-b": toggleMark(schema.marks.strong),
          "Mod-i": toggleMark(schema.marks.em),
          "Mod-l": () => {
            this.makeLink();
            return true;
          },
          "Mod-k": () => {
            this.host.openSearch();
            return true;
          },
          Enter: (st, d, v) => {
            if (cellBelow(st, d, v)) return true;
            const li = st.selection.$from.node(-1);
            const task = li?.type === schema.nodes.list_item && li.attrs.checked != null; // チェックリストの次の項目もチェック付きに
            return (task ? splitListItem(schema.nodes.list_item, { checked: false }) : splitListItem(schema.nodes.list_item))(st, d, v);
          },
          "Mod-Enter": (st, d) => addColRight(st, d), // 表: 右に列を足す
          Tab: (st, d, v) => nextCell(st, d, v) || sinkListItem(schema.nodes.list_item)(st, d, v),
          "Shift-Tab": (st, d, v) => prevCell(st, d, v) || liftListItem(schema.nodes.list_item)(st, d, v),
          "Shift-Enter": (st, dispatch) => {
            dispatch?.(st.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
            return true;
          },
        }),
        keymap(baseKeymap),
        urlCardPlugin(),
        placeholderPlugin(T.bodyPlaceholder),
      ],
    });
    this.view = new EditorView(editorEl, {
      state,
      nodeViews: {
        // チェックリストの項目: 左の □ を押すと、できた/まだ を切り替える
        list_item: (node, view, getPos) => {
          if (node.attrs.checked == null) {
            const plain = h("li"); // ふつうの項目はふつうの描画
            return { dom: plain, contentDOM: plain };
          }
          const box = h("input", { type: "checkbox", class: "task-box", contenteditable: "false" }) as HTMLInputElement;
          box.checked = !!node.attrs.checked;
          const content = h("div", { class: "task-body" });
          const li = h("li", { class: "task" + (node.attrs.checked ? " done" : "") }, box, content);
          box.addEventListener("mousedown", (e) => e.preventDefault());
          box.addEventListener("click", (e) => {
            e.preventDefault();
            const pos = getPos();
            if (pos === undefined) return;
            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
          });
          return { dom: li, contentDOM: content };
        },
        image: (node) => {
          const img = h("img", { src: resolveSrc(node.attrs.src), alt: node.attrs.alt ?? "", title: node.attrs.title ?? undefined });
          return { dom: img };
        },
      },
      dispatchTransaction: (tr) => {
        this.view.updateState(this.view.state.apply(tr));
        if (tr.docChanged) this.scheduleSave();
      },
      handlePaste: (_v, e) => this.attachFiles(e.clipboardData?.files),
      handleDrop: (_v, e) => this.attachFiles((e as DragEvent).dataTransfer?.files),
      handleDOMEvents: {
        keydown: (_v, e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            this.close();
            return true;
          }
          e.stopPropagation();
          return false;
        },
        click: (_v, e) => {
          const a = (e.target as Element).closest("a");
          if (a) this.showLinkBubble(a as HTMLAnchorElement);
          else this.hideBubble();
          return false;
        },
      },
    });
    this.renderFooter();
    this.unsub = v.onChange((ids) => this.onVaultChange(ids));
    if (this.titleInput && !n.title && id !== ROOT_ID) this.titleInput.focus();
    else this.view.focus();
    // 添付で作った(チェックリスト・表だけの)ノードは、最初の項目・セルにカーソルを置く
    const first = this.view.state.doc.firstChild;
    if (first && (first.type === schema.nodes.table || first.type === schema.nodes.bullet_list) && this.view.state.doc.textContent === "") {
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near(this.view.state.doc.resolve(2))));
      if (!this.titleInput?.value) return;
      this.view.focus();
    }
  }

  /** 今の行をチェック項目に(もう項目なら、つけ外し)。右上のボタン */
  private toggleCheck(): void {
    const st = this.view.state;
    const $f = st.selection.$from;
    let d = $f.depth;
    while (d > 0 && $f.node(d).type !== schema.nodes.list_item) d--;
    if (d === 0) {
      // 項目でなければ、箇条書きにしてからチェック付きに
      wrapInList(schema.nodes.bullet_list)(st, this.view.dispatch);
      const $g = this.view.state.selection.$from;
      for (let k = $g.depth; k > 0; k--) {
        if ($g.node(k).type === schema.nodes.list_item) {
          this.view.dispatch(this.view.state.tr.setNodeMarkup($g.before(k), undefined, { ...$g.node(k).attrs, checked: false }));
          break;
        }
      }
    } else {
      const li = $f.node(d);
      this.view.dispatch(st.tr.setNodeMarkup($f.before(d), undefined, { ...li.attrs, checked: li.attrs.checked == null ? false : null }));
    }
    this.view.focus();
  }

  private cmd(c: (s: EditorState, d?: EditorView["dispatch"]) => boolean): void {
    c(this.view.state, this.view.dispatch);
    this.view.focus();
  }

  get expanded(): boolean {
    return this.el.classList.contains("expanded");
  }
  toggleExpand(): void {
    this.el.classList.toggle("expanded");
    const b = this.el.querySelector(".b-expand") as HTMLElement;
    b.title = this.expanded ? T.shrink : T.expand;
    b.querySelector("svg")!.innerHTML = TOOL_ICONS[this.expanded ? "shrink" : "expand"];
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }

  save(): void {
    clearTimeout(this.saveTimer);
    const v = this.host.vault;
    const n = v.get(this.id);
    if (!n) return;
    if (this.titleInput && this.id !== ROOT_ID && this.titleInput.value !== n.title) {
      this.lastTitle = this.titleInput.value;
      v.update(this.id, { title: this.titleInput.value });
    }
    const body = serializeMarkdown(this.view.state.doc);
    if (body !== this.lastSaved && body !== n.body) {
      this.lastSaved = body;
      v.setBody(this.id, body);
    }
  }

  private onVaultChange(ids: Set<string>): void {
    const n = this.host.vault.get(this.id);
    if (!n) {
      this.close(false);
      return;
    }
    if (ids.has(this.id) && n.body !== this.lastSaved && n.body !== serializeMarkdown(this.view.state.doc)) {
      // 外部のエディタで変わった
      this.lastSaved = n.body;
    this.lastTitle = n.title;
      const doc = parseMarkdown(n.body);
      this.view.updateState(EditorState.create({ doc, plugins: this.view.state.plugins }));
    }
    // 題が外から変わったときだけ取り込む(打ちかけの題は消さない)
    if (ids.has(this.id) && this.titleInput && this.id !== ROOT_ID && n.title !== this.lastTitle) {
      this.lastTitle = n.title;
      this.titleInput.value = n.title;
    }
    this.renderFooter();
  }

  private renderFooter(): void {
    const v = this.host.vault;
    const nameOf = (id: string) => (id === ROOT_ID ? T.home : v.get(id)?.title || (v.get(id)?.type === "group" ? T.untitledGroup : T.untitled));
    const chips = (ids: string[], onClick: (id: string) => void) =>
      ids.length
        ? ids.map((id) => {
            const b = h("button", { class: "chip" }, h("span", { class: `ico ico-${v.get(id)?.type === "group" ? "folder" : v.get(id)?.type}` }), nameOf(id));
            b.addEventListener("click", () => {
              this.close();
              onClick(id);
            });
            return b;
          })
        : [h("span", { class: "muted", text: T.none })];
    const parents = v.parentsOf(this.id);
    const back = v.backlinksOf(this.id);
    this.footer.replaceChildren(
      h("div", { class: "bl-row" }, h("span", { class: "bl-label", text: T.belongsTo }), ...chips(parents, (g) => this.host.goToGroup(g, this.id))),
      h("div", { class: "bl-row" }, h("span", { class: "bl-label", text: T.quotedIn }), ...chips(v.quotedBy(this.id), (g) => this.host.goToGroup(g, this.id))),
      h("div", { class: "bl-row" }, h("span", { class: "bl-label", text: T.linkedFrom }), ...chips(back, (s) => this.host.goToNode(s, true))),
    );
  }

  /** Ctrl+L: 検索してリンクをポンと入れる。文章を選んでいればそれをリンクに、無ければ [題](ID.md) を入れる */
  private async makeLink(): Promise<void> {
    const { from, to, empty } = this.view.state.selection;
    const r = await openPicker(this.host.vault, { title: T.pickLinkTitle, mode: "link", exclude: (n) => n.id === this.id });
    this.view.focus();
    if (!r) return;
    const href = "id" in r ? nodeHref(r.id) : r.url;
    const mark = schema.marks.link.create({ href });
    if (empty) {
      const n = "id" in r ? this.host.vault.get(r.id) : null;
      const label = "id" in r ? (r.id === ROOT_ID ? T.home : n?.title || T.untitled) : r.url;
      const tr = this.view.state.tr.insert(from, schema.text(label, [mark]));
      const end = from + label.length;
      this.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end)).removeStoredMark(schema.marks.link));
      return;
    }
    const tr = this.view.state.tr.addMark(from, to, mark);
    this.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, to)));
  }

  /** 添付ボタン: ファイル・チェックリスト・表を入れる(表の中では、行・列の操作も出る) */
  private attachMenu(): void {
    const btn = this.el.querySelector(".b-tableops") as HTMLElement;
    const r = btn.getBoundingClientRect();
    const run = (c: (st: import("prosemirror-state").EditorState, d?: (tr: import("prosemirror-state").Transaction) => void) => boolean) => () => {
      this.view.focus();
      c(this.view.state, this.view.dispatch);
    };
    const items: import("./ui").MenuItem[] = [];
    if (cellAt(this.view.state)) {
      items.push(
        { label: T.tableHead, heading: true },
        { label: T.tableAddRow, action: run(addRowBelow) },
        { label: T.tableAddCol, action: run(addColRight) },
        { label: T.tableDelete, danger: true, action: run(deleteTable) },
      );
    }
    if (items.length) showMenu(r.left, r.bottom + 4, items);
    else toast(T.tableOpsNone);
  }

  /** 貼り付け・落とす・添付ボタン: 画像は本文に絵として、ほかのファイルは「📎 名前」のリンクとして入れる(assets/ に保存) */
  attachFiles(files: FileList | undefined): boolean {
    const list = [...(files ?? [])];
    if (!list.length) return false;
    (async () => {
      for (const f of list) {
        const data = new Uint8Array(await f.arrayBuffer());
        if (f.type.startsWith("image/")) {
          const ext = (f.type.split("/")[1] ?? "png").replace("jpeg", "jpg").replace(/\+.*/, "");
          const rel = await api().saveAsset(ext, data);
          this.view.dispatch(this.view.state.tr.replaceSelectionWith(schema.nodes.image.create({ src: rel, alt: f.name || "" })).scrollIntoView());
        } else {
          const rel = await api().saveAttachment(f.name || "file", data);
          const href = rel.split("/").map(encodeURIComponent).join("/");
          const st = this.view.state;
          const text = schema.text("📎 " + (f.name || "file"), [schema.marks.link.create({ href })]);
          this.view.dispatch(st.tr.replaceSelectionWith(text, false).insertText(" ").scrollIntoView());
        }
      }
    })();
    return true;
  }

  private showLinkBubble(a: HTMLAnchorElement): void {
    this.hideBubble();
    const href = a.getAttribute("href") ?? "";
    const nodeId = hrefToNodeId(href);
    const v = this.host.vault;
    const label = nodeId ? `→ ${nodeId === ROOT_ID ? T.home : v.get(nodeId)?.title || T.untitled}` : `↗ ${href}`;
    const b = h("button", { class: "linkbubble", text: label });
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.hideBubble();
      if (nodeId) {
        if (!v.exists(nodeId)) return;
        this.close();
        this.host.goToNode(nodeId, true);
      } else if (/^assets\//.test(href)) void api().openAsset(href); // 添付は、その種類のふつうのアプリで開く
      else api().openExternal(href);
    });
    const r = a.getBoundingClientRect();
    const pr = this.el.getBoundingClientRect();
    b.style.left = r.left - pr.left + "px";
    b.style.top = r.bottom - pr.top + 4 + "px";
    this.el.append(b);
    this.bubble = b;
  }
  private hideBubble(): void {
    this.bubble?.remove();
    this.bubble = null;
  }

  close(save = true): void {
    if (save) this.save();
    this.unsub();
    this.view.destroy();
    this.el.remove();
    this.host.closedEditor();
  }
}

/** Markdown のように打つと、その形になる(2026-11-23 利用者「# とかが使えない」)。
 * 「# 」〜「###### 」= 見出し、「- 」「* 」= 箇条書き、「1. 」= 番号付き、「> 」= 引用、「```」= コード、「---」= 区切り線 */
function markdownInputRules() {
  const s = schema;
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, s.nodes.heading, (m) => ({ level: m[1].length })),
      wrappingInputRule(/^\s*([-*])\s$/, s.nodes.bullet_list),
      wrappingInputRule(/^(\d+)\.\s$/, s.nodes.ordered_list, (m) => ({ order: +m[1] }), (m, node) => node.childCount + node.attrs.order === +m[1]),
      wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
      textblockTypeInputRule(/^```$/, s.nodes.code_block),
      new InputRule(/^---$/, (state, _m, start, end) => {
        const $s = state.doc.resolve(start);
        if ($s.parent.type !== s.nodes.paragraph) return null;
        return state.tr.replaceRangeWith($s.before(), $s.after(), s.nodes.horizontal_rule.create()).insert($s.before() + 1, s.nodes.paragraph.create());
      }),
    ],
  });
}
