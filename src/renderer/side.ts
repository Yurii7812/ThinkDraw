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

export type SideTab = "detail" | "graph";

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
  tab: SideTab = "detail";
  private detailEl: HTMLElement;
  private tabsEl: HTMLElement;

  constructor(private host: SideHost, parent: HTMLElement) {
    this.tabsEl = h("div", { class: "seg side-tabs" });
    for (const [t, label] of [["detail", T.sideDetail], ["graph", T.graph]] as const) {
      const b = h("button", { class: "seg-b", "data-tab": t, text: label });
      b.addEventListener("click", () => this.setTab(t));
      this.tabsEl.append(b);
    }
    this.detailEl = h("div", { class: "detail" });
    const graphWrap = h("div", { class: "graph-wrap" });
    this.el = h("aside", { class: "side-panel" }, h("div", { class: "side-head" }, this.tabsEl), this.detailEl, graphWrap);
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
    const ids = this.host.selection().filter((i) => this.v.exists(i));
    let parts: (HTMLElement | null)[];
    if (ids.length > 1) parts = this.multi(ids);
    else if (ids.length === 1) {
      const n = this.v.get(ids[0])!;
      parts = n.type === "card" && n.card ? this.cardDetail(n) : this.nodeDetail(n);
    } else parts = [h("div", { class: "d-empty", text: T.sideEmpty })];
    this.detailEl.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
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
    const open = h("button", { class: "btn small", text: n.type === "group" ? T.openGroup : n.type === "text" ? T.editText : T.openBody });
    open.addEventListener("click", () => this.host.openNode(n.id));
    const body = h("button", { class: "btn small", text: T.openBody });
    body.addEventListener("click", () => this.host.openBody(n.id));
    const plus = h("button", { class: "btn small", text: T.plusIdea });
    plus.addEventListener("click", () => this.host.addConnected(n.id, "", true));
    const excerpt = n.body.replace(/\s+/g, " ").trim();
    return [
      h("div", { class: "d-kind", text: kind }),
      h("div", { class: "d-title", text: this.nameOf(n.id) }),
      excerpt ? h("div", { class: "d-excerpt", text: excerpt.slice(0, 280) }) : null,
      h("div", { class: "d-btns" }, open, n.type !== "note" ? body : null, n.type !== "group" ? plus : null),
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
