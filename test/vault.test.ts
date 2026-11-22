import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CycleError, type Vault } from "../src/core/vault";
import { ROOT_ID } from "../src/core/types";
import { openVault, tempDir } from "./helpers";

let dir = "";
let cleanup = () => {};
let v: Vault;

beforeEach(async () => {
  ({ dir, cleanup } = tempDir());
  ({ v } = await openVault(dir));
});
afterEach(() => cleanup());

const text = (title: string, group = ROOT_ID, x = 0, y = 0) => v.create({ type: "text", title, group, x, y }).id;
const group = (title: string, parent = ROOT_ID) => v.create({ type: "group", title, group: parent, x: 0, y: 0 }).id;

describe("vault の土台", () => {
  it("空のフォルダを開くと root.md(題「ホーム」)を作る", async () => {
    await v.flush();
    const src = readFileSync(path.join(dir, "root.md"), "utf8");
    expect(src).toContain("title: ホーム");
    expect(src).toContain("type: group");
  });

  it("作ったノードはファイル名が ID の .md になり、開き直すと同じものが読める", async () => {
    const a = text("あ", ROOT_ID, 10, 20);
    await v.flush();
    expect(existsSync(path.join(dir, `${a}.md`))).toBe(true);
    expect(a).toMatch(/^[a-z0-9]{10}$/);
    const { v: v2 } = await openVault(dir);
    expect(v2.get(a)?.title).toBe("あ");
    expect(v2.memberPos(ROOT_ID, a)).toEqual({ x: 10, y: 20 });
  });

  it("書き込みは一時ファイルを残さない", async () => {
    text("あ");
    await v.flush();
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("どこにも属さないノードは、読み込み時に根に入れる", async () => {
    writeFileSync(path.join(dir, "aaaaaaaaaa.md"), "---\nid: aaaaaaaaaa\ntitle: 迷子\ntype: text\n---\n");
    const { v: v2 } = await openVault(dir);
    expect(v2.parentsOf("aaaaaaaaaa")).toEqual([ROOT_ID]);
  });
});

describe("索引", () => {
  it("親の逆引き・リンクの逆引き(線と本文)", () => {
    const g = group("G");
    const a = text("a", g);
    const b = text("b", g);
    const c = text("c");
    v.addLink(a, b, "arrow");
    v.update(c, { body: `[こちら](${b}.md)` });
    expect(v.parentsOf(a)).toEqual([g]);
    expect(v.backlinksOf(b).sort()).toEqual([a, c].sort());
    v.removeLink(a, b);
    expect(v.backlinksOf(b)).toEqual([c]);
  });

  it("全文検索(題と本文、複数語は AND、題に当たるものが先)", () => {
    const a = text("りんごの木");
    const b = v.create({ type: "note", title: "果物", body: "りんご と みかん", group: ROOT_ID, x: 0, y: 0 }).id;
    expect(v.index.search("りんご")).toEqual([a, b]);
    expect(v.index.search("りんご みかん")).toEqual([b]);
    expect(v.index.search("ぶどう")).toEqual([]);
  });

  it("外部のエディタの変更を取り込む(自分の書き込みは無視する)", async () => {
    const a = text("前");
    await v.flush();
    const file = path.join(dir, `${a}.md`);
    expect(v.applyExternal(`${a}.md`, readFileSync(file, "utf8"))).toBe(false);
    const changed = readFileSync(file, "utf8").replace("title: 前", "title: 後");
    expect(v.applyExternal(`${a}.md`, changed)).toBe(true);
    expect(v.get(a)?.title).toBe("後");
    expect(v.index.search("後")).toEqual([a]);
  });
});

describe("循環の禁止", () => {
  it("A の中の B に、A を入れられない", () => {
    const A = group("A");
    const B = group("B", A);
    expect(() => v.addToGroup(B, A, 0, 0)).toThrow(CycleError);
    expect(() => v.addToGroup(A, A, 0, 0)).toThrow(CycleError);
    const C = group("C", B);
    expect(() => v.addToGroup(C, A, 0, 0)).toThrow(CycleError);
    expect(v.canContain(A, C)).toBe(true); // 子孫を上に入れるのは循環ではない
  });
  it("根は、どのグループにも入れられない", () => {
    const A = group("A");
    expect(() => v.addToGroup(A, ROOT_ID, 0, 0)).toThrow(CycleError);
  });
});

describe("所属の操作の意味", () => {
  it("入れる: 元の所属は残る / 外す: 最後の所属なら根へ", () => {
    const G = group("G");
    const H = group("H");
    const a = text("a", G, 5, 6);
    v.addToGroup(H, a, 1, 1);
    expect(v.parentsOf(a).sort()).toEqual([G, H].sort());
    v.removeFromGroup(G, a);
    expect(v.parentsOf(a)).toEqual([H]);
    v.removeFromGroup(H, a);
    expect(v.parentsOf(a)).toEqual([ROOT_ID]);
    expect(v.removeFromGroup(ROOT_ID, a)).toBe(false); // 根が最後なら外せない
  });

  it("削除: .trash/ へ移し、どのグループからも消える。元に戻せる", async () => {
    const G = group("G");
    const a = text("a", G);
    v.addToGroup(ROOT_ID, a, 0, 0);
    await v.flush();
    v.trash([a]);
    await v.flush();
    expect(existsSync(path.join(dir, `${a}.md`))).toBe(false);
    expect(existsSync(path.join(dir, ".trash", `${a}.md`))).toBe(true);
    expect(v.membersOf(G)).toEqual([]);
    expect(v.membersOf(ROOT_ID).map((m) => m.id)).not.toContain(a);
    v.undo();
    await v.flush();
    expect(existsSync(path.join(dir, `${a}.md`))).toBe(true);
    expect(existsSync(path.join(dir, ".trash", `${a}.md`))).toBe(false);
    expect(v.parentsOf(a).sort()).toEqual([G, ROOT_ID].sort());
  });

  it("グループを削除しても中は消えない(親を失ったものは根へ)", () => {
    const G = group("G");
    const H = group("H");
    const a = text("a", G);
    const b = text("b", G);
    v.addToGroup(H, b, 0, 0);
    v.trash([G]);
    expect(v.parentsOf(a)).toEqual([ROOT_ID]);
    expect(v.parentsOf(b)).toEqual([H]);
  });

  it("束ねる: 新しいグループを作って中に入れ、元の場所にそのグループを置く", () => {
    const a = text("a", ROOT_ID, 0, 0);
    const b = text("b", ROOT_ID, 100, 50);
    const g = v.bundle(ROOT_ID, [a, b], "束");
    expect(v.memberPos(ROOT_ID, g.id)).toEqual({ x: 50, y: 25 });
    expect(v.parentsOf(a)).toEqual([g.id]);
    expect(v.memberPos(g.id, a)).toEqual({ x: -50, y: -25 });
    expect(v.memberPos(ROOT_ID, a)).toBeNull();
  });

  it("解く: 中のノードを、そのグループの親すべてに足す。グループは .trash/ へ", async () => {
    const P1 = group("P1");
    const P2 = group("P2");
    const a = text("a");
    const b = text("b");
    const g = v.bundle(ROOT_ID, [a, b], "束").id;
    v.removeFromGroup(ROOT_ID, g); // 根から外しても、P1 に入れてから…
    v.addToGroup(P1, g, 300, 300);
    v.addToGroup(P2, g, 0, 0);
    v.removeFromGroup(ROOT_ID, g);
    await v.flush();
    v.unbundle(g);
    await v.flush();
    expect(v.exists(g)).toBe(false);
    expect(v.parentsOf(a).sort()).toEqual([P1, P2].sort());
    expect(existsSync(path.join(dir, ".trash", `${g}.md`))).toBe(true);
  });

  it("線: 引く・もう一度で外す・種類・向きを逆に", () => {
    const a = text("a");
    const b = text("b");
    expect(v.toggleLink(a, b)).toBe("added");
    expect(v.toggleLink(b, a)).toBe("removed");
    v.addLink(a, b, "arrow");
    v.setLinkLabel(a, b, "なぜ");
    v.reverseLink(a, b);
    expect(v.get(a)!.links).toEqual([]);
    expect(v.get(b)!.links).toEqual([{ to: a, kind: "arrow", label: "なぜ" }]);
  });

  it("元に戻す・やり直す(1 操作 = 1 歩)", () => {
    const a = text("a");
    const b = text("b");
    v.bundle(ROOT_ID, [a, b]);
    expect(v.parentsOf(a)).not.toEqual([ROOT_ID]);
    v.undo();
    expect(v.parentsOf(a)).toEqual([ROOT_ID]);
    v.redo();
    expect(v.parentsOf(a)).not.toEqual([ROOT_ID]);
    v.undo();
    v.undo();
    expect(v.exists(b)).toBe(false);
  });
});

describe("本文と元に戻す", () => {
  it("本文の書き換えは、キャンバスの元に戻すで巻き戻らない", () => {
    const a = text("a");
    v.update(a, { color: 3 });
    v.setBody(a, "新しい本文");
    v.undo(); // 色を戻す
    expect(v.get(a)!.color).toBe(0);
    expect(v.get(a)!.body).toBe("新しい本文");
  });
});

describe("引用(所属とは別)", () => {
  it("引用は所属に数えない・元を消すと引用も消える・外すと引用だけ外れる", () => {
    const G = group("G");
    const H = group("H");
    const a = text("a", G);
    expect(v.addRef(H, a, 5, 5)).toBe(true);
    expect(v.parentsOf(a)).toEqual([G]);
    expect(v.quotedBy(a)).toEqual([H]);
    expect(v.itemsOf(H).find((i) => i.id === a)?.ref).toBe(true);
    expect(v.addRef(G, a, 0, 0)).toBe(false); // 所属しているところには引用しない
    v.removeFromGroup(H, a);
    expect(v.quotedBy(a)).toEqual([]);
    expect(v.parentsOf(a)).toEqual([G]);
    v.addRef(H, a, 5, 5);
    v.trash([a]);
    expect(v.refsOf(H)).toEqual([]);
    v.undo();
    expect(v.quotedBy(a)).toEqual([H]);
  });
  it("引用だけのノードは、所属を失うと根に入る", () => {
    const G = group("G");
    const H = group("H");
    const a = text("a", G);
    v.addRef(H, a, 0, 0);
    v.trash([G]);
    expect(v.parentsOf(a)).toEqual([ROOT_ID]);
    expect(v.quotedBy(a)).toEqual([H]);
  });
  it("グループは祖先も引用できる(入れ子ではないので循環にならない)", () => {
    const A = group("A");
    const B = group("B", A);
    expect(v.addRef(B, A, 0, 0)).toBe(true);
  });
  it("束ねると、引用は引用のまま、線も一緒に移る", () => {
    const G = group("G");
    const a = text("a", G, 0, 0);
    const b = text("b");
    v.addRef(G, b, 100, 0);
    const s = v.addStroke(G, { c: 1, w: 3, p: [0, 0, 100, 0] });
    const n = v.bundle(G, [a, b], "束", [s.id]);
    expect(v.parentsOf(b)).toEqual([ROOT_ID]);
    expect(v.quotedBy(b)).toEqual([n.id]);
    expect(v.strokesOf(G)).toEqual([]);
    expect(v.strokesOf(n.id)[0].p).toEqual([-50, 0, 50, 0]);
  });
  it("ペンの線: 足す・動かす・消す・元に戻す", () => {
    const s = v.addStroke(ROOT_ID, { c: 2, w: 3, p: [0, 0, 1, 1] });
    v.moveStrokes(ROOT_ID, [s.id], 10, 20);
    expect(v.strokesOf(ROOT_ID)[0].p).toEqual([10, 20, 11, 21]);
    v.removeStrokes(ROOT_ID, [s.id]);
    expect(v.strokesOf(ROOT_ID)).toEqual([]);
    v.undo();
    expect(v.strokesOf(ROOT_ID).length).toBe(1);
  });
});
