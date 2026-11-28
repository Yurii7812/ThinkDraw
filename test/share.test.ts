import { afterEach, describe, expect, it } from "vitest";
import { fromJsonCanvas, toJsonCanvas, toOpml, toOutlineText } from "../src/core/share";
import { parseOutlineGraph, parseOutline } from "../src/core/outline";
import { ROOT_ID } from "../src/core/types";
import { openVault, tempDir } from "./helpers";

let clean = () => {};
afterEach(() => clean());

async function board() {
  const t = tempDir();
  clean = t.cleanup;
  const { v } = await openVault(t.dir);
  const mk = (title: string, x: number, y: number) => v.create({ type: "text", title, group: ROOT_ID, x, y }).id;
  const a = mk("気候変動", 0, 0), b = mk("海面上昇", 200, 0), c = mk("島の水没", 400, 0), d = mk("農業", 0, 200), e = mk("注意: 10:30 (2)", 0, 400);
  v.addLink(a, b);
  v.addLink(b, c, "arrow");
  v.setLinkLabel(b, c, "原因");
  v.addLink(d, a);
  v.addLink(d, c);
  const rect = (id: string) => {
    const p = v.itemPos(ROOT_ID, id)!;
    return { x: p.x, y: p.y, w: 100, h: 30 };
  };
  return { v, rect, ids: { a, b, c, d, e } };
}

describe("共有の書き出し(2026-11-28)", () => {
  it("網の箇条書きは、貼り付け(Ctrl+Q)で同じ網に戻る", async () => {
    const { v, rect } = await board();
    const text = toOutlineText(v, ROOT_ID, rect);
    const g = parseOutlineGraph(text);
    const all: string[] = [];
    const walk = (n: { title: string; children: { title: string; children: never[] }[] }) => (all.push(n.title), n.children.forEach(walk as never));
    g.roots.forEach(walk as never);
    expect(all.sort()).toEqual(["気候変動", "海面上昇", "島の水没", "農業", "注意: 10:30 （2）"].sort());
    // 線は 4 本(木 + 番号で指す線)
    let tree = 0;
    const count = (n: { children: unknown[] }) => ((tree += n.children.length), n.children.forEach(count as never));
    g.roots.forEach(count as never);
    expect(tree + g.links.length).toBe(4);
    expect(text).toContain("(原因)");
  });
  it("JSON Canvas: 位置・線・言葉・矢印を書き、読み直せる", async () => {
    const { v, rect, ids } = await board();
    const j = JSON.parse(toJsonCanvas(v, ROOT_ID, rect));
    expect(j.nodes).toHaveLength(5);
    const e = j.edges.find((x: { fromNode: string; toNode: string }) => x.fromNode === ids.b && x.toNode === ids.c);
    expect(e).toMatchObject({ label: "原因", toEnd: "arrow" });
    const back = fromJsonCanvas(JSON.stringify(j));
    expect(back.nodes.map((n) => n.title)).toContain("海面上昇");
    expect(back.edges.find((x) => x.label === "原因")?.kind).toBe("arrow");
    expect(back.edges.filter((x) => x.kind === "line")).toHaveLength(3);
  });
  it("BRESUTO 拡張付きの .canvas はペン、色、著者、線種を持ち帰れる", async () => {
    const { v, rect, ids } = await board();
    v.move(ROOT_ID, [{ id: ids.a, x: -100, y: -50 }]);
    v.setExtra(ids.a, { byName: "Alex", byColor: "#333333" });
    v.setLinkProps(ids.a, ids.b, { kind: "dashed", color: 8, at: 0.7, size: 18 });
    v.addStroke(ROOT_ID, { c: 2, w: 8, hl: true, p: [-100, -50, 15, 25] });
    const file = toJsonCanvas(v, ROOT_ID, rect);
    const imported = fromJsonCanvas(file);
    expect(imported.nodes[0]).toMatchObject({ title: "気候変動", x: 0, y: 0, byName: "Alex", byColor: "#333333" });
    expect(imported.edges.find((e) => e.from === ids.a)).toMatchObject({ kind: "dashed", color: 8, at: 0.7, size: 18 });
    expect(imported.strokes).toEqual([{ c: 2, w: 8, hl: true, p: [0, 0, 115, 75] }]);
  });
  it("OPML は木(アウトライナーで読める)", async () => {
    const { v, rect } = await board();
    const o = toOpml(v, ROOT_ID, rect, "ホーム");
    expect(o).toContain("<opml");
    expect(parseOutline(o).map((n) => n.title)).toContain("農業");
  });
});
