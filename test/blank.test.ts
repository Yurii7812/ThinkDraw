import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../src/renderer/mdschema";

const round = (md: string) => serializeMarkdown(parseMarkdown(md));

describe("空行を残す(2026-11-27)", () => {
  it("段落のあいだの空行は書いたとおりの数", () => {
    expect(round("a\n\nb\n")).toBe("a\n\nb\n");
    expect(round("a\n\n\nb\n")).toBe("a\n\n\nb\n");
    expect(round("a\n\n\n\n\nb\n")).toBe("a\n\n\n\n\nb\n");
  });
  it("空の段落が 1 つ = 空行が 1 つ多い", () => {
    const d = parseMarkdown("a\n\n\nb\n");
    expect(d.childCount).toBe(3);
    expect(d.child(1).content.size).toBe(0);
  });
  it("始めの空行も残る", () => {
    expect(round("\n\na\n")).toBe("\n\na\n");
  });
  it("コードの中の空行はそのまま", () => {
    const md = "```\nx\n\n\n\ny\n```\n";
    expect(round(md)).toBe(md);
  });
  it("見出し・箇条書きのあとも", () => {
    expect(round("# 題\n\n\n* a\n* b\n\n\n本文\n")).toBe("# 題\n\n\n* a\n* b\n\n\n本文\n");
  });
  it("目印の文字はファイルに残らない", () => {
    expect(round("a\n\n\n\nb\n")).not.toContain("");
  });
});

describe("画像の幅(2026-11-27)", () => {
  it("![名前|300](画像) は、そのまま書き戻る", () => {
    const md = "![写真|300](assets/a.png)\n";
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    expect(parseMarkdown(md).firstChild!.firstChild!.attrs.alt).toBe("写真|300");
  });
});
