// 2026-11-26 修正13: 表・チェックリストへの貼り付け / 表・チェックリストは記録にしない / 束ねたときの題
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { parseMarkdown, pasteIntoChecklist, pasteIntoTable, serializeMarkdown, splitCells } from "../src/renderer/mdschema";
import { autoGroupTitle } from "../src/core/grouptitle";

/** md の中の「@」の所にカーソルを置いた状態(@ は消す) */
function at(md: string): EditorState {
  const doc0 = parseMarkdown(md);
  let pos = -1;
  doc0.descendants((n, p) => {
    if (pos < 0 && n.isText && n.text!.includes("@")) pos = p + n.text!.indexOf("@");
  });
  let st = EditorState.create({ doc: doc0 });
  st = st.apply(st.tr.delete(pos, pos + 1));
  return st.apply(st.tr.setSelection(TextSelection.create(st.doc, pos)));
}
function run(st: EditorState, cmd: (s: EditorState, d: (tr: import("prosemirror-state").Transaction) => void) => boolean): string | null {
  let out: EditorState | null = null;
  const ok = cmd(st, (tr) => (out = st.apply(tr)));
  return ok && out ? serializeMarkdown((out as EditorState).doc).replace(/^\* /gm, "- ") : null; // 箇条書きの印は * で書かれる
}

describe("区切りの見分け", () => {
  it("タブ", () => expect(splitCells("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]));
  it("CSV(囲みのカンマも)", () => expect(splitCells('a,b\n"x,y",2')).toEqual([["a", "b"], ["x,y", "2"]]));
  it("空白(どの行も同じ数)", () => expect(splitCells("a b c\n1 2 3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]));
  it("ふつうの改行の文は 1 行 1 セル", () => expect(splitCells("牛乳を 買う\n卵")).toEqual([["牛乳を 買う"], ["卵"]]));
});

describe("表に貼る", () => {
  it("今のセルから埋めて、足りない行・列を足す", () => {
    const md = run(at("| @ | b |\n| --- | --- |\n| c | d |\n"), pasteIntoTable("1\t2\t3\n4\t5\t6\n7\t8\t9"));
    expect(md).toBe("| 1 | 2 | 3 |\n| --- | --- | --- |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n");
  });
  it("1 行の文(空白つき)はふつうに貼る", () => expect(run(at("| @ | b |\n| --- | --- |\n| c | d |\n"), pasteIntoTable("こんにちは 世界"))).toBeNull());
  it("表の外ではしない", () => expect(run(at("ふつう@の文\n"), pasteIntoTable("a\tb\nc\td"))).toBeNull());
});

describe("チェックリストに貼る", () => {
  it("空の項目に貼ると、1 行 1 項目(空白で割らない)", () => {
    const md = run(at("- [ ] @\n"), pasteIntoChecklist("牛乳を 2 本 買う\n- 卵\n3. 掃除"));
    expect(md).toBe("- [ ] 牛乳を 2 本 買う\n- [ ] 卵\n- [ ] 掃除\n");
  });
  it("書いてある項目の後ろに足す", () => {
    const md = run(at("- [ ] 前@\n"), pasteIntoChecklist("あ\nい"));
    expect(md).toBe("- [ ] 前\n- [ ] あ\n- [ ] い\n");
  });
  it("1 行だけならふつうに貼る", () => expect(run(at("- [ ] @\n"), pasteIntoChecklist("あ い"))).toBeNull());
});

describe("束ねたときの題(赤い背景の文字)", () => {
  const n = (id: string, title: string, fill: number, x: number, y: number) => ({ id, title, fill, type: "text" as const, x, y });
  it("その色の背景の文字のうち、左上のもの", () => expect(autoGroupTitle([n("a", "下", 1, 0, 100), n("b", "上の題", 1, 50, 0), n("c", "ふつう", 0, 0, 0)], 1)).toBe("上の題"));
  it("無ければ空", () => expect(autoGroupTitle([n("a", "x", 2, 0, 0)], 1)).toBe(""));
  it("0 = 切ってある", () => expect(autoGroupTitle([n("a", "x", 1, 0, 0)], 0)).toBe(""));
  it("@しるしや改行は 1 行目だけ", () => expect(autoGroupTitle([n("a", "題\n続き", 1, 0, 0)], 1)).toBe("題"));
});
