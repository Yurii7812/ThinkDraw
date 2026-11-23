import { afterEach, beforeEach, expect, it } from "vitest";
import { groupToMarkdown } from "../src/core/export";
import { ROOT_ID } from "../src/core/types";
import type { Vault } from "../src/core/vault";
import { openVault, tempDir } from "./helpers";

let cleanup = () => {};
let v: Vault;
beforeEach(async () => {
  let dir = "";
  ({ dir, cleanup } = tempDir());
  ({ v } = await openVault(dir));
});
afterEach(() => cleanup());

it("Markdown: リンクの木・ノート・中のグループが文章になる", () => {
  const a = v.create({ type: "text", title: "考え", group: ROOT_ID, x: 0, y: 0 }).id;
  const b = v.create({ type: "text", title: "子", group: ROOT_ID, x: 0, y: 100 }).id;
  v.addLink(a, b);
  v.create({ type: "note", title: "メモ", group: ROOT_ID, x: 300, y: 0, body: "本文です" });
  const g = v.create({ type: "group", title: "箱", group: ROOT_ID, x: 300, y: 100 }).id;
  v.create({ type: "text", title: "中身", group: g, x: 0, y: 0 });
  const md = groupToMarkdown(v, ROOT_ID);
  expect(md).toContain("- 考え\n  - 子");
  expect(md).toContain("## メモ\n\n本文です");
  expect(md).toContain("## 箱");
  expect(md).toContain("- 中身");
});
