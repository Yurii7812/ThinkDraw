// 引くときの乱数の元と、混ぜ方(2026-11-22 利用者の希望で、SPEC 11 章の仮置き「入れない」から変更)

import { randomInt } from "../core/ids";

export type RngMethod = "crypto" | "word" | "time";
export const RNG_METHODS: [RngMethod, string, string][] = [
  ["crypto", "おまかせ", "OS の暗号乱数。毎回まったく別の結果"],
  ["word", "言葉から", "同じ言葉なら同じ結果(やり直せる)"],
  ["time", "時刻", "押した瞬間のミリ秒を元にする"],
];
export type Shuffle = "full" | "riffle";
export type Pool = "all" | "major" | "minor";

/** [0, max) の整数を返す関数 */
export type Rand = (max: number) => number;

/** 文字列から 32 ビットの種を 4 つ作る(cyrb128) */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** 種から決まる乱数(sfc32) */
export function seededRand(seed: string): Rand {
  let [a, b, c, d] = cyrb128(seed);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  return (max) => Math.floor(next() * max);
}

export function makeRand(method: RngMethod, seedText: string): Rand {
  if (method === "word") return seededRand(seedText || "");
  if (method === "time") return seededRand(String(Date.now()) + ":" + String(performance.now()));
  return randomInt;
}

/** 完全に混ぜる(フィッシャー–イェーツ) */
export function fullShuffle<T>(a: T[], rand: Rand): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** リフル(2 つに分けて、残りの枚数に比例した確率で交互に落とす)を n 回のあと、カット 1 回。手で切るのに近い */
export function riffleShuffle<T>(a: T[], times: number, rand: Rand): T[] {
  let deck = [...a];
  for (let t = 0; t < times; t++) {
    // 真ん中あたりで分ける(二項分布に近い: コインを枚数ぶん投げる)
    let cut = 0;
    for (let i = 0; i < deck.length; i++) cut += rand(2);
    const left = deck.slice(0, cut), right = deck.slice(cut);
    const out: T[] = [];
    while (left.length || right.length) {
      const pickLeft = rand(left.length + right.length) < left.length;
      out.push((pickLeft ? left : right).shift()!);
    }
    deck = out;
  }
  const c = deck.length > 2 ? 1 + rand(deck.length - 1) : 0;
  return [...deck.slice(c), ...deck.slice(0, c)];
}
