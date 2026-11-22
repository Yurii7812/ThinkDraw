import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGroupGraph, buildLocalGraph, layoutGraph } from "../src/core/graphLayout";
import { CARD_H, CARD_W, drawCards, placeFree, placeSpread } from "../src/core/spreadLayout";
import { ROOT_ID } from "../src/core/types";
import type { Vault } from "../src/core/vault";
import { DECKS } from "../src/decks";
import { openVault, tempDir } from "./helpers";

let cleanup = () => {};
let v: Vault;
let dir = "";
beforeEach(async () => {
  ({ dir, cleanup } = tempDir());
  ({ v } = await openVault(dir));
});
afterEach(() => cleanup());

function build(vv: Vault) {
  const g1 = vv.create({ type: "group", title: "い", group: ROOT_ID, x: 0, y: 0, id: "g000000001" }).id;
  const g2 = vv.create({ type: "group", title: "あ", group: ROOT_ID, x: 0, y: 0, id: "g000000002" }).id;
  const g3 = vv.create({ type: "group", title: "う", group: g1, x: 0, y: 0, id: "g000000003" }).id;
  vv.addToGroup(g2, g3, 0, 0);
  const a = vv.create({ type: "text", title: "a", group: g1, x: 0, y: 0, id: "t000000001" }).id;
  const b = vv.create({ type: "note", title: "b", group: g1, x: 0, y: 0, id: "t000000002" }).id;
  const c = vv.create({ type: "text", title: "c", group: g2, x: 0, y: 0, id: "t000000003" }).id;
  vv.addLink(a, b, "arrow");
  vv.addLink(b, c, "dashed");
  vv.addLink(g1, g2, "line");
  return { g1, g2, g3, a, b, c };
}

describe("グラフの配置", () => {
  it("同じデータなら毎回同じ配置(作った順に依らない)", async () => {
    const ids = build(v);
    const l1 = layoutGraph(buildGroupGraph(v, "(無題)"));
    const l2 = layoutGraph(buildGroupGraph(v, "(無題)"));
    expect(l2).toEqual(l1);
    // 別の vault に、逆の順で同じ構造を作っても同じ
    const t = tempDir();
    const { v: w } = await openVault(t.dir);
    build(w);
    const shuffled = layoutGraph({ ...buildGroupGraph(w, "(無題)"), nodes: [...buildGroupGraph(w, "(無題)").nodes].reverse() });
    expect(shuffled.nodes).toEqual(l1.nodes);
    t.cleanup();
    // 根が一番上
    const root = l1.nodes.find((n) => n.id === ROOT_ID)!;
    const g3 = l1.nodes.find((n) => n.id === ids.g3)!;
    expect(root.y).toBeLessThan(l1.nodes.find((n) => n.id === ids.g1)!.y);
    expect(l1.nodes.find((n) => n.id === ids.g1)!.y).toBeLessThan(g3.y);
  });

  it("この辺り: 今のグループ・親子・引用・外へのリンクの先と、その所属先", () => {
    const ids = build(v);
    const far = v.create({ type: "group", title: "遠く", group: ROOT_ID, x: 0, y: 0, id: "g000000009" }).id;
    const q = v.create({ type: "text", title: "引用元", group: far, x: 0, y: 0, id: "t000000009" }).id;
    v.addRef(ids.g1, q, 0, 0);
    const g = buildLocalGraph(v, ids.g1, null, "(無題)");
    const names = g.nodes.map((n) => n.id);
    expect(names).toEqual(expect.arrayContaining([ids.g1, ROOT_ID, ids.g3, q, far, ids.c, ids.g2, ids.b]));
    expect(names).not.toContain(ids.a); // 中だけでつながる物は出さない
    expect(g.edges).toEqual(expect.arrayContaining([{ from: ids.g1, to: q, kind: "ref" }, { from: far, to: q, kind: "member" }]));
    // 選んだノードが入っているほかのグループ
    const h = v.create({ type: "group", title: "別", group: ROOT_ID, x: 0, y: 0, id: "g000000008" }).id;
    v.addToGroup(h, ids.a, 0, 0);
    const g2 = buildLocalGraph(v, ids.g1, ids.a, "(無題)");
    expect(g2.edges).toEqual(expect.arrayContaining([{ from: h, to: ids.a, kind: "member" }]));
    expect(layoutGraph(g2).nodes.length).toBe(g2.nodes.length);
  });

  it("構造が変わると key が変わる", () => {
    const ids = build(v);
    const k1 = layoutGraph(buildGroupGraph(v, "")).key;
    v.update(ids.g1, { title: "改名" });
    expect(layoutGraph(buildGroupGraph(v, "")).key).not.toBe(k1);
  });
});

describe("スプレッドの配置", () => {
  it("14 種のスプレッドと 78 枚がある", () => {
    expect(DECKS.tarot.cards.length).toBe(78);
    expect(DECKS.tarot.spreads.length).toBe(14);
    for (const c of DECKS.tarot.cards) expect(c.up && c.rv).toBeTruthy();
  });

  it("画面の中心に、形を保って置く", () => {
    for (const s of DECKS.tarot.spreads) {
      const p = placeSpread(s, { x: 1000, y: 500 });
      expect(p.length).toBe(s.pos.length);
      const cxs = p.map((q) => q.x + CARD_W / 2);
      const cys = p.map((q) => q.y + CARD_H / 2);
      expect((Math.min(...cxs) + Math.max(...cxs)) / 2).toBeCloseTo(1000, -1);
      expect((Math.min(...cys) + Math.max(...cys)) / 2).toBeCloseTo(500, -1);
      // カード同士が重ならない(中心の距離がカードの幅より広い)
      for (let i = 0; i < p.length; i++)
        for (let j = i + 1; j < p.length; j++) {
          const overlapX = Math.abs(p[i].x - p[j].x) < CARD_W;
          const overlapY = Math.abs(p[i].y - p[j].y) < CARD_H;
          expect(overlapX && overlapY, `${s.id} ${p[i].pos!.id} と ${p[j].pos!.id}`).toBe(false);
        }
    }
  });

  it("自由に引く: 枚数どおり・中心に", () => {
    const p = placeFree(9, { x: 0, y: 0 });
    expect(p.length).toBe(9);
    expect(p.every((q) => q.pos === null)).toBe(true);
  });

  it("引くカードは重複しない", () => {
    let seed = 7;
    const rand = (m: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % m;
    const d = drawCards(DECKS.tarot.cards, 78, rand);
    expect(new Set(d.map((c) => c.id)).size).toBe(78);
  });
});
