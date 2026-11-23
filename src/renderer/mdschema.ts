// 本文の形(ProseMirror の schema)と Markdown との往復。
// prosemirror-markdown の標準に、チェックリスト(「- [ ] 」「- [x] 」)と表(GFM の | a | b |)を足した。
import markdownit from "markdown-it";
import { MarkdownParser, MarkdownSerializer, type MarkdownSerializerState, defaultMarkdownParser, defaultMarkdownSerializer, schema as baseSchema } from "prosemirror-markdown";
import { Fragment, Schema, type Node as PMNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";

const nodes = baseSchema.spec.nodes
  .update("list_item", { ...baseSchema.spec.nodes.get("list_item")!, attrs: { checked: { default: null } } })
  .append({
    table: { content: "table_row+", group: "block", isolating: true, parseDOM: [{ tag: "table" }], toDOM: () => ["table", ["tbody", 0]] },
    table_row: { content: "(table_cell | table_header)+", parseDOM: [{ tag: "tr" }], toDOM: () => ["tr", 0] },
    table_header: { content: "inline*", isolating: true, parseDOM: [{ tag: "th" }], toDOM: () => ["th", 0] },
    table_cell: { content: "inline*", isolating: true, parseDOM: [{ tag: "td" }], toDOM: () => ["td", 0] },
  });
export const schema = new Schema({ nodes, marks: baseSchema.spec.marks });

const tokenizer = markdownit("commonmark", { html: false }).enable("table");
const parser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header" },
  td: { block: "table_cell" },
});

/** 「[ ] 」「[x] 」で始まる箇条書きの項目を、チェックリストの項目(checked 属性)にする */
function taskify(node: PMNode): PMNode {
  if (node.isLeaf) return node;
  const kids: PMNode[] = [];
  node.forEach((c) => kids.push(taskify(c)));
  const n = node.copy(Fragment.from(kids));
  if (n.type !== schema.nodes.list_item) return n;
  const p = n.firstChild;
  const m = p && p.type === schema.nodes.paragraph && p.firstChild?.isText ? /^\[([ xX])\] ?/.exec(p.firstChild.text ?? "") : null;
  if (!p || !m) return n;
  const rest: PMNode[] = [p.copy(p.content.cut(m[0].length))];
  n.forEach((c, _o, i) => i > 0 && rest.push(c));
  return schema.nodes.list_item.create({ checked: m[1] !== " " }, rest);
}

export function parseMarkdown(md: string): PMNode {
  const doc = parser.parse(md);
  return doc ? taskify(doc) : schema.node("doc", null, [schema.node("paragraph")]);
}

/** 表の 1 つのセルの中身を書く(| と改行は表を壊すので逃がす) */
function cellText(state: MarkdownSerializerState, cell: PMNode): void {
  const o = state as unknown as { out: string };
  const start = o.out.length;
  state.renderInline(cell);
  o.out = o.out.slice(0, start) + o.out.slice(start).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
}

const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    list_item(state, node) {
      if (node.attrs.checked != null) state.write(node.attrs.checked ? "[x] " : "[ ] ");
      state.renderContent(node);
    },
    table(state, node) {
      node.forEach((row, _o, i) => {
        row.forEach((cell, _o2, j) => {
          state.write(j ? " | " : "| ");
          cellText(state, cell);
        });
        state.write(" |");
        state.ensureNewLine();
        if (i === 0) {
          state.write("|" + " --- |".repeat(row.childCount));
          state.ensureNewLine();
        }
      });
      state.closeBlock(node);
    },
    table_row() {},
    table_header() {},
    table_cell() {},
  },
  defaultMarkdownSerializer.marks,
);

export function serializeMarkdown(doc: PMNode): string {
  const s = serializer.serialize(doc);
  return s ? s.replace(/\n+$/, "") + "\n" : "";
}

// ---------- 組み立て・操作 ----------

/** 空の表(最初の行は見出し) */
export function makeTable(cols: number, rows: number): PMNode {
  const row = (head: boolean) => schema.nodes.table_row.create(null, Array.from({ length: cols }, () => (head ? schema.nodes.table_header : schema.nodes.table_cell).create()));
  return schema.nodes.table.create(null, Array.from({ length: rows }, (_, i) => row(i === 0)));
}

/** 空のチェックリスト(項目 1 つ) */
export function makeChecklist(): PMNode {
  return schema.nodes.bullet_list.create(null, [schema.nodes.list_item.create({ checked: false }, [schema.nodes.paragraph.create()])]);
}

interface CellPos {
  tablePos: number; // 表の直前
  table: PMNode;
  row: number;
  col: number;
}
/** カーソルが表の中なら、その位置(何行目・何列目) */
export function cellAt(state: import("prosemirror-state").EditorState): CellPos | null {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) {
    if ($f.node(d).type !== schema.nodes.table_cell && $f.node(d).type !== schema.nodes.table_header) continue;
    return { tablePos: $f.before(d - 2), table: $f.node(d - 2), row: $f.index(d - 2), col: $f.index(d - 1) };
  }
  return null;
}

/** 表の (row, col) のセルの中へカーソルを移す */
function cursorTo(tr: import("prosemirror-state").Transaction, tablePos: number, table: PMNode, row: number, col: number) {
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1;
  const rowNode = table.child(row);
  for (let c = 0; c < col; c++) pos += rowNode.child(c).nodeSize;
  return tr.setSelection(TextSelection.create(tr.doc, pos + 1));
}

/** 下に行を足す(行は何行目の下か) */
export const addRowBelow: Command = (state, dispatch) => {
  const c = cellAt(state);
  if (!c) return false;
  if (dispatch) {
    const cols = c.table.child(0).childCount;
    const row = schema.nodes.table_row.create(null, Array.from({ length: cols }, () => schema.nodes.table_cell.create()));
    let at = c.tablePos + 1;
    for (let r = 0; r <= c.row; r++) at += c.table.child(r).nodeSize;
    const tr = state.tr.insert(at, row);
    dispatch(cursorTo(tr, c.tablePos, tr.doc.nodeAt(c.tablePos)!, c.row + 1, Math.min(c.col, cols - 1)).scrollIntoView());
  }
  return true;
};

/** 右に列を足す */
export const addColRight: Command = (state, dispatch) => {
  const c = cellAt(state);
  if (!c) return false;
  if (dispatch) {
    const tr = state.tr;
    // 後ろの行から足していく(位置がずれないように)
    let rowStart = c.tablePos + 1;
    const starts: number[] = [];
    c.table.forEach((r) => {
      starts.push(rowStart);
      rowStart += r.nodeSize;
    });
    for (let r = c.table.childCount - 1; r >= 0; r--) {
      const rowNode = c.table.child(r);
      let at = starts[r] + 1;
      for (let k = 0; k <= c.col; k++) at += rowNode.child(k).nodeSize;
      tr.insert(at, (r === 0 ? schema.nodes.table_header : schema.nodes.table_cell).create());
    }
    dispatch(cursorTo(tr, c.tablePos, tr.doc.nodeAt(c.tablePos)!, c.row, c.col + 1).scrollIntoView());
  }
  return true;
};

/** 表ごと消す */
export const deleteTable: Command = (state, dispatch) => {
  const c = cellAt(state);
  if (!c) return false;
  if (dispatch) dispatch(state.tr.delete(c.tablePos, c.tablePos + c.table.nodeSize).scrollIntoView());
  return true;
};

/** Tab: 次のセルへ(最後のセルなら行を足す)/ Shift+Tab: 前のセルへ */
export const nextCell: Command = (state, dispatch) => {
  const c = cellAt(state);
  if (!c) return false;
  const cols = c.table.child(c.row).childCount;
  if (c.col + 1 < cols) {
    if (dispatch) dispatch(cursorTo(state.tr, c.tablePos, c.table, c.row, c.col + 1).scrollIntoView());
    return true;
  }
  if (c.row + 1 < c.table.childCount) {
    if (dispatch) dispatch(cursorTo(state.tr, c.tablePos, c.table, c.row + 1, 0).scrollIntoView());
    return true;
  }
  return addRowBelow(state, dispatch);
};
export const prevCell: Command = (state, dispatch) => {
  const c = cellAt(state);
  if (!c) return false;
  let { row, col } = c;
  if (col > 0) col--;
  else if (row > 0) (row--, (col = c.table.child(row).childCount - 1));
  else return true;
  if (dispatch) dispatch(cursorTo(state.tr, c.tablePos, c.table, row, col).scrollIntoView());
  return true;
};
/** Enter: 1 つ下のセルへ(いちばん下なら行を足す)。セルの中では改行しない */
export const cellBelow: Command = (state, dispatch) => {
  const c = cellAt(state);
  if (!c) return false;
  if (c.row + 1 < c.table.childCount) {
    if (dispatch) dispatch(cursorTo(state.tr, c.tablePos, c.table, c.row + 1, Math.min(c.col, c.table.child(c.row + 1).childCount - 1)).scrollIntoView());
    return true;
  }
  return addRowBelow(state, dispatch);
};
