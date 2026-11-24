// デッキの登録。デッキごとに「カード定義・意味・スプレッド」を持つ形にしておき、
// 易・発想カードなどを後から足せるようにする(SPEC 7 章。最初の版はタロットのみ)。

import type { SpreadDef } from "../core/spreadLayout";
import tarotCards from "./tarot/cards.json";
import tarotSpreads from "./tarot/spreads.json";
import { TAROT_DEEP, type DeepCard } from "./tarot/deep";

export interface CardDef {
  id: string;
  ja: string;
  en: string;
  file: string; // 画像のファイル名(assets/decks/<deck>/ の中)
  major?: boolean;
  kwUp?: string;
  kwRv?: string;
  up?: string;
  rv?: string;
  scene?: string[];
  question?: string;
  facts?: string[];
  /** 2026-11-24: 絵の中のもの全部と象徴・いろいろな意味・たくさんの問い(タロットだけ) */
  deep?: DeepCard;
}

export interface Deck {
  id: string;
  name: string;
  cards: CardDef[];
  spreads: SpreadDef[];
  /** 逆位置を持つデッキか */
  canReverse: boolean;
  /** カードの本文の初期の見出し */
  initialBody: string;
}

export const DECKS: Record<string, Deck> = {
  tarot: {
    id: "tarot",
    name: "タロット",
    cards: (tarotCards as CardDef[]).map((c) => ({ ...c, deep: TAROT_DEEP[c.id] })),
    spreads: tarotSpreads as SpreadDef[],
    canReverse: true,
    // 2026-11-22 利用者の希望: 解釈はブレストの文字で書くので、カードの本文に初期の見出しは入れない
    initialBody: "",
  },
};

export function cardDef(deck: string, id: string): CardDef | undefined {
  return DECKS[deck]?.cards.find((c) => c.id === id);
}
export function spreadDef(deck: string, id: string | undefined): SpreadDef | undefined {
  return id ? DECKS[deck]?.spreads.find((s) => s.id === id) : undefined;
}

import { HEX_BY_ID } from "./iching";
import { PROMPT_BY_ID } from "./prompts";
import type { CardRef } from "../core/types";

/** どのデッキのカードでも、表示する名前 */
export function cardName(c: CardRef): string {
  if (c.deck === "iching") {
    const h = HEX_BY_ID[c.id];
    return h ? `第${h.num}卦 ${h.name}` : c.id;
  }
  if (c.deck === "prompt") return PROMPT_BY_ID[c.id]?.name ?? c.id;
  return (cardDef(c.deck, c.id)?.ja ?? c.id) + (c.reversed ? "(逆位置)" : "");
}
