import { describe, expect, it } from "vitest";
import { cleanKind, dayGroupTitle, parseDayGroup, parseKinds, parseRecordTitle, withDescendants } from "../src/core/records";

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
  it("壊れた・空の設定は種類なし(2026-11-24: 日記を必須にしない)。前に作った種類は読む", () => {
    expect(parseKinds(null)).toEqual([]);
    expect(parseKinds("{")).toEqual([]);
    expect(parseKinds(JSON.stringify({ kinds: [{ name: "日記", parents: [] }] }))).toEqual([{ name: "日記", parents: [] }]);
  });
  it("日付グループの名前: 先頭 10 文字が日付、その後の - より後ろ全部が題(題の中の - もそのまま)", () => {
    expect(parseDayGroup("2026-11-24")).toEqual({ date: "2026-11-24", title: "" });
    expect(parseDayGroup("2026-11-24-BRESUTOの設計を考えた日")).toEqual({ date: "2026-11-24", title: "BRESUTOの設計を考えた日" });
    expect(parseDayGroup("2026-11-24-A-B-C")?.title).toBe("A-B-C");
    expect(parseDayGroup("2026-02-30")).toBeNull();
    expect(parseDayGroup("2026-11")).toBeNull();
    expect(parseDayGroup("2026-11-24題")).toBeNull();
    expect(dayGroupTitle("2026-11-24", " 設計 ")).toBe("2026-11-24-設計");
    expect(dayGroupTitle("2026-11-24", "")).toBe("2026-11-24");
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
