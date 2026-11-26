// 2026-11-26 修正12: 検索は上位のグループが先(貼り付けは修正13 で作り直し → fix13.test.ts)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../src/core/vault";
import { ROOT_ID } from "../src/core/types";
import { searchTiered } from "../src/core/search";
import { openVault, tempDir } from "./helpers";

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
