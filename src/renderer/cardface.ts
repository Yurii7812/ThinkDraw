// カードの絵(タロットの画像・易の卦・発想カード)。キャンバス・右の欄・引くメニューで同じものを使う
import type { CardRef } from "../core/types";
import { cardDef } from "../decks";
import { HEX_BY_ID } from "../decks/iching";
import { PROMPT_BY_ID } from "../decks/prompts";
import { h, svg } from "./ui";

export const cardImageUrl = (deck: string, file: string) => `../../assets/decks/${deck}/${file}`;

/** 易の卦の線(下から 6 本)。変わる爻は赤い印 */
export function hexSvg(lines: number[], moving: number[] = [], w = 90): SVGSVGElement {
  const H = 100;
  const s = svg("svg", { class: "hexsvg", viewBox: `0 0 100 ${H}`, width: w, height: (w * H) / 100 });
  for (let i = 0; i < 6; i++) {
    const y = H - 12 - i * 15.5;
    if (lines[i]) s.append(svg("rect", { x: 10, y, width: 80, height: 9, rx: 1.5 }));
    else s.append(svg("rect", { x: 10, y, width: 35, height: 9, rx: 1.5 }), svg("rect", { x: 55, y, width: 35, height: 9, rx: 1.5 }));
    if (moving.includes(i)) s.append(svg("circle", { cx: 96, cy: y + 4.5, r: 3.4, class: "mv" }));
  }
  return s;
}

/** カードの絵の部分。tarot は画像、ほかは描く */
export function cardFace(c: CardRef, height: number): HTMLElement {
  if (c.deck === "iching") {
    const hx = HEX_BY_ID[c.id];
    return h(
      "div",
      { class: "face hexface", style: `height:${height}px` },
      h("div", { class: "hf-num", text: hx ? `第${hx.num}卦` : "" }),
      hx ? hexSvg(hx.lines, c.moving ?? [], 70) : null,
      h("div", { class: "hf-name", text: hx ? hx.name : c.id }),
    );
  }
  if (c.deck === "prompt") {
    const p = PROMPT_BY_ID[c.id];
    return h(
      "div",
      { class: `face pface c${p?.color ?? 0}`, style: `height:${height}px` },
      h("div", { class: "pf-set", text: p?.setName ?? "" }),
      h("div", { class: "pf-name", text: p?.name ?? c.id }),
    );
  }
  const def = cardDef(c.deck, c.id);
  const img = h("img", { src: def ? cardImageUrl(c.deck, def.file) : "", alt: def?.ja ?? "", draggable: "false" });
  if (c.reversed) img.classList.add("reversed");
  return h("div", { class: "face cardimg", style: `height:${height}px` }, img);
}

/** デッキごとのカードの高さ(幅は CARD_W) */
export function faceHeight(deck: string, tarotH: number): number {
  return deck === "tarot" ? tarotH : Math.round(tarotH * 0.72);
}
