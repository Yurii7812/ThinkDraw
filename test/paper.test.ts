import { describe, expect, it } from "vitest";
import { compareFz, earlierSiblings, parentFz, parseFz, sortFz } from "../src/core/folgezettel";
import { addPages, bySeries, confusionFixes, decideFz, missingSibling, duplicateFz, emptyIndex, pagesWithFz, setFz, type PaperPage } from "../src/core/paper";

describe("Folgezettel ID の解析", () => {
  it.each([
    ["1a", 1, "note", "1a", null],
    ["1a1", 1, "note", "1a1", null],
    ["1a1a", 1, "note", "1a1a", null],
    ["1a1-1", 1, "index", "1a1", "1"],
    ["1a1-1a", 1, "index", "1a1", "1a"],
    ["1a3-1", 1, "index", "1a3", "1"],
    ["0-1", 0, "master", "0", "1"],
    ["0-1a", 0, "master", "0", "1a"],
    ["0-2", 0, "master", "0", "2"],
    ["0", 0, "master", "0", null],
    ["1", 1, "note", "1", null], // 古い紙(1 から始めていた)
    ["12b3", 12, "note", "12b3", null],
  ])("%s", (raw, series, kind, base, idx) => {
    const f = parseFz(raw)!;
    expect(f).not.toBeNull();
    expect(f.series).toBe(series);
    expect(f.kind).toBe(kind);
    expect(f.base).toBe(base);
    expect(f.indexPart).toBe(idx);
  });
  it.each(["lal", "1a?-1", "a1", "1a-", "-1", "1a-1-1", "1a-a", "", "1 a 1 x?"])("正しくない: %s", (raw) => {
    expect(parseFz(raw)).toBeNull();
  });
  it("大文字・全角・空白・長いハイフンはそろえる", () => {
    expect(parseFz("１Ａ１－１")!.id).toBe("1a1-1");
    expect(parseFz(" 1 a 1 ")!.id).toBe("1a1");
  });
  it("前の兄弟(番号の抜けを見つけるため)", () => {
    expect(earlierSiblings("1d")).toEqual(["1a", "1b", "1c"]);
    expect(earlierSiblings("1a3")).toEqual(["1a1", "1a2"]);
    expect(earlierSiblings("1a1")).toEqual([]);
    expect(earlierSiblings("1a-2")).toEqual(["1a-1"]);
    expect(earlierSiblings("1a-1b")).toEqual(["1a-1a"]);
    expect(earlierSiblings("0-2")).toEqual(["0-1"]);
    expect(earlierSiblings("3")).toEqual([]); // 系列は飛んでよい
    expect(earlierSiblings("1a")).toEqual([]);
  });
  it("1 つ上", () => {
    expect(parentFz("1a1")).toBe("1a");
    expect(parentFz("1a")).toBe("1");
    expect(parentFz("1")).toBeNull();
    expect(parentFz("1a-1")).toBe("1a");
    expect(parentFz("1a1-1a")).toBe("1a1-1");
  });
});

describe("Folgezettel の並べ方", () => {
  it("指示書の例", () => {
    expect(sortFz(["1a2", "0-2", "1a1", "1a-1", "0-1a", "1a1-1", "1a", "0-1"])).toEqual(["0-1", "0-1a", "0-2", "1a-1", "1a", "1a1-1", "1a1", "1a2"]);
  });
  it("索引は対象の直前・索引の続きは索引の中で", () => {
    expect(sortFz(["1a", "1a-1b", "1a-1", "1a-1a", "1a-2", "1a1-1", "1a1", "1a1a", "1a2", "1b", "1b1"])).toEqual([
      "1a-1", "1a-1a", "1a-1b", "1a-2", "1a", "1a1-1", "1a1", "1a1a", "1a2", "1b", "1b1",
    ]);
  });
  it("数字は数として(1a2 < 1a10)・英字は長さ→文字(1z < 1aa)", () => {
    expect(sortFz(["1a10", "1a2", "1a1"])).toEqual(["1a1", "1a2", "1a10"]);
    expect(sortFz(["1aa", "1z", "1b"])).toEqual(["1b", "1z", "1aa"]);
    expect(sortFz(["10", "2", "1"])).toEqual(["1", "2", "10"]);
  });
  it("古い紙の並び(1, 1a, 1b, 1c, 2, 2a … 3, 3a, 3a1 … 3b)", () => {
    const want = ["1", "1a", "1b", "1c", "2", "2a", "2i", "3", "3a", "3a1", "3a7", "3b", "3b1", "4", "5"];
    expect(sortFz([...want].reverse())).toEqual(want);
  });
  it("正しくない ID は後ろ", () => {
    expect(sortFz(["?", "1a", "lal"])).toEqual(["1a", "?", "lal"]);
    expect(compareFz("1a", "1a")).toBe(0);
  });
});

describe("OCR の読みから決める", () => {
  const none = () => false;
  it("読みが全部同じで正しい形なら自動で確定", () => {
    expect(decideFz(["1a1", "1A1"], none)).toMatchObject({ fz: "1a1", status: "auto" });
  });
  it("読みが分かれたら要確認(自動で確定しない)", () => {
    const d = decideFz(["1a3", "1a8"], none);
    expect(d.status).toBe("review");
    expect(d.candidates).toEqual(expect.arrayContaining(["1a3", "1a8"]));
  });
  it("読みが分かれたら、ほかのページで使われていない方を先に出す", () => {
    const d = decideFz(["3a", "3a1"], none, (f) => f === "3a");
    expect(d).toMatchObject({ fz: "3a1", status: "review" });
    expect(d.candidates[0]).toBe("3a1");
    expect(decideFz(["3bl", "3b1"], none).fz).toBe("3b1");
  });
  it("lal は形が正しくないので要確認。候補に 1a1", () => {
    const d = decideFz(["lal", "lal"], none);
    expect(d.status).toBe("review");
    expect(d.candidates).toContain("1a1");
    expect(confusionFixes("lal")).toContain("1a1");
  });
  it("1a-1 と 1a1 の読み分かれは要確認", () => {
    expect(decideFz(["1a-1", "1a1"], none).status).toBe("review");
  });
  it("読みが 1 通りだけなら自動で確定しない", () => {
    expect(decideFz(["1a1"], none)).toMatchObject({ fz: "1a1", status: "review" });
  });
  it("前の兄弟が無ければ読み違いの疑い(1b を 1d と読んだ)", () => {
    const have = new Set(["1a", "1c"]);
    expect(missingSibling("1d", (f) => have.has(f))).toBe("1b");
    expect(missingSibling("1c", (f) => ["1a", "1b"].includes(f))).toBeNull();
    expect(missingSibling("4", () => false)).toBeNull();
  });
  it("読めない", () => {
    expect(decideFz(["", "?"], none)).toMatchObject({ fz: null, status: "review" });
  });
  it("同じ ID のページがすでにあれば要確認", () => {
    expect(decideFz(["2a", "2a"], (f) => f === "2a")).toMatchObject({ fz: "2a", status: "review" });
  });
});

function page(pid: string, fz: string | null, sha = pid): Omit<PaperPage, "seq"> {
  return { pid, fz, status: "auto", sha, source: { name: "s.pdf", sha: "s", page: 1 }, img: `paper/pages/${pid}.jpg`, thumb: "", crop: "", w: 1, h: 1, imported: "" };
}

describe("一覧・後から足す", () => {
  it("系列ごとに並び、0 は無くても入口として出る", () => {
    const ix = addPages(emptyIndex(), [page("a", "1a-1"), page("b", "1a"), page("c", "1a1"), page("d", "1a2"), page("e", "2a")]);
    const s = bySeries(ix);
    expect(s.map((x) => x.series)).toEqual([0, 1, 2]);
    expect(s[0]!.pages).toEqual([]);
    expect(s[1]!.pages.map((p) => p.fz)).toEqual(["1a-1", "1a", "1a1", "1a2"]);
  });
  it("後日の追加スキャンが正しい場所に入り、既存のページの内部IDは変わらない", () => {
    let ix = addPages(emptyIndex(), [page("a", "1a-1"), page("b", "1a"), page("c", "1a1"), page("d", "1a2"), page("e", "2a")]);
    const before = ix.pages.map((p) => ({ ...p }));
    ix = addPages(ix, [page("f", "1a1-1"), page("g", "1a1a"), page("h", "1a3"), page("i", "0-2")]);
    const s = bySeries(ix);
    expect(s[0]!.pages.map((p) => p.fz)).toEqual(["0-2"]);
    expect(s[1]!.pages.map((p) => p.fz)).toEqual(["1a-1", "1a", "1a1-1", "1a1", "1a1a", "1a2", "1a3"]);
    expect(s[2]!.pages.map((p) => p.fz)).toEqual(["2a"]);
    for (const b of before) expect(ix.pages.find((p) => p.pid === b.pid)).toEqual(b);
  });
  it("同じ ID の複数ページは取り込んだ順に並ぶ・重複として見つかる", () => {
    let ix = addPages(emptyIndex(), [page("x", "3"), page("y", "3a")]);
    ix = addPages(ix, [page("z", "3")]);
    expect(pagesWithFz(ix, "3").map((p) => p.pid)).toEqual(["x", "z"]);
    expect(duplicateFz(ix)).toEqual(["3"]);
  });
  it("ID を直しても内部IDはそのまま・記録が残る", () => {
    let ix = addPages(emptyIndex(), [page("a", "1a8")]);
    ix = setFz(ix, "a", "1A3");
    expect(ix.pages[0]).toMatchObject({ pid: "a", fz: "1a3", status: "manual" });
    expect(ix.pages[0]!.history).toEqual([{ fz: "1a8", at: expect.any(String) }]);
    expect(() => setFz(ix, "a", "1a?")).toThrow();
  });
  it("内部IDが重なったら足さない", () => {
    const ix = addPages(emptyIndex(), [page("a", "1")]);
    expect(() => addPages(ix, [page("a", "2")])).toThrow();
  });
});
