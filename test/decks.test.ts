import { describe, expect, it } from "vitest";
import { castHexagram, HEXAGRAMS, HEX_BY_ID } from "../src/decks/iching";
import { PROMPT_ITEMS, PROMPT_SETS } from "../src/decks/prompts";
import { fullShuffle, riffleShuffle, seededRand } from "../src/decks/rng";

describe("易", () => {
  it("64 卦がそろい、線の形がすべて違う", () => {
    expect(HEXAGRAMS.length).toBe(64);
    expect(new Set(HEXAGRAMS.map((h) => h.lines.join(""))).size).toBe(64);
    expect(HEXAGRAMS.map((h) => h.num)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
  });
  it("よく知られた卦の形と合う(下から)", () => {
    expect(HEX_BY_ID.h1.lines.join("")).toBe("111111");
    expect(HEX_BY_ID.h2.lines.join("")).toBe("000000");
    expect(HEX_BY_ID.h3.lines.join("")).toBe("100010"); // 水雷屯: 下 震、上 坎
    expect(HEX_BY_ID.h11.lines.join("")).toBe("111000"); // 地天泰
    expect(HEX_BY_ID.h29.lines.join("")).toBe("010010"); // 坎為水
    expect(HEX_BY_ID.h63.lines.join("")).toBe("101010"); // 水火既済
    expect(HEX_BY_ID.h64.lines.join("")).toBe("010101"); // 火水未済
  });
  it("卦を立てる: 変わる爻をひっくり返すと之卦", () => {
    for (let s = 0; s < 50; s++) {
      const r = castHexagram(seededRand("t" + s));
      expect(r.tosses.every((t) => t >= 6 && t <= 9)).toBe(true);
      if (!r.moving.length) expect(r.after).toBeNull();
      else expect(r.after!.lines.join("")).toBe(r.base.lines.map((l, i) => (r.moving.includes(i) ? 1 - l : l)).join(""));
    }
  });
});

describe("発想カードと混ぜ方", () => {
  it("種類と枚数", () => {
    expect(PROMPT_SETS.length).toBe(7);
    expect(new Set(PROMPT_ITEMS.map((p) => p.id)).size).toBe(PROMPT_ITEMS.length);
  });
  it("言葉から: 同じ言葉なら同じ結果", () => {
    const a = fullShuffle([...Array(78).keys()], seededRand("問い"));
    const b = fullShuffle([...Array(78).keys()], seededRand("問い"));
    const c = fullShuffle([...Array(78).keys()], seededRand("別の問い"));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it("リフル+カット: 枚数が変わらず、並びは変わる", () => {
    const d = [...Array(78).keys()];
    const r = riffleShuffle(d, 7, seededRand("x"));
    expect([...r].sort((p, q) => p - q)).toEqual(d);
    expect(r).not.toEqual(d);
  });
});

import { DEFAULT_DRAW, drawTarot } from "../src/decks/draw";
describe("タロットを配る", () => {
  it("使うカード(大アルカナだけ)・逆位置オフなら全部正位置", () => {
    const r = drawTarot(30, { ...DEFAULT_DRAW, pool: "major" }, seededRand("a"));
    expect(r.length).toBe(22);
    expect(r.every((x) => x.def.major && !x.reversed)).toBe(true);
    const m = drawTarot(5, { ...DEFAULT_DRAW, pool: "minor", shuffle: "riffle", reversed: true }, seededRand("b"));
    expect(m.every((x) => !x.def.major)).toBe(true);
  });
});
