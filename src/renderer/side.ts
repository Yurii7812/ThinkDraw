// 右の欄(2026-11-22 利用者の希望): 「詳細|グラフ」の切り替え。
// カードを選ぶと、カードの解説(この位置での読み・絵の中にあるもの・問い)を、スクロールしなくても見える密度で出す。
import { ROOT_ID, type TDNode } from "../core/types";
import type { Vault } from "../core/vault";
import { cardDef, spreadDef } from "../decks";
import { HEX_BY_ID, LINE_POS } from "../decks/iching";
import { PROMPT_BY_ID, PROMPT_SETS } from "../decks/prompts";
import { cardFace, hexSvg } from "./cardface";
import { GraphPanel, type GraphHost } from "./graph";
import { T } from "./strings";
import { h } from "./ui";

export type SideTab = "map" | "rel" | "detail" | "graph";

export interface SideHost extends GraphHost {
  selection(): string[];
  /** from につながった文字を置く(edit なら書き始める) */
  addConnected(from: string, text: string, edit: boolean): void;
  select(id: string): void;
  openBody(id: string): void;
  openNode(id: string): void;
  bundleSelection(): void;
  onTabChange(t: SideTab): void;
}

export class SidePanel {
  readonly el: HTMLElement;
  readonly graph: GraphPanel;
  tab: SideTab = "map";
  private detailEl: HTMLElement;
  private mapEl: HTMLElement;
  private mapList: HTMLElement;
  private mapInput: HTMLInputElement;
  private relEl: HTMLElement;
  private tabsEl: HTMLElement;
  private expanded = new Set<string>(); // 地図で開いている行(根からの道を鍵にする。同じ物が 2 か所に出ても別々に開く)
  private mapAll = false;
  private query = "";
  private lastGroup = "";

  constructor(private host: SideHost, parent: HTMLElement) {
    this.tabsEl = h("div", { class: "seg side-tabs" });
    for (const [t, label] of [["map", T.sideMap], ["rel", T.sideRel], ["detail", T.sideDetail], ["graph", T.graph]] as const) {
      const b = h("button", { class: "seg-b", "data-tab": t, text: label });
      b.addEventListener("click", () => this.setTab(t));
      this.tabsEl.append(b);
    }
    this.detailEl = h("div", { class: "detail" });
    this.mapInput = h("input", { class: "map-filter", type: "search", placeholder: T.mapFilter }) as HTMLInputElement;
    this.mapInput.addEventListener("input", () => {
      this.query = this.mapInput.value.trim();
      this.renderMapList();
    });
    const allBox = h("input", { type: "checkbox" }) as HTMLInputElement;
    allBox.addEventListener("change", () => {
      this.mapAll = allBox.checked;
      this.renderMapList();
    });
    this.mapList = h("div", { class: "map-list" });
    this.mapEl = h("div", { class: "map" }, h("div", { class: "map-head" }, this.mapInput, h("label", { class: "map-all" }, allBox, T.mapShowAll)), this.mapList);
    this.relEl = h("div", { class: "rel" });
    const graphWrap = h("div", { class: "graph-wrap" });
    this.el = h("aside", { class: "side-panel" }, h("div", { class: "side-head" }, this.tabsEl), this.detailEl, this.mapEl, this.relEl, graphWrap);
    parent.append(this.el);
    this.graph = new GraphPanel(host, graphWrap);
  }

  private get v(): Vault {
    return this.host.vault;
  }

  setTab(t: SideTab, notify = true): void {
    this.tab = t;
    this.el.dataset.tab = t;
    for (const b of this.tabsEl.querySelectorAll<HTMLElement>(".seg-b")) b.classList.toggle("active", b.dataset.tab === t);
    if (notify) this.host.onTabChange(t);
    this.render();
  }

  render(): void {
    if (this.el.offsetParent === null) return;
    if (this.tab === "graph") {
      this.graph.render();
      return;
    }
    if (this.tab === "map") return this.renderMap();
    if (this.tab === "rel") return this.renderRel();
    const ids = this.host.selection().filter((i) => this.v.exists(i));
    let parts: (HTMLElement | null)[];
    if (ids.length > 1) parts = this.multi(ids);
    else if (ids.length === 1) {
      const n = this.v.get(ids[0])!;
      parts = n.type === "card" && n.card ? this.cardDetail(n) : this.nodeDetail(n);
    } else parts = [h("div", { class: "d-empty", text: T.sideEmpty })];
    this.detailEl.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  }

  // ---------- 地図(入れ子の一覧) ----------
  private nodeIcon(id: string): HTMLElement {
    const t = id === ROOT_ID ? "folder" : this.v.get(id)?.type === "group" ? "folder" : this.v.get(id)?.type;
    return h("span", { class: `ico ico-${t}` });
  }
  /** 地図に出すか(文字・カードは、スイッチを入れたときだけ) */
  private mapVisible(id: string): boolean {
    const t = this.v.get(id)?.type;
    return t === "group" || t === "note" || (this.mapAll && !!t);
  }
  private visibleKids(group: string): { id: string; ref: boolean }[] {
    return this.v
      .itemsOf(group)
      .filter((i) => this.v.exists(i.id) && this.mapVisible(i.id))
      .map((i) => ({ id: i.id, ref: i.ref }))
      .sort((a, b) => {
        const ga = this.v.get(a.id)!.type === "group" ? 0 : 1, gb = this.v.get(b.id)!.type === "group" ? 0 : 1;
        return ga - gb || this.nameOf(a.id).localeCompare(this.nameOf(b.id), "ja");
      });
  }
  /** いま開いているグループまでの道(最初の親をたどる)を開いておく */
  private expandToCurrent(): void {
    const cur = this.host.currentGroup();
    if (cur === this.lastGroup) return;
    this.lastGroup = cur;
    const chain: string[] = [];
    const seen = new Set<string>();
    for (let id = cur; id && id !== ROOT_ID && !seen.has(id); id = this.v.parentsOf(id)[0]) {
      seen.add(id);
      chain.unshift(id);
    }
    let key = "r";
    this.expanded.add(key);
    for (const id of chain) {
      key += "/" + id;
      this.expanded.add(key);
    }
  }
  private go(id: string): void {
    if (id === ROOT_ID || this.v.get(id)?.type === "group") this.host.openGroup(id);
    else this.host.goToNode(id);
  }
  private renderMap(): void {
    this.expandToCurrent();
    this.renderMapList();
  }
  private renderMapList(): void {
    const rows: HTMLElement[] = [];
    const cur = this.host.currentGroup();
    const sel = this.host.selectedNode();
    const mark = (id: string, el: HTMLElement) => {
      if (id === cur) el.classList.add("cur");
      if (id === sel) el.classList.add("sel");
      return el;
    };
    if (this.query) {
      const q = this.query.toLowerCase();
      const hits = [...this.v.nodes.values()]
        .filter((n) => n.id !== ROOT_ID && this.mapVisible(n.id) && this.nameOf(n.id).toLowerCase().includes(q))
        .sort((a, b) => this.nameOf(a.id).localeCompare(this.nameOf(b.id), "ja"))
        .slice(0, 100);
      for (const n of hits) {
        const parents = this.v.parentsOf(n.id).map((p) => this.nameOf(p));
        const row = h("div", { class: "tr", "data-id": n.id }, this.nodeIcon(n.id), h("span", { class: "tr-name", text: this.nameOf(n.id) }), parents.length ? h("span", { class: "tr-sub", text: T.mapParents(parents.join("、")) }) : null);
        row.addEventListener("click", () => this.go(n.id));
        rows.push(mark(n.id, row));
      }
      if (!hits.length) rows.push(h("div", { class: "d-empty", text: T.mapNoHit }));
      this.mapList.replaceChildren(...rows);
      return;
    }
    const toggle = (key: string) => {
      if (this.expanded.has(key)) this.expanded.delete(key);
      else this.expanded.add(key);
      this.renderMapList();
    };
    const addRow = (id: string, key: string, depth: number, ref: boolean, path: Set<string>) => {
      const n = id === ROOT_ID ? null : this.v.get(id);
      const isGroup = id === ROOT_ID || n?.type === "group";
      const kids = isGroup && !path.has(id) ? this.visibleKids(id) : [];
      const open = this.expanded.has(key);
      const chev = h("button", { class: "tr-chev" + (kids.length ? "" : " none"), text: kids.length ? (open ? "▾" : "▸") : "" });
      if (kids.length) chev.addEventListener("click", (e) => { e.stopPropagation(); toggle(key); });
      const others = id === ROOT_ID || ref ? 0 : this.v.parentsOf(id).length - 1;
      const row = h(
        "div",
        { class: "tr" + (ref ? " ref" : ""), "data-id": id, style: `padding-left:${6 + depth * 14}px` },
        chev,
        this.nodeIcon(id),
        h("span", { class: "tr-name", text: this.nameOf(id) }),
        ref ? h("span", { class: "tr-sub", text: T.mapQuoted }) : others > 0 ? h("span", { class: "tr-sub", text: T.mapOthers(others) }) : null,
      );
      row.addEventListener("click", () => this.go(id));
      rows.push(mark(id, row));
      if (open && kids.length) {
        const next = new Set(path).add(id);
        for (const k of kids) addRow(k.id, key + "/" + k.id + (k.ref ? "~" : ""), depth + 1, k.ref, next);
      }
    };
    addRow(ROOT_ID, "r", 0, false, new Set());
    this.mapList.replaceChildren(...rows);
    const curRow = this.mapList.querySelector(".tr.cur");
    curRow?.scrollIntoView({ block: "nearest" });
  }

  // ---------- 関係(所属先・引用・リンク元・リンク先。押すと移る) ----------
  private renderRel(): void {
    const sel = this.host.selectedNode();
    const target = sel && this.v.exists(sel) ? sel : this.host.currentGroup();
    const n = target === ROOT_ID ? null : this.v.get(target);
    const head = h(
      "div",
      { class: "rel-head" },
      h("div", { class: "d-kind", text: sel && this.v.exists(sel) ? T.relSelected : T.relCurrent }),
      h("div", { class: "rel-title" }, this.nodeIcon(target), h("span", { text: this.nameOf(target) })),
    );
    const row = (id: string, sub: string, onClick: () => void) => {
      const r = h("div", { class: "rel-item" }, this.nodeIcon(id), h("span", { class: "tr-name", text: this.nameOf(id) }), sub ? h("span", { class: "tr-sub", text: sub }) : null);
      r.addEventListener("click", onClick);
      return r;
    };
    const sec = (title: string, items: HTMLElement[]) =>
      h("div", { class: "rel-sec" }, h("div", { class: "d-h", text: `${title} ${items.length}` }), ...(items.length ? items : [h("div", { class: "muted rel-none", text: T.none })]));
    const parents = this.v.parentsOf(target).filter((i) => this.v.exists(i));
    const quoted = this.v.quotedBy(target).filter((i) => this.v.exists(i));
    const linksIn = this.v.backlinksOf(target).filter((i) => this.v.exists(i));
    const linksOut = (n?.links ?? []).filter((l) => this.v.exists(l.to));
    const kindName = (k: string) => T.kinds[k] ?? "";
    this.relEl.replaceChildren(
      head,
      sec(T.belongsTo, parents.map((g) => row(g, "", () => this.host.openGroup(g)))),
      sec(T.relQuotedIn, quoted.map((g) => row(g, "", () => this.host.openGroup(g)))),
      sec(T.relIn, linksIn.map((i) => row(i, "", () => this.host.goToNode(i)))),
      sec(T.relOut, linksOut.map((l) => row(l.to, kindName(l.kind), () => this.host.goToNode(l.to)))),
      h("div", { class: "muted rel-hint", text: T.relHint }),
    );
  }

  // ---------- 部品 ----------
  private chip(text: string, onClick: () => void, cls = ""): HTMLElement {
    const b = h("button", { class: "chip " + cls, text, title: text });
    b.addEventListener("click", onClick);
    return b;
  }
  private section(title: string, ...kids: (Node | string | null)[]): HTMLElement {
    return h("div", { class: "d-sec" }, h("div", { class: "d-h", text: title }), ...kids);
  }
  private nameOf(id: string): string {
    const n = this.v.get(id);
    return id === ROOT_ID ? T.home : n?.title || (n?.type === "group" ? T.untitledGroup : T.untitled);
  }
  private nodeChips(ids: string[], onClick: (id: string) => void): HTMLElement {
    const row = h("div", { class: "chips" });
    if (!ids.length) row.append(h("span", { class: "muted", text: T.none }));
    for (const id of ids) {
      const t = this.v.get(id)?.type;
      const b = h("button", { class: "chip" }, h("span", { class: `ico ico-${t === "group" ? "folder" : t}` }), this.nameOf(id));
      b.addEventListener("click", () => onClick(id));
      row.append(b);
    }
    return row;
  }
  /** 所属先・引用先・リンク元・つながり */
  private relations(n: TDNode): HTMLElement[] {
    const linked = [...new Set([...n.links.map((l) => l.to), ...this.v.backlinksOf(n.id)])].filter((i) => this.v.exists(i));
    return [
      h("div", { class: "d-rel" },
        h("div", { class: "rel-row" }, h("span", { class: "rel-l", text: T.belongsTo }), this.nodeChips(this.v.parentsOf(n.id), (g) => this.host.openGroup(g))),
        h("div", { class: "rel-row" }, h("span", { class: "rel-l", text: T.quotedIn }), this.nodeChips(this.v.quotedBy(n.id), (g) => this.host.openGroup(g))),
        h("div", { class: "rel-row" }, h("span", { class: "rel-l", text: T.connections }), this.nodeChips(linked, (i) => this.host.goToNode(i))),
      ),
    ];
  }

  // ---------- 文字・ノート・グループ ----------
  private nodeDetail(n: TDNode): HTMLElement[] {
    const kind = n.type === "group" ? T.kindGroup : n.type === "note" ? T.kindNote : T.kindText;
    const open = h("button", { class: "btn small", text: n.type === "group" ? T.openGroup : n.type === "text" ? T.editText : T.openNote });
    open.addEventListener("click", () => this.host.openNode(n.id));
    const plus = h("button", { class: "btn small", text: T.plusIdea });
    plus.addEventListener("click", () => this.host.addConnected(n.id, "", true));
    const excerpt = n.body.replace(/\s+/g, " ").trim();
    return [
      h("div", { class: "d-kind", text: kind }),
      h("div", { class: "d-title", text: this.nameOf(n.id) }),
      excerpt ? h("div", { class: "d-excerpt", text: excerpt.slice(0, 280) }) : null,
      h("div", { class: "d-btns" }, open, n.type !== "group" ? plus : null),
      ...this.relations(n),
    ].filter((x): x is HTMLElement => !!x);
  }

  private multi(ids: string[]): HTMLElement[] {
    const b = h("button", { class: "btn small", text: T.bundle });
    b.addEventListener("click", () => this.host.bundleSelection());
    return [h("div", { class: "d-title", text: T.selectedCount(ids.length) }), h("div", { class: "d-btns" }, b), this.nodeChips(ids, (i) => this.host.select(i))];
  }

  // ---------- カード ----------
  private cardDetail(n: TDNode): HTMLElement[] {
    const c = n.card!;
    if (c.deck === "iching") return this.ichingDetail(n);
    if (c.deck === "prompt") return this.promptDetail(n);
    const def = cardDef(c.deck, c.id);
    if (!def) return this.nodeDetail(n);
    const rv = c.reversed;
    const pos = n.spread?.pos ? spreadDef(c.deck, n.spread.spread)?.pos.find((p) => p.id === n.spread!.pos) : undefined;
    const orient = rv ? T.reversedLabel : T.upright;
    const head = h(
      "div",
      { class: "d-card-head" },
      h("div", { class: "d-face" }, cardFace(c, 150)),
      h(
        "div",
        { class: "d-meta" },
        h("div", { class: "d-title" }, def.ja, h("small", { text: " " + def.en })),
        h("span", { class: "badge" + (rv ? " rev" : ""), text: orient }),
        pos ? h("div", { class: "d-pos" }, h("b", { text: pos.name }), " — " + pos.hint) : null,
        h("div", { class: "d-kw" }, h("b", { text: T.keywords + " " }), (rv ? def.kwRv : def.kwUp) ?? ""),
        h("div", { class: "d-facts", text: (def.facts ?? []).join(" / ") }),
      ),
    );
    // この位置での読み: 位置の意味とカードの意味を組み合わせて読む手がかり
    const reading = pos
      ? `「${pos.name}」(${pos.hint})に、${def.ja}の${orient}。${(rv ? def.rv : def.up) ?? ""}`
      : `${def.ja}の${orient}。${(rv ? def.rv : def.up) ?? ""}`;
    const other = h("div", { class: "d-other" }, h("b", { text: (rv ? T.upright : T.reversedLabel) + "なら: " }), (rv ? def.up : def.rv) ?? "");
    const dp = def.deep;
    if (!dp) {
      const scene = h("div", { class: "chips" });
      for (const s of def.scene ?? []) scene.append(this.chip(s, () => this.host.addConnected(n.id, s, true)));
      return [
        head,
        this.section(T.readingHere, h("div", { class: "d-reading", text: reading }), other),
        this.section(T.sceneTitle, scene),
        def.question ? this.section(T.question, this.chip(def.question, () => this.host.addConnected(n.id, def.question!, false), "ask")) : null,
        ...this.relations(n),
      ].filter((x): x is HTMLElement => !!x);
    }
    // 2026-11-24(利用者「絵の中にあるものも象徴も全部・意味もいろいろ・問いをたくさん」)
    const meaningList = (list: string[]) =>
      h("ul", { class: "d-meanings" }, ...list.map((m) => {
        const i = m.indexOf(": ");
        return i > 0 && i < 8 ? h("li", {}, h("b", { text: m.slice(0, i) }), " " + m.slice(i + 2)) : h("li", { text: m });
      }));
    const otherList = h("details", { class: "d-other-list" }, h("summary", { text: (rv ? T.upright : T.reversedLabel) + T.ifOther }), meaningList(rv ? dp.up : dp.rv));
    // 絵の中のもの: 名前と象徴の意味を 1 行ずつ。押すと「名前: 」をつないで書き始める
    const items = h("div", { class: "d-items" });
    for (const [name, mean] of dp.items) {
      const row = h("button", { class: "d-item", title: T.itemTip }, h("span", { class: "d-item-n", text: name }), h("span", { class: "d-item-m", text: mean }));
      row.addEventListener("click", () => this.host.addConnected(n.id, name + ": ", true));
      items.append(row);
    }
    const qs = h("div", { class: "chips d-qs" });
    for (const q of [...(def.question ? [def.question] : []), ...dp.questions.filter((x) => x !== def.question)])
      qs.append(this.chip(q, () => this.host.addConnected(n.id, q, false), "ask"));
    return [
      head,
      this.section(T.readingHere, h("div", { class: "d-reading", text: reading })),
      this.section(rv ? T.meaningsRv : T.meaningsUp, meaningList(rv ? dp.rv : dp.up), otherList),
      this.section(T.itemsTitle(dp.items.length), items),
      this.section(T.questionsTitle(qs.childElementCount), qs),
      ...this.relations(n),
    ].filter((x): x is HTMLElement => !!x);
  }

  private ichingDetail(n: TDNode): HTMLElement[] {
    const c = n.card!;
    const hx = HEX_BY_ID[c.id];
    if (!hx) return this.nodeDetail(n);
    // 本卦か之卦か: 之卦なら、これに矢印を引いている本卦を探す
    const baseId = c.moving?.length ? n.id : this.v.backlinksOf(n.id).find((s) => this.v.get(s)?.card?.deck === "iching" && this.v.get(s)?.card?.moving?.length);
    const base = baseId ? this.v.get(baseId)! : n;
    const bh = HEX_BY_ID[base.card!.id];
    const mv = base.card!.moving ?? [];
    const afterId = base.links.map((l) => l.to).find((t) => this.v.get(t)?.card?.deck === "iching");
    const ah = afterId ? HEX_BY_ID[this.v.get(afterId)!.card!.id] : null;
    const tri = (x: typeof hx) => `上 ${x.upper.glyph}${x.upper.nature}(${x.upper.kw})/下 ${x.lower.glyph}${x.lower.nature}(${x.lower.kw})`;
    const step = (no: string, head: string, body: string, on: boolean) =>
      h("div", { class: "ic-step" + (on ? " on" : "") }, h("i", { text: no }), h("div", {}, h("b", { text: head }), h("div", { class: "kt", text: body })));
    return [
      h("div", { class: "d-card-head" }, h("div", { class: "d-face hex" }, hexSvg(hx.lines, c.moving ?? [], 80)), h("div", { class: "d-meta" },
        h("div", { class: "d-title" }, `第${hx.num}卦 ${hx.name}`),
        h("span", { class: "badge", text: base === n ? T.ichingBase : T.ichingAfter }),
        h("div", { class: "d-kw" }, h("b", { text: T.keywords + " " }), hx.kw),
        h("div", { class: "d-facts", text: tri(hx) }))),
      this.section(T.ichingHowTo,
        step("1", `${T.ichingNow}: 第${bh.num}卦 ${bh.name} — ${bh.kw}`, bh.text, base === n),
        step("2", mv.length ? `${T.ichingMoving}: ${mv.map((i) => LINE_POS[i].split("(")[0]).join("・")}` : `${T.ichingMoving}: なし`, mv.length ? mv.map((i) => LINE_POS[i]).join("、") + "。" + T.ichingMovingHint : T.ichingNoMoving, false),
        ah ? step("3", `${T.ichingWhere}: 第${ah.num}卦 ${ah.name} — ${ah.kw}`, ah.text, base !== n) : null),
      this.section(T.question, this.chip(hx.question, () => this.host.addConnected(n.id, hx.question, false), "ask"),
        h("div", { class: "chips" }, this.chip(`${hx.upper.nature}から連想する`, () => this.host.addConnected(n.id, hx.upper.nature, true)), this.chip(`${hx.lower.nature}から連想する`, () => this.host.addConnected(n.id, hx.lower.nature, true)))),
      ...this.relations(n),
    ];
  }

  private promptDetail(n: TDNode): HTMLElement[] {
    const p = PROMPT_BY_ID[n.card!.id];
    if (!p) return this.nodeDetail(n);
    const set = PROMPT_SETS.find((s) => s.id === p.set)!;
    return [
      h("div", { class: "d-card-head" }, h("div", { class: "d-face" }, cardFace(n.card!, 110)), h("div", { class: "d-meta" },
        h("div", { class: "d-title", text: p.name }),
        h("span", { class: "badge", text: p.setName }),
        h("div", { class: "d-facts", text: set.desc }))),
      this.section(T.question, this.chip(p.question, () => this.host.addConnected(n.id, p.question, false), "ask")),
      ...this.relations(n),
    ];
  }
}
