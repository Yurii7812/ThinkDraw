// 引く(画面に依存しない部分): タロットの山札から配る・易の卦を立てる・発想カードを引く
import { DECKS, type CardDef } from ".";
import { castHexagram } from "./iching";
import { PROMPT_ITEMS, type PromptItem } from "./prompts";
import { fullShuffle, riffleShuffle, type Pool, type Rand, type Shuffle } from "./rng";

export interface DrawSettings {
  reversed: boolean; // 逆位置を入れる(出る確率は 1/2)
  pool: Pool;
  shuffle: Shuffle;
  riffles: number;
  promptSets: string[]; // 発想カードの「1 枚」で使う種類
}
export const DEFAULT_DRAW: DrawSettings = { reversed: false, pool: "all", shuffle: "full", riffles: 7, promptSets: ["w5h1", "scamper", "hats", "roles", "next", "ask"] };

export function tarotPool(pool: Pool): CardDef[] {
  const all = DECKS.tarot.cards;
  return pool === "major" ? all.filter((c) => c.major) : pool === "minor" ? all.filter((c) => !c.major) : all;
}

/** 山札を混ぜて、上から n 枚 */
export function drawTarot(n: number, s: DrawSettings, rand: Rand): { def: CardDef; reversed: boolean }[] {
  const pool = tarotPool(s.pool);
  const deck = s.shuffle === "riffle" ? riffleShuffle(pool, Math.max(1, s.riffles), rand) : fullShuffle(pool, rand);
  return deck.slice(0, Math.min(n, deck.length)).map((def) => ({ def, reversed: s.reversed && rand(2) === 1 }));
}

export function drawIching(rand: Rand) {
  return castHexagram(rand);
}

export function drawPrompt(sets: string[], rand: Rand): PromptItem {
  const pool = PROMPT_ITEMS.filter((p) => sets.includes(p.set));
  const from = pool.length ? pool : PROMPT_ITEMS;
  return from[rand(from.length)];
}
