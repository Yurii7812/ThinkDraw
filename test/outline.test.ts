import { describe, expect, it } from "vitest";
import { flattenOutline, layoutOutline, layoutPastedOutline, parseOutline, type OutlineNode } from "../src/core/outline";

const show = (ns: OutlineNode[]): unknown => ns.map((n) => (n.children.length ? { [n.title]: show(n.children) } : n.title));

describe("文章からマインドマップ(2026-11-27)", () => {
  it("スペースの字下げ(幅はばらばらでよい)", () => {
    expect(show(parseOutline("a\n aa\n   aaa\n"))).toEqual([{ a: [{ aa: ["aaa"] }] }]);
  });
  it("空行のある文章の折り返しをまとめ、全角と半角の字下げを読む", () => {
    expect(show(parseOutline("心の税金\n予定の前の時間が短く感じる\n\n手軽なことを始める\n  数分の動画を見る\n　 動画を見続ける\n　　　結局2時間になる\n\n- 一口サイズの罠\n- ちゃんとやりたい"))).toEqual([
      "心の税金 予定の前の時間が短く感じる",
      { 手軽なことを始める: [{ "数分の動画を見る 動画を見続ける": ["結局2時間になる"] }] },
      "一口サイズの罠", "ちゃんとやりたい",
    ]);
    expect(show(parseOutline("親\n　子1\n 子2\n　　孫"))).toEqual([{ 親: ["子1", { 子2: ["孫"] }] }]);
  });
  it("貼り付けは周囲の空きを使い、乱数によって配置が変わる", () => {
    const nodes = flattenOutline(parseOutline("親\n 子1\n 子2\n 子3\n 子4"));
    const obstacle = { x: -30, y: -20, w: 60, h: 40 };
    const a = layoutPastedOutline(nodes, () => ({ w: 80, h: 24 }), { x: 0, y: 0 }, [obstacle], () => 0.1);
    const b = layoutPastedOutline(nodes, () => ({ w: 80, h: 24 }), { x: 0, y: 0 }, [obstacle], () => 0.8);
    expect(a).not.toEqual(b);
    for (const [i, r] of a.entries()) {
      for (const q of [obstacle, ...a.slice(0, i)]) {
        expect(r.x >= q.x + q.w || q.x >= r.x + r.w || r.y >= q.y + q.h || q.y >= r.y + r.h).toBe(true);
      }
    }
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

import { parseOutlineGraph } from "../src/core/outline";
describe("番号 (n) とコロンで網にする(2026-11-27 夜に決め直し)", () => {
  const g = (t: string) => {
    const r = parseOutlineGraph(t);
    return { tree: show(r.roots), links: r.links.map((l) => `${l.from.title}>${l.to.title}${l.label ? ":" + l.label : ""}`) };
  };
  it("番号は文の後ろ(空白はあってもなくても)。子の行の「(n)」だけで親から線", () => {
    const r = g("気候変動 (1)\n  海面上昇\n    島の水没(2)\n農業\n  (1)\n  (2)");
    expect(r.tree).toEqual([{ 気候変動: [{ 海面上昇: ["島の水没"] }] }, "農業"]);
    expect(r.links).toEqual(["農業>気候変動", "農業>島の水没"]);
  });
  it("(n):い は n から い へ、い :(n) は い から n へ(空白は関係ない)", () => {
    const r = g("あ(1)\n(1):い\n(1): う\nえ :(1)\nお:(1)");
    expect(r.tree).toEqual([{ あ: ["い", "う"] }, "え", "お"]);
    expect(r.links).toEqual(["え>あ", "お>あ"]);
  });
  it("子の行の頭の (言葉) は親からの線の言葉", () => {
    const r = parseOutlineGraph("雨\n\t(原因)洪水\n(1)\nx (1)\n(1): (結果)y");
    expect(r.roots[0].children[0]).toMatchObject({ title: "洪水", label: "原因" });
    const x = r.roots.find((n) => n.title === "x")!;
    expect(x.children[0]).toMatchObject({ title: "y", label: "結果" });
  });
  it("コロンは番号の隣だけ。ふつうの文のコロン・時刻はそのまま", () => {
    expect(g("注意: 傘を持つ\n10:30 集合")).toEqual({ tree: ["注意: 傘を持つ", "10:30 集合"], links: [] });
  });
  it("番号どうし・後ろで付けた番号・無い番号", () => {
    const r = g("(1): (2)\n原因(1)\n結果 (2)\n(9): z");
    expect(r.links).toContain("原因>結果");
    expect(r.tree).toContainEqual({ "(9)": ["z"] });
  });
  it("同じ言葉でも別々に書けば別の物", () => {
    const r = parseOutlineGraph("a\n b\nc\n b");
    expect(r.roots[0].children[0]).not.toBe(r.roots[1].children[0]);
  });
  it("見出しの番号「1. 」「1) 」は番号 (n) ではない", () => {
    expect(g("1. 一つ目\n2) 二つ目").tree).toEqual(["一つ目", "二つ目"]);
  });
});

import { T } from "../src/renderer/strings";
describe("AI に渡す書き方の例", () => {
  it("例のとおりに読める", () => {
    const ex = T.outlineGuide.split("例:\n")[1];
    const r = parseOutlineGraph(ex);
    expect(show(r.roots)).toEqual([{ 気候変動: [{ 海面上昇: ["島の水没"] }, { 農業: ["収入の減少"] }, "異常気象"] }, "移住"]);
    expect(r.links.map((l) => `${l.from.title}>${l.to.title}`)).toEqual(["移住>島の水没"]);
    expect(r.roots[0].children[1].children[0].label).toBe("打撃");
    expect(r.roots[0].children[2].label).toBe("原因");
  });
});
