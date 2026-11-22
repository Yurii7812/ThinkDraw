// タロット(SPEC 第 7 章): 「引く」の窓と、カードの意味の小さな窓
import { randomInt, newId } from "../core/ids";
import { CARD_H, CARD_W, drawCards, placeFree, placeSpread, type Placement } from "../core/spreadLayout";
import type { Vault } from "../core/vault";
import { cardDef, DECKS, spreadDef } from "../decks";
import { T } from "./strings";
import { h } from "./ui";

export interface DrawOptions {
  spread: string | null; // null = 自由に引く
  count: number;
  reversed: boolean;
}

/** 見えている画面の中心にスプレッドを置く。作ったカードの ID を返す */
export function placeDraw(v: Vault, group: string, center: { x: number; y: number }, o: DrawOptions, deckId = "tarot"): string[] {
  const deck = DECKS[deckId];
  const sp = o.spread ? deck.spreads.find((s) => s.id === o.spread) : undefined;
  const places: Placement[] = sp ? placeSpread(sp, center) : placeFree(Math.max(1, Math.min(deck.cards.length, o.count)), center);
  const cards = drawCards(deck.cards, places.length, randomInt);
  const run = newId(() => false);
  const ids: string[] = [];
  v.tx(() => {
    places.forEach((p, i) => {
      const c = cards[i];
      const n = v.create({
        type: "card",
        title: c.ja,
        body: deck.initialBody,
        group,
        x: p.x,
        y: p.y,
        card: { deck: deckId, id: c.id, reversed: deck.canReverse && o.reversed && randomInt(2) === 1 },
        spread: p.pos ? { run, pos: p.pos.id, spread: sp!.id } : { run },
      });
      ids.push(n.id);
    });
  });
  return ids;
}

export function openDrawDialog(initialReversed: boolean, last: { spread: string | null; count: number }): Promise<DrawOptions | null> {
  return new Promise((resolve) => {
    const deck = DECKS.tarot;
    let chosen: string | null = last.spread ?? deck.spreads[0].id;
    const list = h("div", { class: "spread-list" });
    const count = h("input", { type: "number", min: 1, max: 78, value: String(last.count || 3), class: "count-input" });
    const rows: HTMLElement[] = [];
    const mark = () => rows.forEach((r) => r.classList.toggle("active", (r.dataset.id || null) === chosen));
    const ordered = [...deck.spreads].sort((a, b) => a.pos.length - b.pos.length);
    for (const s of ordered) {
      const r = h("button", { class: "spread-row", "data-id": s.id }, h("span", { class: "sp-name", text: s.name }), h("span", { class: "sp-pos", text: s.pos.map((p) => p.name).join("・") }));
      r.addEventListener("click", () => {
        chosen = s.id;
        mark();
      });
      r.addEventListener("dblclick", () => go());
      rows.push(r);
      list.append(r);
    }
    const free = h("button", { class: "spread-row", "data-id": "" }, h("span", { class: "sp-name", text: T.drawFree }), h("span", { class: "sp-pos" }, T.drawCount + " ", count));
    free.addEventListener("click", () => {
      chosen = null;
      mark();
    });
    count.addEventListener("focus", () => {
      chosen = null;
      mark();
    });
    rows.push(free);
    list.append(free);
    mark();
    const rev = h("input", { type: "checkbox", id: "draw-rev" });
    rev.checked = initialReversed;
    const ok = h("button", { class: "btn primary", text: T.drawGo });
    const cancel = h("button", { class: "btn", text: T.cancel });
    const box = h(
      "div",
      { class: "modal draw" },
      h("div", { class: "modal-title", text: T.drawTitle }),
      list,
      h("div", { class: "row-between" }, h("label", { class: "check", for: "draw-rev" }, rev, T.drawReversed), h("div", { class: "row-end" }, cancel, ok)),
    );
    const back = h("div", { class: "backdrop" }, box);
    const done = (r: DrawOptions | null) => {
      back.remove();
      removeEventListener("keydown", onKey, true);
      resolve(r);
    };
    const go = () => done({ spread: chosen, count: Math.max(1, Math.min(78, Number(count.value) || 1)), reversed: rev.checked });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      } else if (e.key === "Enter" && !e.isComposing) {
        e.stopPropagation();
        e.preventDefault();
        go();
      }
    };
    addEventListener("keydown", onKey, true);
    ok.addEventListener("click", go);
    cancel.addEventListener("click", () => done(null));
    back.addEventListener("mousedown", (e) => e.target === back && done(null));
    document.body.append(back);
    ok.focus();
  });
}

let tip: HTMLElement | null = null;
let tipFor: string | null = null;
let tipTimer: ReturnType<typeof setTimeout> | undefined;

/** カードにカーソルを合わせると、意味を小さな窓で見せる(位置の意味も) */
export function cardTip(v: Vault, id: string | null, e?: MouseEvent): void {
  if (!id) {
    clearTimeout(tipTimer);
    tip?.remove();
    tip = null;
    tipFor = null;
    return;
  }
  if (tipFor === id && tip && e) {
    position(e);
    return;
  }
  clearTimeout(tipTimer);
  tip?.remove();
  tip = null;
  tipFor = id;
  const ev = e;
  tipTimer = setTimeout(() => {
    const n = v.get(id);
    if (!n?.card || tipFor !== id) return;
    const def = cardDef(n.card.deck, n.card.id);
    if (!def) return;
    const rv = n.card.reversed;
    const pos = n.spread?.pos ? spreadDef(n.card.deck, n.spread.spread)?.pos.find((p) => p.id === n.spread!.pos) : undefined;
    tip = h(
      "div",
      { class: "cardtip" },
      h("div", { class: "ct-name", text: `${def.ja}  ${def.en}` }),
      h("div", { class: "ct-orient", text: rv ? T.reversedLabel : T.upright }),
      h("div", { class: "ct-text", text: (rv ? def.rv : def.up) ?? "" }),
      def.kwUp ? h("div", { class: "ct-kw" }, h("b", { text: T.keywords + ": " }), (rv ? def.kwRv : def.kwUp) ?? "") : null,
      def.question ? h("div", { class: "ct-q" }, h("b", { text: T.question + ": " }), def.question) : null,
      pos ? h("div", { class: "ct-pos" }, h("b", { text: `${T.positionMeaning}(${pos.name}): ` }), pos.hint) : null,
      ...(def.facts ?? []).map((f) => h("div", { class: "ct-fact", text: f })),
    );
    document.body.append(tip);
    if (ev) position(ev);
  }, 350);
}
function position(e: MouseEvent): void {
  if (!tip) return;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 16;
  if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

export { CARD_W, CARD_H };
