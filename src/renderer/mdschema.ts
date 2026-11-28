// 本文の形(ProseMirror の schema)と Markdown との往復。
// prosemirror-markdown の標準に、チェックリスト(「- [ ] 」「- [x] 」)と表(GFM の | a | b |)を足した。
import markdownit from "markdown-it";
import { MarkdownParser, MarkdownSerializer, type MarkdownSerializerState, defaultMarkdownParser, defaultMarkdownSerializer, schema as baseSchema } from "prosemirror-markdown";
import { DOMSerializer, Fragment, Schema, Slice, type Node as PMNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { EditorState as PMState, TextSelection } from "prosemirror-state";
import { newAnchor } from "../core/cite";

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

// ---------- 空行を残す(2026-11-27 利用者「日記で行と行のあいだの空行が消える」) ----------
// 段落のあいだの空行は、書いたとおりの数だけ残す。Markdown では「1 つ余分な空行 = 空の段落 1 つ」とする
// (ファイルは見たままの空行なので、ほかのアプリで開いても同じに見える)。いちばん外側の段落だけ。
const EMPTY = "\uE000";
/** 余分な空行を、読むあいだだけの目印の段落にする(コードの中はそのまま) */
function markBlankLines(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  let blank = 0;
  let started = false;
  for (const l of lines) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) {
      out.push(l);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (!l.trim()) {
      blank++;
      continue;
    }
    // 前が空行だけなら: 始めの空行は全部、途中は 1 つより多い分を、空の段落に
    const extra = started ? blank - 1 : blank;
    if (blank) out.push("");
    for (let k = 0; k < extra; k++) out.push(EMPTY, "");
    blank = 0;
    started = true;
    out.push(l);
    if (f) fence = f[1];
  }
  return out.join("\n");
}
function unmarkBlankLines(doc: PMNode): PMNode {
  let hit = false;
  const kids: PMNode[] = [];
  doc.forEach((c) => {
    if (c.type === schema.nodes.paragraph && c.textContent === EMPTY) {
      hit = true;
      kids.push(schema.nodes.paragraph.create());
    } else kids.push(c);
  });
  return hit ? doc.copy(Fragment.from(kids)) : doc;
}

export function parseMarkdown(md: string): PMNode {
  const doc = parser.parse(markBlankLines(md));
  return doc ? unmarkBlankLines(taskify(doc)) : schema.node("doc", null, [schema.node("paragraph")]);
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
  // いちばん外側の空の段落は、目印にして書き、あとで空行 1 つに戻す
  let hit = false;
  const kids: PMNode[] = [];
  doc.forEach((c) => {
    if (c.type === schema.nodes.paragraph && c.content.size === 0) {
      hit = true;
      kids.push(schema.nodes.paragraph.create(null, schema.text(EMPTY)));
    } else kids.push(c);
  });
  let s = serializer.serialize(hit ? doc.copy(Fragment.from(kids)) : doc);
  if (hit) {
    s = s.replace(new RegExp(`^(${EMPTY}\n\n)+`), (m) => "\n".repeat(m.length / 3));
    s = s.replace(new RegExp(`\n\n${EMPTY}(?=\n|$)`, "g"), "\n");
    s = s.replace(new RegExp(`^${EMPTY}$`), "");
  }
  return s.replace(/\n+$/, "") ? s.replace(/\n+$/, "") + "\n" : "";
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

/** この行を消す(最後の 1 行なら表ごと。見出しの行を消したら、次の行が見出しになる) */
export const deleteRow: Command = (state, dispatch) => {
  const c = cellAt(state);
  if (!c) return false;
  if (c.table.childCount <= 1) return deleteTable(state, dispatch);
  if (dispatch) {
    const rows: PMNode[] = [];
    c.table.forEach((r, _o, i) => i !== c.row && rows.push(r));
    if (c.row === 0) rows[0] = schema.nodes.table_row.create(null, (() => { const cs: PMNode[] = []; rows[0].forEach((cell) => cs.push(schema.nodes.table_header.create(null, cell.content))); return cs; })());
    const table = schema.nodes.table.create(null, rows);
    const tr = state.tr.replaceWith(c.tablePos, c.tablePos + c.table.nodeSize, table);
    dispatch(cursorTo(tr, c.tablePos, table, Math.min(c.row, rows.length - 1), Math.min(c.col, rows[0].childCount - 1)).scrollIntoView());
  }
  return true;
};

/** この列を消す(最後の 1 列なら表ごと) */
export const deleteCol: Command = (state, dispatch) => {
  const c = cellAt(state);
  if (!c) return false;
  if (c.table.child(0).childCount <= 1) return deleteTable(state, dispatch);
  if (dispatch) {
    const rows: PMNode[] = [];
    c.table.forEach((r) => {
      const cs: PMNode[] = [];
      r.forEach((cell, _o, i) => i !== c.col && cs.push(cell));
      rows.push(schema.nodes.table_row.create(null, cs));
    });
    const table = schema.nodes.table.create(null, rows);
    const tr = state.tr.replaceWith(c.tablePos, c.tablePos + c.table.nodeSize, table);
    dispatch(cursorTo(tr, c.tablePos, table, c.row, Math.min(c.col, rows[0].childCount - 1)).scrollIntoView());
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
  return addColRight(state, dispatch); // 右のはしで Tab → 右に列が広がる(2026-11-26)
};

/** 空のセルで Backspace: その行がぜんぶ空なら行ごと、その列がぜんぶ空なら列ごと消す(表は残す) */
export const backspaceEmpty: Command = (state, dispatch, view) => {
  const c = cellAt(state);
  if (!c || !state.selection.empty) return false;
  if (c.table.child(c.row).child(c.col).content.size > 0) return false;
  const rowEmpty = (() => { let e = true; c.table.child(c.row).forEach((x) => x.content.size && (e = false)); return e; })();
  if (rowEmpty && c.table.childCount > 1) return deleteRow(state, dispatch, view);
  let colEmpty = true;
  c.table.forEach((r) => r.child(c.col).content.size && (colEmpty = false));
  if (colEmpty && c.table.child(0).childCount > 1) return deleteCol(state, dispatch, view);
  return false;
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

// ---------- キャンバスに見せる(チェックリスト・表の中身) ----------


const domSer = DOMSerializer.fromSchema(schema);
/** 本文をキャンバス用の DOM にする(チェックの箱は押せる。onToggle(何番目の項目か)) */
export function renderBodyDom(body: string, onToggle: (taskIndex: number) => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "cv-body";
  let ti = 0;
  const walk = (n: PMNode): Node => {
    const t = n.type.name;
    const kids = (el: HTMLElement) => {
      n.forEach((c) => el.append(walk(c)));
      return el;
    };
    if (t === "table") {
      const tb = document.createElement("table");
      return kids(tb.appendChild(document.createElement("tbody")) as HTMLElement) && tb;
    }
    if (t === "table_row") return kids(document.createElement("tr"));
    if (t === "table_header" || t === "table_cell") {
      const c = kids(document.createElement(t === "table_header" ? "th" : "td"));
      c.replaceChildren(domSer.serializeFragment(n.content));
      if (!n.content.size) c.append(document.createElement("br")); // 空のセルも、書くときと同じ高さに
      return c;
    }
    if (t === "bullet_list" || t === "ordered_list") return kids(document.createElement(t === "bullet_list" ? "ul" : "ol"));
    if (t === "list_item") {
      const li = document.createElement("li");
      if (n.attrs.checked != null) {
        const i = ti++;
        li.className = "task" + (n.attrs.checked ? " done" : "");
        li.style.listStyle = "none";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "task-box";
        box.checked = !!n.attrs.checked;
        box.addEventListener("mousedown", (e) => e.stopPropagation());
        box.addEventListener("click", (e) => {
          e.stopPropagation();
          onToggle(i);
        });
        li.append(box);
        const span = document.createElement("div");
        span.className = "task-body"; // 書いているときと同じ形
        n.forEach((c) => span.append(walk(c)));
        li.append(span);
        return li;
      }
      return kids(li);
    }
    if (t === "paragraph") {
      const p = document.createElement("p");
      p.append(domSer.serializeFragment(n.content));
      return p;
    }
    return domSer.serializeNode(n);
  };
  const doc = parseMarkdown(body);
  doc.forEach((c) => root.append(walk(c)));
  return root;
}

/** 本文のチェック項目のうち、何番目かの印を反対にした本文 */
export function toggleTask(body: string, taskIndex: number): string {
  const doc = parseMarkdown(body);
  let i = 0;
  let out = doc;
  doc.descendants((n, pos) => {
    if (n.type === schema.nodes.list_item && n.attrs.checked != null) {
      if (i++ === taskIndex) {
        const tr = n.type.create({ checked: !n.attrs.checked }, n.content);
        out = doc.replace(pos, pos + n.nodeSize, new Slice(Fragment.from(tr), 0, 0));
        return false;
      }
    }
    return true;
  });
  return serializeMarkdown(out);
}

/** まだ済んでいないチェック項目(文と、何番目か) */
export function openTasks(body: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  let i = 0;
  parseMarkdown(body).descendants((n) => {
    if (n.type === schema.nodes.list_item && n.attrs.checked != null) {
      const idx = i++;
      if (!n.attrs.checked) out.push({ text: (n.firstChild?.textContent ?? "").trim(), index: idx });
    }
    return true;
  });
  return out;
}

// ---------- 表・チェックリストへの貼り付け(2026-11-26 修正13。前の「何もない所に貼ると表・チェックリスト」はやめた) ----------

const lineSplit = (text: string): string[] => text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");

/** CSV の 1 行(「"」で囲んだ所のカンマ・「""」も) */
function csvLine(l: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) {
      if (c === '"' && l[i + 1] === '"') (cur += '"', i++);
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") (out.push(cur), (cur = ""));
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** 貼った文字をセルの並びに割る: タブがあればタブ、無ければカンマ(CSV)、無ければ空白(どの行も同じ数に割れるときだけ)、それも無ければ 1 行 1 セル */
export function splitCells(text: string): string[][] {
  const lines = lineSplit(text);
  if (lines.some((l) => l.includes("\t"))) return lines.map((l) => l.split("\t").map((x) => x.trim()));
  if (lines.some((l) => l.includes(","))) return lines.map((l) => csvLine(l).map((x) => x.trim()));
  const ws = lines.filter((l) => l.trim()).map((l) => l.trim().split(/[ 　]+/));
  if (ws.length && ws[0].length >= 2 && ws.every((r) => r.length === ws[0].length)) return lines.map((l) => (l.trim() ? l.trim().split(/[ 　]+/) : [""]));
  return lines.map((l) => [l.trim()]);
}

/** 表のセルの中で貼る: 今のセルから右・下へ埋める(足りなければ行・列を足す)。1 行で区切りも無い文字はふつうに貼る */
export const pasteIntoTable = (text: string): Command => (state, dispatch) => {
  const c = cellAt(state);
  if (!c) return false;
  // 1 行ならタブで割るときだけ(文の中の空白・カンマで割らない)
  const one = lineSplit(text).length === 1;
  const data = one ? [lineSplit(text)[0].split("\t").map((x) => x.trim())] : splitCells(text);
  if (data.length === 1 && data[0].length === 1) return false;
  if (dispatch) {
    const rows = Math.max(c.table.childCount, c.row + data.length);
    const cols = Math.max(c.table.child(0).childCount, c.col + Math.max(...data.map((r) => r.length)));
    const out: PMNode[] = [];
    for (let r = 0; r < rows; r++) {
      const cells: PMNode[] = [];
      for (let k = 0; k < cols; k++) {
        const type = r === 0 ? schema.nodes.table_header : schema.nodes.table_cell;
        const d = data[r - c.row]?.[k - c.col];
        if (d !== undefined) cells.push(type.create(null, d ? schema.text(d) : null));
        else {
          const old = r < c.table.childCount && k < c.table.child(r).childCount ? c.table.child(r).child(k) : null;
          cells.push(type.create(null, old?.content ?? null));
        }
      }
      out.push(schema.nodes.table_row.create(null, cells));
    }
    const table = schema.nodes.table.create(null, out);
    const tr = state.tr.replaceWith(c.tablePos, c.tablePos + c.table.nodeSize, table);
    const lr = c.row + data.length - 1;
    const lc = c.col + data[data.length - 1].length - 1;
    cursorTo(tr, c.tablePos, table, lr, lc);
    const end = tr.selection.$from.end();
    dispatch(tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView());
  }
  return true;
};

/** 箇条書き・番号・チェックの印を取る(空白はそのまま残す) */
const stripMark = (l: string) => l.trim().replace(/^(?:[-*・●○□☐]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, "");

export function inTaskItem(state: PMState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type === schema.nodes.list_item) return n.attrs.checked != null;
  }
  return false;
}

/** 改行ごとにチェック項目を作り、字下げを子のリストにする。 */
export const pasteIntoChecklist = (text: string): Command => (state, dispatch) => {
  const $f = state.selection.$from;
  let d = $f.depth;
  while (d > 0 && !($f.node(d).type === schema.nodes.list_item && $f.node(d).attrs.checked != null)) d--;
  if (d <= 0) return false;
  const lines = lineSplit(text).filter((l) => l.trim());
  if (lines.length < 2) return false;
  if (dispatch) {
    interface Item { indent: number; text: string; children: Item[] }
    const roots: Item[] = [], stack: Item[] = [];
    for (const line of lines) {
      const indent = /^[ \t\u3000]*/.exec(line)![0].replace(/\t/g, "    ").length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const next: Item = { indent, text: stripMark(line), children: [] };
      (stack[stack.length - 1]?.children ?? roots).push(next);
      stack.push(next);
    }
    const toNode = (i: Item): PMNode => {
      const content = [schema.nodes.paragraph.create(null, i.text ? schema.text(i.text) : null)];
      if (i.children.length) content.push(schema.nodes.bullet_list.create(null, i.children.map(toNode)));
      return schema.nodes.list_item.create({ checked: false }, content);
    };
    const items = roots.map(toNode);
    const item = $f.node(d);
    const empty = item.textContent.trim() === "" && item.childCount === 1;
    const from = $f.before(d), to = $f.after(d);
    const tr = empty ? state.tr.replaceWith(from, to, items) : state.tr.insert(to, items);
    const end = (empty ? from : to) + items.reduce((a, n) => a + n.nodeSize, 0);
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1)).scrollIntoView());
  }
  return true;
};

// ---------- ノートの文章の引用の目印(2026-11-26 修正14) ----------

/** 目印 [文章](#q-…) の所(最初から最後まで)。無ければ null */
export function findAnchor(doc: PMNode, anchor: string): { from: number; to: number } | null {
  let from = -1, to = -1;
  doc.descendants((n, pos) => {
    if (n.isText && n.marks.some((m) => m.type === schema.marks.link && m.attrs.href === "#" + anchor)) {
      if (from < 0) from = pos;
      to = pos + n.nodeSize;
    }
  });
  return from < 0 ? null : { from, to };
}

const normText = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * コピーした所(from〜to、text)に目印を付ける。位置が変わっていれば、同じ文章を 1 つの段落の中から探す。
 * もう目印がちょうどその所にあれば、それを使う。ほかのリンクにかかるときは付けない(null)
 */
export function anchorIn(doc: PMNode, c: { from: number; to: number; text: string }, samePositions: boolean): { doc: PMNode; anchor: string; changed: boolean } | null {
  let { from, to } = c;
  const ok = (f: number, t: number) => f >= 0 && t <= doc.content.size && f < t && normText(doc.textBetween(f, t, "\n")) === normText(c.text);
  if (!samePositions || !ok(from, to)) {
    from = to = -1;
    const want = c.text.trim();
    if (!want || want.includes("\n")) return null;
    doc.descendants((n, pos) => {
      if (from >= 0 || !n.isTextblock) return from < 0;
      const i = n.textContent.indexOf(want);
      if (i >= 0 && ok(pos + 1 + i, pos + 1 + i + want.length)) (from = pos + 1 + i), (to = from + want.length);
      return false;
    });
    if (from < 0) return null;
  }
  const links = new Set<string>();
  let plain = false;
  doc.nodesBetween(from, to, (n) => {
    if (!n.isText) return true;
    const l = n.marks.find((m) => m.type === schema.marks.link);
    if (l) links.add(l.attrs.href);
    else plain = true;
    return false;
  });
  if (links.size === 1 && !plain) {
    const href = [...links][0];
    if (/^#q-[a-z0-9]{8}$/.test(href)) return { doc, anchor: href.slice(1), changed: false }; // もう目印がある
  }
  if (links.size) return null;
  const anchor = newAnchor();
  const tr = PMState.create({ doc }).tr.addMark(from, to, schema.marks.link.create({ href: "#" + anchor }));
  return { doc: tr.doc, anchor, changed: true };
}
