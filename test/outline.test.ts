import { describe, expect, it } from "vitest";
import { layoutOutline, parseOutline, type OutlineNode } from "../src/core/outline";

const show = (ns: OutlineNode[]): unknown => ns.map((n) => (n.children.length ? { [n.title]: show(n.children) } : n.title));

describe("文章からマインドマップ(2026-11-27)", () => {
  it("スペースの字下げ(幅はばらばらでよい)", () => {
    expect(show(parseOutline("a\n aa\n   aaa\n"))).toEqual([{ a: [{ aa: ["aaa"] }] }]);
  });
  it("タブの字下げ", () => {
    expect(show(parseOutline("a\n\ta\n\tb\n\t\ta\n"))).toEqual([{ a: ["a", { b: ["a"] }] }]);
  });
  it("箇条書きの記号・番号・チェックを取る。空行は無視", () => {
    expect(show(parseOutline("- 旅行\n  - 行き先\n\n    1. 京都\n    2) 金沢\n  * [ ] 予算\n"))).toEqual([{ 旅行: [{ 行き先: ["京都", "金沢"] }, "予算"] }]);
  });
  it("見出しの段と、その下の箇条書き", () => {
    expect(show(parseOutline("# 計画\n## 行き先\n- 京都\n- 金沢\n## 予算\n本文の行\n"))).toEqual([{ 計画: [{ 行き先: ["京都", "金沢"] }, { 予算: ["本文の行"] }] }]);
  });
  it("一番上がいくつもあってもよい", () => {
    expect(show(parseOutline("a\n b\nc\n d\n"))).toEqual([{ a: ["b"] }, { c: ["d"] }]);
  });
  it("OPML", () => {
    const x = `<?xml version="1.0"?><opml version="2.0"><head><title>t</title></head><body><outline text="親 &amp; 子"><outline text="子1"/><outline text="子2"><outline text="孫"/></outline></outline></body></opml>`;
    expect(show(parseOutline(x))).toEqual([{ "親 & 子": ["子1", { 子2: ["孫"] }] }]);
  });
  it("FreeMind", () => {
    const x = `<map version="1.0.1"><node TEXT="中心"><node TEXT="右"/><node TEXT="左"><node TEXT="下"/></node></node></map>`;
    expect(show(parseOutline(x, "a.mm"))).toEqual([{ 中心: ["右", { 左: ["下"] }] }]);
  });
  it("XMind(json と古い xml)", () => {
    const j = JSON.stringify([{ rootTopic: { title: "中心", children: { attached: [{ title: "A" }, { title: "B", children: { attached: [{ title: "B1" }] } }] } } }]);
    expect(show(parseOutline(j))).toEqual([{ 中心: ["A", { B: ["B1"] }] }]);
    const x = `<xmap-content><sheet><topic id="1"><title>中心</title><children><topics type="attached"><topic id="2"><title>A</title></topic></topics></children></topic></sheet></xmap-content>`;
    expect(show(parseOutline(x))).toEqual([{ 中心: ["A"] }]);
  });
  it("並び: 子は右に段で、重ならない。子が多いと左右に分ける", () => {
    const roots = parseOutline("r\n a\n b\n c\n d\n");
    const pos = layoutOutline(roots, () => ({ w: 40, h: 20 }), 0, 0);
    expect(pos.length).toBe(5);
    const [r, a, b, c, d] = pos;
    expect(a.x).toBeGreaterThan(r.x);
    expect(b.x).toBeGreaterThan(r.x);
    expect(c.x).toBeLessThan(r.x);
    expect(d.x).toBeLessThan(r.x);
    expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(20);
    const two = layoutOutline(parseOutline("r\n a\n b\n"), () => ({ w: 40, h: 20 }), 0, 0);
    expect(two[1].x).toBeGreaterThan(two[0].x);
    expect(two[2].x).toBeGreaterThan(two[0].x);
  });
});
