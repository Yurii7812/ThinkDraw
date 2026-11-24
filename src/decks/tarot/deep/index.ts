// タロットの「絵の中にあるもの(すべて)と象徴の意味・いろいろな意味・たくさんの問い」(2026-11-24)。
// 文はこのアプリのために Claude が書いたもの。絵は同梱の画像(1909 年のライダー版)を 1 枚ずつ見て書き出し、
// 象徴の読みは A. E. Waite『The Pictorial Key to the Tarot』(1910、パブリックドメイン)と広く知られた読み方を元に自分の言葉で書いた。
import major1 from "./major1.json";
import major2 from "./major2.json";
import major3 from "./major3.json";
import major4 from "./major4.json";
import major5 from "./major5.json";
import major6 from "./major6.json";
import wands1 from "./wands1.json";
import wands2 from "./wands2.json";
import wands3 from "./wands3.json";
import cups1 from "./cups1.json";
import cups2 from "./cups2.json";
import cups3 from "./cups3.json";
import swords1 from "./swords1.json";
import swords2 from "./swords2.json";
import swords3 from "./swords3.json";
import pents1 from "./pents1.json";
import pents2 from "./pents2.json";
import pents3 from "./pents3.json";

export interface DeepCard {
  /** 絵の中にあるもの: [名前, 象徴の意味] */
  items: [string, string][];
  /** 正位置のいろいろな意味(「全体: …」のように見出し付きのものもある) */
  up: string[];
  /** 逆位置のいろいろな意味 */
  rv: string[];
  questions: string[];
}

export const TAROT_DEEP: Record<string, DeepCard> = Object.assign(
  {},
  major1, major2, major3, major4, major5, major6,
  wands1, wands2, wands3, cups1, cups2, cups3,
  swords1, swords2, swords3, pents1, pents2, pents3,
) as Record<string, DeepCard>;
