// 2026-11-26 修正14: ノートの文章の引用(目印・引用の文字)
import { describe, expect, it } from "vitest";
import { anchorText, newAnchor, parseCite } from "../src/core/cite";
import { bodyLinkTargets, hrefAnchor, hrefToNodeId } from "../src/core/links";
import { anchorIn, findAnchor, parseMarkdown, serializeMarkdown } from "../src/renderer/mdschema";
import { parseNode, serializeNode } from "../src/core/frontmatter";

describe("目印", () => {
  it("形", () => expect(newAnchor()).toMatch(/^q-[a-z0-9]{8}$/));
  it("引用の文字の cite", () => {
    expect(parseCite("abcdefghij#q-12345678")).toEqual({ note: "abcdefghij", anchor: "q-12345678" });
    expect(parseCite("abcdefghij")).toEqual({ note: "abcdefghij", anchor: "" });
    expect(parseCite("x")).toBeNull();
  });
  it("本文から目印の文章を取る(書式は外す)", () => {
    expect(anchorText("前 [**大事な**文](#q-aaaaaaaa) 後\n\n[次の段落](#q-aaaaaaaa)", "q-aaaaaaaa")).toBe("大事な文\n次の段落");
    expect(anchorText("なし", "q-aaaaaaaa")).toBeNull();
  });
  it("元のノートへのリンク ID.md#q-… も、ノートへのリンクとして数える", () => {
    expect(hrefToNodeId("abcdefghij.md#q-12345678")).toBe("abcdefghij");
    expect(hrefAnchor("abcdefghij.md#q-12345678")).toBe("q-12345678");
    expect(bodyLinkTargets("[↩ 元](abcdefghij.md#q-12345678)")).toEqual(["abcdefghij"]);
  });
});

describe("コピーした所に目印を付ける", () => {
  const body = "一つ目の段落です。\n\n二つ目の、引用したい文があります。\n";
  const doc = parseMarkdown(body);
  const find = (t: string) => {
    let at = -1;
    doc.descendants((n, p) => {
      if (at < 0 && n.isText && n.text!.includes(t)) at = p + n.text!.indexOf(t);
    });
    return { from: at, to: at + t.length, text: t };
  };
  it("位置どおりに付く・Markdown では見えないリンク", () => {
    const r = anchorIn(doc, find("引用したい文"), true)!;
    expect(r.changed).toBe(true);
    const md = serializeMarkdown(r.doc);
    expect(md).toContain(`[引用したい文](#${r.anchor})`);
    expect(anchorText(md, r.anchor)).toBe("引用したい文");
    expect(findAnchor(r.doc, r.anchor)).toEqual({ from: find("引用したい文").from, to: find("引用したい文").to });
  });
  it("位置がずれていたら、同じ文章を探す", () => {
    const c = find("一つ目");
    const r = anchorIn(doc, { from: c.from + 3, to: c.to + 3, text: "一つ目" }, false)!;
    expect(serializeMarkdown(r.doc)).toContain(`[一つ目](#${r.anchor})`);
  });
  it("もう目印のある所は、同じ目印を使う", () => {
    const r1 = anchorIn(doc, find("引用したい文"), true)!;
    const c = find("引用したい文");
    const r2 = anchorIn(r1.doc, c, true)!;
    expect(r2.anchor).toBe(r1.anchor);
    expect(r2.changed).toBe(false);
  });
  it("ほかのリンクにかかるときは付けない", () => {
    const d = parseMarkdown("見て [ここ](https://example.com) です\n");
    let at = -1;
    d.descendants((n, p) => {
      if (at < 0 && n.isText && n.text === "ここ") at = p;
    });
    expect(anchorIn(d, { from: at, to: at + 2, text: "ここ" }, true)).toBeNull();
  });
});

describe("cite はファイルに残る", () => {
  it("往復", () => {
    const md = serializeNode({ id: "aaaaaaaaaa", title: "文", type: "text", color: 0, created: "", updated: "", members: [], refs: [], strokes: [], links: [], body: "", extra: {}, cite: "bbbbbbbbbb#q-12345678" });
    expect(md).toContain("cite: bbbbbbbbbb#q-12345678");
    expect(parseNode(md, "aaaaaaaaaa").cite).toBe("bbbbbbbbbb#q-12345678");
  });
});
