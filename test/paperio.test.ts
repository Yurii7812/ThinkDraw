// 紙PKM の取り込み(本物の magick・pdftoppm を通す)。OCR だけ、決まった読みを返す試験用のものに差し替える。
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bySeries } from "../src/core/paper";
import type { OcrEngine } from "../src/main/ocr";
import { DEFAULT_CROP, PaperStore } from "../src/main/paperio";

let tmp = "";
/** magick と pdftoppm が入っている所だけで試す(GitHub Actions の Windows・Mac などには無い) */
const hasTools = (() => {
  try {
    execFileSync("magick", ["-version"], { stdio: "ignore" });
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
/** 左上に ID を青で書いた、A4 の紙の画像を作る */
function page(name: string, id: string, color = "#2040c0"): string {
  const f = path.join(tmp, "in", name);
  execFileSync("magick", ["-size", "620x877", "xc:white", "-fill", color, "-pointsize", "34", "-annotate", "+20+44", id, "-fill", "black", "-pointsize", "16", "-annotate", "+470+30", "2026 11 23", "-fill", "#c02020", "-annotate", "+100+300", "-> 9z", f]);
  return f;
}
/** 試験用の OCR: ページの順に、決めた読みを返す。2 つのモデルの代わりに 2 つ作る */
function stubs(answers: [string, string][]): OcrEngine[] {
  return [0, 1].map((j) => ({
    name: `stub${j}`,
    check: async () => null,
    readMany: async (files: string[]) => files.map((_, i) => answers[i]?.[j] ?? ""),
  }));
}

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "td-paper-"));
  execFileSync("mkdir", ["-p", path.join(tmp, "in"), path.join(tmp, "vault")]);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("OCR の返事の読み方", () => {
  it("R1: 1a の行を読む・行の印をそのまま答えたものは読めなかったことにする", async () => {
    const { parseRows } = await import("../src/main/ocr");
    expect(parseRows("R1: 1a\nR2: R2\nR3: none\nR4: 3 - 紙", 5)).toEqual(["1a", "", "", "3", ""]);
  });
});

describe.skipIf(!hasTools)("紙PKM の取り込み", () => {
  const vault = () => path.join(tmp, "vault");

  it("PDF と画像をページに分け、読みが一致したものは自動・分かれたものは要確認。確定すると一覧に入る", async () => {
    const a = page("a.jpg", "1a"), b = page("b.jpg", "1a2"), c = page("c.jpg", "1a-1");
    const pdf = path.join(tmp, "in", "scan.pdf");
    execFileSync("magick", [a, b, pdf]);
    const store = new PaperStore(vault());
    const eng = stubs([["1a", "1a"], ["1a2", "1a2"], ["1a-1", "1a1"]]);
    const st = await store.stage([pdf, c], eng, DEFAULT_CROP, () => {});
    expect(st.ocrError).toBeNull();
    // 1a2 は読みが一致しても、前の 1a1 が無いので要確認(読み違いの疑い)
    expect(st.pages.map((p) => [p.fz, p.status])).toEqual([["1a", "auto"], ["1a2", "review"], ["1a-1", "review"]]);
    expect(st.pages[1]!.ocr!.reason).toContain("1a1");
    expect(st.pages.map((p) => p.source.page)).toEqual([1, 2, 1]);
    // 切り出し・小さな絵ができている
    const sdir = path.join(vault(), "paper", ".staging", st.batch);
    for (const p of st.pages) for (const ext of [".jpg", ".thumb.jpg", ".crop.png"]) expect(existsSync(path.join(sdir, p.key + ext))).toBe(true);
    // 確定する前は一覧は空
    expect((await store.readIndex()).pages).toEqual([]);
    const ix = await store.commit(st.batch, st.pages.map((p) => ({ key: p.key, fz: p.fz, include: true })));
    expect(bySeries(ix)[1]!.pages.map((p) => p.fz)).toEqual(["1a-1", "1a", "1a2"]);
    expect(existsSync(sdir)).toBe(false);
    for (const p of ix.pages) expect(existsSync(path.join(vault(), p.img))).toBe(true);
    // 元の PDF は sources/ に残る
    expect(readdirSync(path.join(vault(), "paper", "sources")).some((f) => f.endsWith(".pdf"))).toBe(true);
  });

  it("後日の追加: 既存のページ(内部ID・画像)を変えずに、正しい場所へ入る。同じ画像の取り込み直しは既定で外す", async () => {
    const store = new PaperStore(vault());
    const before = await store.readIndex();
    const d = page("d.jpg", "1a1"), e = page("e.jpg", "0-2");
    const again = path.join(tmp, "in", "c.jpg"); // 前に取り込んだ画像
    const st = await store.stage([d, e, again], stubs([["1a1", "1a1"], ["0-2", "0-2"], ["1a-1", "1a-1"]]), DEFAULT_CROP, () => {});
    expect(st.pages[2]!.dupOf).toBe(before.pages.find((p) => p.fz === "1a-1")!.pid);
    expect(st.pages[2]!.status).toBe("review");
    const ix = await store.commit(st.batch, st.pages.map((p) => ({ key: p.key, fz: p.fz, include: !p.dupOf })));
    expect(ix.pages.length).toBe(5);
    for (const b of before.pages) expect(ix.pages.find((p) => p.pid === b.pid)).toEqual(b);
    const s = bySeries(ix);
    expect(s[0]!.pages.map((p) => p.fz)).toEqual(["0-2"]);
    expect(s[1]!.pages.map((p) => p.fz)).toEqual(["1a-1", "1a", "1a1", "1a2"]);
  });

  it("再起動(新しく読み直し)しても残る・IDを直しても内部IDは同じ・書き換え前の写しが残る", async () => {
    const store = new PaperStore(vault());
    const ix = await store.readIndex();
    const p = ix.pages.find((x) => x.fz === "1a2")!;
    await store.setFz(p.pid, "1a3");
    const again = await new PaperStore(vault()).readIndex();
    expect(again.pages.find((x) => x.pid === p.pid)).toMatchObject({ fz: "1a3", status: "manual" });
    expect(readdirSync(path.join(vault(), "paper", "backups")).length).toBeGreaterThan(0);
  });

  it("同じ取り込みの中で同じ ID になったら、両方とも要確認", async () => {
    const store = new PaperStore(vault());
    const st = await store.stage([page("f.jpg", "3"), page("g.jpg", "3 - 題")], stubs([["3", "3"], ["3", "3"]]), DEFAULT_CROP, () => {});
    expect(st.pages.map((p) => p.status)).toEqual(["review", "review"]);
    await store.discard(st.batch);
  });

  it("OCR を使えないときは、読めたふりをせず全部要確認", async () => {
    const store = new PaperStore(vault());
    const off: OcrEngine = { name: "off", check: async () => "ollama に接続できません", readMany: async (f) => f.map(() => "1a") };
    const st = await store.stage([page("h.jpg", "2a")], [off], DEFAULT_CROP, () => {});
    expect(st.ocrError).toContain("接続できません");
    expect(st.pages[0]).toMatchObject({ fz: null, status: "review" });
    await store.discard(st.batch);
  });

  it("2 つ目のモデルが無いときは、1 通りの読みなので自動で確定しない", async () => {
    const store = new PaperStore(vault());
    const [a] = stubs([["2c", "2c"]]);
    const missing: OcrEngine = { name: "m2", check: async () => "ollama にモデル m2 がありません", readMany: async () => [] };
    const st = await store.stage([page("j.jpg", "2c")], [a!, missing], DEFAULT_CROP, () => {});
    expect(st.ocrError).toBeNull();
    expect(st.pages[0]).toMatchObject({ fz: "2c", status: "review" });
    expect(st.pages[0]!.ocr!.reason).toContain("m2 がありません");
    await store.discard(st.batch);
  });

  it("取り込みの確定が途中で失敗しても、一覧は前のまま", async () => {
    const store = new PaperStore(vault());
    const before = readFileSync(path.join(vault(), "paper", "index.json"), "utf8");
    const st = await store.stage([page("i.jpg", "2b")], stubs([["2b", "2b"]]), DEFAULT_CROP, () => {});
    rmSync(path.join(vault(), "paper", ".staging", st.batch, st.pages[0]!.key + ".jpg")); // 画像が消えた
    await expect(store.commit(st.batch, [{ key: st.pages[0]!.key, fz: "2b", include: true }])).rejects.toThrow();
    expect(readFileSync(path.join(vault(), "paper", "index.json"), "utf8")).toBe(before);
    await store.discard(st.batch);
  });

  it("一覧から外しても、画像は paper/.trash に残る。書き出しは系列ごと", async () => {
    const store = new PaperStore(vault());
    const ix = await store.readIndex();
    const p = ix.pages.find((x) => x.fz === "0-2")!;
    const next = await store.remove(p.pid);
    expect(next.pages.some((x) => x.pid === p.pid)).toBe(false);
    expect(readdirSync(path.join(vault(), "paper", ".trash", p.pid))).toEqual(expect.arrayContaining(["page.json", "pages-" + p.pid + ".jpg"]));
    const out = path.join(tmp, "out");
    const n = await store.exportTo(out);
    expect(n).toBe(next.pages.length);
    expect(readdirSync(path.join(out, "1")).sort()[0]).toMatch(/^0001_1a-1_p[0-9a-f]{12}\.jpg$/);
    writeFileSync(path.join(tmp, "ok"), "");
  });
});
