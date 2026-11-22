// 本文エディタ(ProseMirror)の Markdown の往復で、リンクと画像が損なわれないこと
import { defaultMarkdownParser, defaultMarkdownSerializer } from "prosemirror-markdown";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsVaultIO } from "../src/main/fsio";
import { tempDir } from "./helpers";

const rt = (md: string) => defaultMarkdownSerializer.serialize(defaultMarkdownParser.parse(md)!);

describe("Markdown の往復", () => {
  it("文章の一部をノードへのリンクに", () => {
    expect(rt("前の[文章](abcdefghij.md)の後")).toBe("前の[文章](abcdefghij.md)の後");
  });
  it("画像(assets/ の相対パス)", () => {
    expect(rt("![](assets/20261122-ab12cd34.png)")).toBe("![](assets/20261122-ab12cd34.png)");
  });
  it("見出し・箇条書き・URL だけの行", () => {
    const md = "## この位置での読み\n\n* ひとつ\n\n* ふたつ\n\nhttps://example.com/a?b=1";
    const back = rt(md);
    expect(back).toContain("## この位置での読み");
    expect(back).toContain("https://example.com/a?b=1");
    expect(rt(back)).toBe(back); // 2 回目からは変わらない
  });
});

describe("画像の保存", () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir()));
  afterEach(() => t.cleanup());
  it("assets/ にファイルとして保存し、相対パスを返す", async () => {
    const io = new FsVaultIO(t.dir);
    const rel = await io.saveAsset("png", new Uint8Array([1, 2, 3]));
    expect(rel).toMatch(/^assets\/\d{8}-[0-9a-f]{8}\.png$/);
    expect([...readFileSync(path.join(t.dir, rel))]).toEqual([1, 2, 3]);
  });
});
