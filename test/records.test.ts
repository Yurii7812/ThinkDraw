import { describe, expect, it } from "vitest";
import { cleanKind, parseKinds, parseRecordTitle, withDescendants } from "../src/core/records";

describe("記録の名前と種類", () => {
  it("2026-11-23-種類-題 を読む", () => {
    expect(parseRecordTitle("2026-11-23-日記")).toEqual({ date: "2026-11-23", kind: "日記", sub: "" });
    expect(parseRecordTitle("2026-11-23-夢日記-空を飛ぶ")).toEqual({ date: "2026-11-23", kind: "夢日記", sub: "空を飛ぶ" });
    expect(parseRecordTitle("2026-11-23-夢日記-空-を飛ぶ")?.sub).toBe("空-を飛ぶ");
    expect(parseRecordTitle("日記")).toBeNull();
    expect(parseRecordTitle("2026-11-23")).toBeNull();
  });
  it("種類の名前に - は使えない", () => {
    expect(cleanKind(" 夢-日記 ")).toBe("夢・日記");
  });
  it("壊れた・空の設定は日記だけ", () => {
    expect(parseKinds(null)).toEqual([{ name: "日記", parents: [] }]);
    expect(parseKinds("{")).toEqual([{ name: "日記", parents: [] }]);
  });
  it("上位は複数。上位を選ぶと下位(の下位)も入る", () => {
    const ks = [
      { name: "日記", parents: [] },
      { name: "夢日記", parents: ["日記", "睡眠"] },
      { name: "睡眠", parents: [] },
      { name: "悪夢", parents: ["夢日記"] },
    ];
    expect([...withDescendants(ks, "日記")].sort()).toEqual(["夢日記", "悪夢", "日記"].sort());
    expect([...withDescendants(ks, "睡眠")].sort()).toEqual(["夢日記", "悪夢", "睡眠"].sort());
  });
});
