// 2026-11-24: 引用で新しいグループ・検索の並び・枠
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../src/core/vault";
import { ROOT_ID } from "../src/core/types";
import { searchTiered } from "../src/core/search";
import { openVault, tempDir } from "./helpers";

let dir = "";
let cleanup = () => {};
let v: Vault;

beforeEach(async () => {
  ({ dir, cleanup } = tempDir());
  ({ v } = await openVault(dir));
});
afterEach(() => cleanup());

const text = (title: string, group = ROOT_ID, x = 0, y = 0, body = "") => v.create({ type: "text", title, group, x, y, body }).id;
const group = (title: string, parent = ROOT_ID) => v.create({ type: "group", title, group: parent, x: 0, y: 0 }).id;

describe("引用で新しいグループ", () => {
  it("選んだ物は元の画面でそのまま。新しいグループの中に引用として同じ並びで入る", () => {
    const A = group("A");
    const a = text("あ", A, 100, 50);
    const b = text("い", A, 300, 80);
    v.addLink(a, b);
    const g = v.quoteGroup(A, [a, b], 500, 60, "新");
    expect(v.memberPos(A, a)).toEqual({ x: 100, y: 50 });
    expect(v.memberPos(A, b)).toEqual({ x: 300, y: 80 });
    expect(v.memberPos(A, g.id)).toEqual({ x: 500, y: 60 });
    expect(v.refsOf(g.id)).toEqual([
      { id: a, x: 0, y: 0 },
      { id: b, x: 200, y: 30 },
    ]);
    expect(v.membersOf(g.id)).toEqual([]);
    expect(v.parentsOf(a)).toEqual([A]);
    v.undo();
    expect(v.exists(g.id)).toBe(false);
  });

  it("作ったグループを別のグループへ移せる(A からは消え、B に入る)", () => {
    const A = group("A");
    const B = group("B");
    const a = text("あ", A);
    const g = v.quoteGroup(A, [a], 0, 0);
    v.moveToGroup(A, B, g.id, 10, 10);
    expect(v.parentsOf(g.id)).toEqual([B]);
    expect(v.memberPos(A, a)).not.toBeNull();
  });
});

describe("検索の並び: グループの名前 → 中身 → ノード", () => {
  it("名前に当たったグループ、直下の物に当たったグループ、ノードの順に分ける", () => {
    const G1 = group("りんごの話");
    const G2 = group("果物");
    const n = v.create({ type: "note", title: "メモ", group: G2, x: 0, y: 0, body: "青いりんごを買った" }).id;
    const t = text("りんご飴", ROOT_ID);
    const r = searchTiered(v, "りんご");
    expect(r.groups).toEqual([G1]);
    expect(r.contents.map((c) => c.id)).toContain(G2);
    expect(r.contents.find((c) => c.id === G2)?.hits).toEqual([n]);
    expect(r.nodes).toContain(n);
    expect(r.nodes).toContain(t);
    expect(r.nodes).not.toContain(G1);
  });

  it("名前で当たったグループは、中身の段には重ねて出さない", () => {
    const G = group("りんご");
    text("りんごの木", G);
    const r = searchTiered(v, "りんご");
    expect(r.groups).toEqual([G]);
    expect(r.contents.map((c) => c.id)).not.toContain(G);
  });
});

describe("枠", () => {
  it("枠は大きさを持ち、ファイルに書いて読み直せる。線も引ける", async () => {
    const f = v.create({ type: "frame", title: "考え", group: ROOT_ID, x: 10, y: 20, size: { w: 300, h: 200 } }).id;
    const a = text("あ", ROOT_ID, 400, 0);
    v.addLink(f, a);
    v.setFrameSize(f, 320.4, 10);
    await v.flush();
    const src = readFileSync(path.join(dir, `${f}.md`), "utf8");
    expect(src).toContain("type: frame");
    expect(src).toContain("size: { w: 320, h: 30 }");
    const { v: v2 } = await openVault(dir);
    expect(v2.get(f)?.size).toEqual({ w: 320, h: 30 });
    expect(v2.get(f)?.links.map((l) => l.to)).toEqual([a]);
  });

  it("枠は所属を変えない(中の物は元のグループのまま)", () => {
    const a = text("あ", ROOT_ID, 50, 50);
    const f = v.create({ type: "frame", group: ROOT_ID, x: 0, y: 0, size: { w: 200, h: 200 } }).id;
    expect(v.parentsOf(a)).toEqual([ROOT_ID]);
    expect(v.membersOf(f)).toEqual([]);
  });
});
