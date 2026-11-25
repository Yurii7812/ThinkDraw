// 2026-11-26 修正12: 貼り付けで表・チェックリスト / 検索は上位のグループが先
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../src/core/vault";
import { ROOT_ID } from "../src/core/types";
import { searchTiered } from "../src/core/search";
import { bodyFromPaste } from "../src/renderer/mdschema";
import { openVault, tempDir } from "./helpers";

describe("貼った文字から表・チェックリスト", () => {
  it("1 行だけなら何もしない", () => expect(bodyFromPaste("あ")).toBeNull());
  it("タブ区切りは表", () => expect(bodyFromPaste("名前\t値\nA\t1")).toBe("| 名前 | 値 |\n| --- | --- |\n| A | 1 |\n"));
  it("CSV は表(囲みのカンマも)", () => expect(bodyFromPaste('a,b\n"x,y",2')).toBe("| a | b |\n| --- | --- |\n| x,y | 2 |\n"));
  it("空白で区切って同じ数なら表", () => expect(bodyFromPaste("a b c\n1 2 3")).toContain("| 1 | 2 | 3 |"));
  it("数が揃わない複数行は、1 行ずつのチェックリスト", () => expect(bodyFromPaste("牛乳を買う\n- 卵 を 2 つ\n3. 掃除")).toBe("- [ ] 牛乳を買う\n- [ ] 卵 を 2 つ\n- [ ] 掃除\n"));
});

describe("検索は上位のグループが先", () => {
  let cleanup = () => {};
  let v: Vault;
  beforeEach(async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    ({ v } = await openVault(t.dir));
  });
  afterEach(() => cleanup());
  it("名前が当たったグループは、浅い方が先", () => {
    const A = v.create({ type: "group", title: "計画", group: ROOT_ID, x: 0, y: 0 }).id;
    const deep = v.create({ type: "group", title: "計画の計画", group: A, x: 0, y: 0 }).id;
    const top = v.create({ type: "group", title: "計画メモ", group: ROOT_ID, x: 0, y: 0 }).id;
    const r = searchTiered(v, "計画").groups;
    expect(r.indexOf(deep)).toBeGreaterThan(r.indexOf(top));
    expect(r.indexOf(deep)).toBeGreaterThan(r.indexOf(A));
  });
});
