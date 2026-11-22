// 本文のポップアップ(SPEC 4.3)。見た目で編集し(ProseMirror)、Markdown で保存する。
import { baseKeymap, setBlockType, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { defaultMarkdownParser, defaultMarkdownSerializer, schema } from "prosemirror-markdown";
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
import { api, h } from "./ui";

export interface EditorHost {
  vault: Vault;
  goToGroup(id: string, focusNode?: string): void;
  goToNode(id: string, openBody: boolean): void;
  closedEditor(): void;
  openSearch(): void;
}

export function parseMarkdown(md: string): PMNode {
  return defaultMarkdownParser.parse(md) ?? schema.node("doc", null, [schema.node("paragraph")]);
}
export function serializeMarkdown(doc: PMNode): string {
  const s = defaultMarkdownSerializer.serialize(doc);
  return s ? s + "\n" : "";
}

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

  constructor(private host: EditorHost, id: string, parent: HTMLElement, expanded = false) {
    this.id = id;
    const v = host.vault;
    const n = v.get(id)!;
    this.lastSaved = n.body;
    this.lastTitle = n.title;

    const btn = (label: string, cls: string, fn: () => void) => {
      const b = h("button", { class: "tb " + cls, title: label, "aria-label": label });
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
      btn(T.makeLink, "b-link", () => this.makeLink()),
      h("span", { class: "spacer" }),
      btn(T.expand, "b-expand", () => this.toggleExpand()),
      btn(T.close, "b-close", () => this.close()),
    );
    head.append(tools);

    const editorEl = h("div", { class: "pop-body" });
    this.footer = h("div", { class: "pop-foot" });
    this.el = h("div", { class: "popup" + (expanded ? " expanded" : ""), role: "dialog" }, head, editorEl, this.footer);
    parent.append(this.el);

    const state = EditorState.create({
      doc: parseMarkdown(n.body),
      plugins: [
        history(),
        keymap({
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
          Enter: splitListItem(schema.nodes.list_item),
          Tab: sinkListItem(schema.nodes.list_item),
          "Shift-Tab": liftListItem(schema.nodes.list_item),
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
        image: (node) => {
          const img = h("img", { src: resolveSrc(node.attrs.src), alt: node.attrs.alt ?? "", title: node.attrs.title ?? undefined });
          return { dom: img };
        },
      },
      dispatchTransaction: (tr) => {
        this.view.updateState(this.view.state.apply(tr));
        if (tr.docChanged) this.scheduleSave();
      },
      handlePaste: (_v, e) => this.pasteImage(e.clipboardData?.files),
      handleDrop: (_v, e) => this.pasteImage((e as DragEvent).dataTransfer?.files),
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

  private pasteImage(files: FileList | undefined): boolean {
    const imgs = [...(files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return false;
    (async () => {
      for (const f of imgs) {
        const ext = (f.type.split("/")[1] ?? "png").replace("jpeg", "jpg").replace(/\+.*/, "");
        const rel = await api().saveAsset(ext, new Uint8Array(await f.arrayBuffer()));
        const node = schema.nodes.image.create({ src: rel, alt: "" });
        this.view.dispatch(this.view.state.tr.replaceSelectionWith(node).scrollIntoView());
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
      } else api().openExternal(href);
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
