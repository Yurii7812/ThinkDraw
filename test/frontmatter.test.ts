import { describe, expect, it } from "vitest";
import { parseNode, serializeNode } from "../src/core/frontmatter";
import type { TDNode } from "../src/core/types";
import { bodyLinkTargets, urlOnlyLines } from "../src/core/links";

const sample = `---
id: k3f9x2m7qa
title: 別れ方
type: group
color: 2
created: 2026-11-22T18:05:00+09:00
updated: 2026-11-22T18:40:00+09:00
members:
  - { id: a1b2c3d4e5, x: 120, y: 80 }
links:
  - { to: z9y8x7w6v5, kind: arrow }
---
本文(Markdown)
`;

describe("frontmatter", () => {
  it("SPEC の例を読める", () => {
    const n = parseNode(sample, "k3f9x2m7qa");
    expect(n.title).toBe("別れ方");
    expect(n.type).toBe("group");
    expect(n.color).toBe(2);
    expect(n.created).toBe("2026-11-22T18:05:00+09:00");
    expect(n.members).toEqual([{ id: "a1b2c3d4e5", x: 120, y: 80 }]);
    expect(n.links).toEqual([{ to: "z9y8x7w6v5", kind: "arrow" }]);
    expect(n.body).toBe("本文(Markdown)\n");
  });

  it("SPEC の例を書くと、同じ形になる", () => {
    expect(serializeNode(parseNode(sample, "k3f9x2m7qa"))).toBe(sample);
  });

  it("厄介な題・ラベル・カード・知らないキーも往復で壊れない", () => {
    const n: TDNode = {
      id: "abcdefghij", title: "a: b, {c} #d 'e\" - [f]", type: "card", color: 0,
      created: "", updated: "", members: [], body: "---\n本文の中の --- \n",
      links: [{ to: "zzzzzzzzzz", kind: "oppose", label: "なぜ, {か}: \"違う\"" }],
      card: { deck: "tarot", id: "m16", reversed: true },
      spread: { run: "q7w8e9r0t1", pos: "future", spread: "three" },
      extra: { tags: ["x", "y"], custom: { a: 1 } },
    };
    for (const title of [n.title, "true", "123", "null", " 前後に空白 ", "", "- 箇条", "改行\nあり"]) {
      const m = { ...n, title };
      const back = parseNode(serializeNode(m), m.id);
      expect(back).toEqual(m);
    }
  });

  it("frontmatter の無い .md は note として読む", () => {
    const n = parseNode("# ただのメモ\n", "abcdefghij");
    expect(n.type).toBe("note");
    expect(n.body).toBe("# ただのメモ\n");
  });

  it("壊れた値は既定に戻す", () => {
    const n = parseNode("---\ntype: wrong\ncolor: x\nmembers: 3\nlinks:\n  - { to: aaaaaaaaaa, kind: zigzag }\n---\n", "abcdefghij");
    expect(n.type).toBe("text");
    expect(n.color).toBe(0);
    expect(n.members).toEqual([]);
    expect(n.links).toEqual([{ to: "aaaaaaaaaa", kind: "line" }]);
  });
});

describe("本文のリンク", () => {
  it("[文章](<ID>.md) を拾う", () => {
    expect(bodyLinkTargets("あ[い](abcdefghij.md)う [え](<zzzzzzzzzz.md>) [外](https://x.jp) [根](root.md)").sort()).toEqual([
      "abcdefghij", "root", "zzzzzzzzzz",
    ]);
  });
  it("URL だけの行を拾う", () => {
    expect(urlOnlyLines("文 https://a.jp\n  https://b.jp/x?y=1  \n<https://c.jp>")).toEqual(["https://b.jp/x?y=1", "https://c.jp"]);
  });
});
