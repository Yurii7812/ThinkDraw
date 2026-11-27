// 文章からマインドマップ(2026-11-27 利用者。質問票 br-1127b)。
// 受け付ける形: 字下げ(スペース・タブ。幅はいくつでもよい)・箇条書きの記号(- * + 1. 1))・Markdown の見出し(#)・
// OPML(Workflowy など)・FreeMind(.mm)・XMind(content.json / content.xml。zip を開くのは画面側)。
// 画面にも Electron にも依存しない。

export interface OutlineNode {
  title: string;
  children: OutlineNode[];
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decode(m[2] ?? m[3] ?? "") : null;
};

/** XML を、決まった名前のタグの入れ子として読む(OPML の outline・FreeMind の node) */
function xmlTree(src: string, tagName: string, titleOf: (tag: string) => string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const re = new RegExp(`<(/?)${tagName}\\b([^>]*?)(/?)>`, "gi");
  for (let m: RegExpExecArray | null; (m = re.exec(src)); ) {
    if (m[1]) {
      stack.pop();
      continue;
    }
    const n: OutlineNode = { title: titleOf(m[0]).replace(/\s+/g, " ").trim(), children: [] };
    (stack.length ? stack[stack.length - 1].children : roots).push(n);
    if (!m[3]) stack.push(n);
  }
  return prune(roots);
}

/** 題の無いものは、子を親へ上げて消す */
function prune(list: OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const n of list) {
    const kids = prune(n.children);
    if (n.title) out.push({ title: n.title, children: kids });
    else out.push(...kids);
  }
  return out;
}

/** XMind(新しい形)の content.json */
export function parseXmindJson(json: string): OutlineNode[] {
  const walk = (t: { title?: string; children?: { attached?: unknown[] } }): OutlineNode => ({
    title: String(t.title ?? "").replace(/\s+/g, " ").trim(),
    children: ((t.children?.attached ?? []) as (typeof t)[]).map(walk),
  });
  const sheets = JSON.parse(json) as { rootTopic?: object }[];
  return prune((Array.isArray(sheets) ? sheets : [sheets]).filter((s) => s?.rootTopic).map((s) => walk(s.rootTopic as never)));
}

/** XMind(古い形)の content.xml: <topic><title>…</title><children><topics><topic>… */
function parseXmindXml(src: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const re = /<(\/?)(topic|title)\b[^>]*?(\/?)>/gi;
  for (let m: RegExpExecArray | null; (m = re.exec(src)); ) {
    const tag = m[2].toLowerCase();
    if (tag === "topic") {
      if (m[1]) stack.pop();
      else {
        const n: OutlineNode = { title: "", children: [] };
        (stack.length ? stack[stack.length - 1].children : roots).push(n);
        if (!m[3]) stack.push(n);
      }
    } else if (!m[1] && !m[3] && stack.length) {
      const end = src.indexOf("</title>", re.lastIndex);
      if (end >= 0 && !stack[stack.length - 1].title) stack[stack.length - 1].title = decode(src.slice(re.lastIndex, end)).replace(/\s+/g, " ").trim();
    }
  }
  return prune(roots);
}

/** 字下げ・箇条書き・見出しの文章 */
function parseIndented(text: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  // 見出しは #1〜#6 の順位、ふつうの行は 10 + 字下げの幅(見出しの下に入る)。自分より順位の小さい、直前のものが親
  const stack: { rank: number; node: OutlineNode }[] = [];
  let fence = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence || !raw.trim()) continue;
    const line = raw.replace(/\t/g, "    ");
    let rank: number;
    let title: string;
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      rank = h[1].length;
      title = h[2];
    } else {
      const indent = /^ */.exec(line)![0].length;
      rank = 10 + indent;
      title = line
        .trim()
        .replace(/^([-*+•・]|\d+[.)])\s+/, "")
        .replace(/^\[[ xX]\]\s+/, "");
    }
    title = title.replace(/\s+/g, " ").trim();
    if (!title) continue;
    const node: OutlineNode = { title, children: [] };
    while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
    (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
    stack.push({ rank, node });
  }
  return roots;
}

/** 貼った・落とした文章を木にする。name はファイル名(わかれば。形の見分けに使う) */
export function parseOutline(text: string, name = ""): OutlineNode[] {
  const t = text.trim();
  if (/\.opml$/i.test(name) || /<opml[\s>]/i.test(t)) return xmlTree(t, "outline", (tag) => attr(tag, "text") ?? attr(tag, "title") ?? "");
  if (/\.mm$/i.test(name) || /^<map[\s>]/i.test(t)) return xmlTree(t, "node", (tag) => attr(tag, "TEXT") ?? "");
  if (/^\[\s*\{/.test(t) && t.includes("rootTopic")) return parseXmindJson(t);
  if (/<xmap-content[\s>]/i.test(t)) return parseXmindXml(t);
  return parseIndented(text);
}

export interface Box {
  w: number;
  h: number;
}
/**
 * マインドマップの並び。根を (cx, cy) の真ん中に置き、子は右(多いときは左右に分ける)へ段ごとに並べる。
 * size(i) は i 番目(深さ優先の順)の大きさ。返すのは同じ順の左上の位置。根がいくつもあれば縦に並べる。
 */
export function layoutOutline(roots: OutlineNode[], size: (i: number) => Box, cx: number, cy: number, gapX = 56, gapY = 12): { x: number; y: number }[] {
  const idx = new Map<OutlineNode, number>();
  let k = 0;
  const number = (n: OutlineNode) => {
    idx.set(n, k++);
    n.children.forEach(number);
  };
  roots.forEach(number);
  const out: { x: number; y: number }[] = new Array(k);
  const hOf = new Map<OutlineNode, number>();
  const H = (n: OutlineNode): number => {
    const own = size(idx.get(n)!).h;
    const kids = n.children.reduce((s, c) => s + H(c), 0) + gapY * Math.max(0, n.children.length - 1);
    const v = Math.max(own, kids);
    hOf.set(n, v);
    return v;
  };
  // side = 1 なら右へ、-1 なら左へ。edge = 親の側の縁の x
  const place = (n: OutlineNode, side: 1 | -1, edge: number, top: number) => {
    const b = size(idx.get(n)!);
    const hh = hOf.get(n)!;
    const x = side === 1 ? edge : edge - b.w;
    out[idx.get(n)!] = { x: Math.round(x), y: Math.round(top + hh / 2 - b.h / 2) };
    placeKids(n.children, side, side === 1 ? x + b.w + gapX : x - gapX, top + hh / 2);
  };
  const placeKids = (kids: OutlineNode[], side: 1 | -1, edge: number, mid: number) => {
    const total = kids.reduce((s, c) => s + hOf.get(c)!, 0) + gapY * Math.max(0, kids.length - 1);
    let y = mid - total / 2;
    for (const c of kids) {
      place(c, side, edge, y);
      y += hOf.get(c)! + gapY;
    }
  };
  let y0 = cy;
  for (const r of roots) {
    H(r);
    const b = size(idx.get(r)!);
    // 子が 4 つ以上なら、高さが釣り合うように前の方を右、残りを左へ(順番は変えない)
    let right = r.children, left: OutlineNode[] = [];
    if (r.children.length >= 4) {
      const all = r.children.reduce((s, c) => s + hOf.get(c)!, 0);
      let acc = 0, cut = r.children.length;
      for (let i = 0; i < r.children.length; i++) {
        acc += hOf.get(r.children[i])!;
        if (acc >= all / 2) {
          cut = i + 1;
          break;
        }
      }
      right = r.children.slice(0, cut);
      left = r.children.slice(cut);
    }
    const sideH = (l: OutlineNode[]) => l.reduce((s, c) => s + hOf.get(c)!, 0) + gapY * Math.max(0, l.length - 1);
    const tall = Math.max(b.h, sideH(right), sideH(left));
    const mid = y0 + tall / 2;
    const rx = Math.round(cx - b.w / 2);
    out[idx.get(r)!] = { x: rx, y: Math.round(mid - b.h / 2) };
    placeKids(right, 1, rx + b.w + gapX, mid);
    placeKids(left, -1, rx - gapX, mid);
    y0 += tall + 48;
  }
  return out;
}

/** 深さ優先の順に並べた木(layoutOutline の番号と同じ順) */
export function flattenOutline(roots: OutlineNode[]): { node: OutlineNode; parent: number }[] {
  const out: { node: OutlineNode; parent: number }[] = [];
  const walk = (n: OutlineNode, parent: number) => {
    const me = out.length;
    out.push({ node: n, parent });
    n.children.forEach((c) => walk(c, me));
  };
  roots.forEach((r) => walk(r, -1));
  return out;
}

/** 木を字下げの箇条書きに(書き出し・Ctrl+C 用) */
export function outlineToMarkdown(roots: OutlineNode[]): string {
  const lines: string[] = [];
  const walk = (n: OutlineNode, d: number) => {
    lines.push("  ".repeat(d) + "- " + n.title);
    n.children.forEach((c) => walk(c, d + 1));
  };
  roots.forEach((r) => walk(r, 0));
  return lines.join("\n") + (lines.length ? "\n" : "");
}
