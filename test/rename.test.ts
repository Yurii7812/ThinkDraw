// 2026-11-26 改名: フォルダの中の .thinkdraw/ は、開いたときに .bresuto/ へ名前を変える
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsVaultIO } from "../src/main/fsio";
import { tempDir } from "./helpers";

describe("前の名前のアプリの置き場所", () => {
  let cleanup = () => {};
  afterEach(() => cleanup());
  it(".thinkdraw/ を .bresuto/ にして、中身はそのまま読める", async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    mkdirSync(path.join(t.dir, ".thinkdraw"));
    writeFileSync(path.join(t.dir, ".thinkdraw", "record-kinds.json"), "[1]");
    const io = new FsVaultIO(t.dir);
    expect(existsSync(path.join(t.dir, ".thinkdraw"))).toBe(false);
    expect(readFileSync(path.join(t.dir, ".bresuto", "record-kinds.json"), "utf8")).toBe("[1]");
    expect(await io.readAppFile("record-kinds.json")).toBe("[1]");
  });
  it("もう .bresuto/ があれば何もしない", () => {
    const t = tempDir();
    cleanup = t.cleanup;
    mkdirSync(path.join(t.dir, ".thinkdraw"));
    mkdirSync(path.join(t.dir, ".bresuto"));
    new FsVaultIO(t.dir);
    expect(existsSync(path.join(t.dir, ".thinkdraw"))).toBe(true);
  });
});
