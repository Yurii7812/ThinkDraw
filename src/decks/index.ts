// デッキの登録。デッキごとに「カード定義・意味・スプレッド」を持つ形にしておき、
// 易・発想カードなどを後から足せるようにする(SPEC 7 章。最初の版はタロットのみ)。

import type { SpreadDef } from "../core/spreadLayout";
import tarotCards from "./tarot/cards.json";
import tarotSpreads from "./tarot/spreads.json";

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
    cards: tarotCards as CardDef[],
    spreads: tarotSpreads as SpreadDef[],
    canReverse: true,
    initialBody: "## この位置での読み\n\n\n\n## 自分の解釈\n\n",
  },
};

export function cardDef(deck: string, id: string): CardDef | undefined {
  return DECKS[deck]?.cards.find((c) => c.id === id);
}
export function spreadDef(deck: string, id: string | undefined): SpreadDef | undefined {
  return id ? DECKS[deck]?.spreads.find((s) => s.id === id) : undefined;
}
