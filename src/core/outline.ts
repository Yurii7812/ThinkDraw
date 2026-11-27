// 文章からマインドマップ(2026-11-27 利用者。質問票 br-1127b)。
// 受け付ける形: 字下げ(スペース・タブ。幅はいくつでもよい)・箇条書きの記号(- * + 1. 1))・Markdown の見出し(#)・
// OPML(Workflowy など)・FreeMind(.mm)・XMind(content.json / content.xml。zip を開くのは画面側)。
// 画面にも Electron にも依存しない。

export interface OutlineNode {
  title: string;
  children: OutlineNode[];
  /** 親からの線の言葉(「A →(原因) B」の 原因) */
  label?: string;
  /** 親からの線が矢印か(→ で書いた) */
  arrow?: boolean;
}
/** 木のほかの線(番号 (n) で指した所へ。網になる所) */
export interface OutlineLink {
  from: OutlineNode;
  to: OutlineNode;
  label?: string;
  arrow?: boolean;
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

/**
 * 字下げ・箇条書き・見出しの文章(2026-11-27)。網にする書き方も読む(AI にも書きやすいように、記号は少しだけ):
 * - 「(1) 気候変動」= この物に 1 番を付ける。ほかの所で「(1)」とだけ書くと、同じ物を指す(線がつながる)
 * - 「A → B」「A -> B」= A から B へ矢印。「A →(原因) B」で線に言葉。「A → B → C」も
 * - 同じ言葉でも、別々に書けば別の物(まとめない)
 */
function parseIndented(text: string): { roots: OutlineNode[]; links: OutlineLink[] } {
  const roots: OutlineNode[] = [];
  const links: OutlineLink[] = [];
  const named = new Map<string, OutlineNode>();
  // 番号は後ろで付けてもよいので、最後にまとめて探す。from / parent は物か番号
  type End = OutlineNode | { ref: string };
  const pendLinks: { from: End; to: string; label?: string; arrow?: boolean }[] = [];
  const pendKids: { parent: string; node: OutlineNode }[] = [];
  // 見出しは #1〜#6 の順位、ふつうの行は 10 + 字下げの幅(見出しの下に入る)。自分より順位の小さい、直前のものが親
  const stack: { rank: number; node: OutlineNode }[] = [];
  let fence = false;
  /** 「(n) 文」「(n)」「文」を読む */
  const piece = (t: string): { ref?: string; title: string } => {
    const m = /^\((\d{1,4}|[a-zA-Z][\w-]{0,15})\)\s*(.*)$/.exec(t.trim());
    return m ? { ref: m[1], title: m[2].trim() } : { title: t.trim() };
  };
  const ARROW = /\s*(?:→|->|⇒)(?:\(([^()]*)\))?\s*/;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence || !raw.trim()) continue;
    const line = raw.replace(/\t/g, "    ");
    let rank: number;
    let body: string;
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      rank = h[1].length;
      body = h[2];
    } else {
      rank = 10 + /^ */.exec(line)![0].length;
      body = line
        .trim()
        .replace(/^([-*+•・]|\d+[.)])\s+/, "")
        .replace(/^\[[ xX]\]\s+/, "");
    }
    body = body.replace(/\s+/g, " ").trim();
    if (!body) continue;
    // 矢印で分ける: [文, 言葉, 文, 言葉, 文 …]
    const parts: { text: string; label?: string }[] = [];
    let rest = body;
    let lab: string | undefined;
    for (let m: RegExpExecArray | null; (m = ARROW.exec(rest)); ) {
      parts.push({ text: rest.slice(0, m.index), label: lab });
      lab = m[1]?.trim() || undefined;
      rest = rest.slice(m.index + m[0].length);
    }
    parts.push({ text: rest, label: lab });
    while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : null;
    // 1 つ目: 木の中の物(番号だけなら、前・後の番号の物を指す)
    const first = piece(parts[0].text);
    let cur: OutlineNode | null = null;
    let curRef: string | null = null;
    if (first.ref && !first.title) {
      curRef = first.ref;
      if (parent) pendLinks.push({ from: parent, to: first.ref }); // 字下げの中の「(n)」= 親から (n) へ線
    } else if (first.title) {
      cur = { title: first.title, children: [] };
      if (first.ref) named.set(first.ref, cur);
      (parent ? parent.children : roots).push(cur);
      stack.push({ rank, node: cur });
    } else continue;
    // 2 つ目から: 矢印の先
    for (const p of parts.slice(1)) {
      const q = piece(p.text);
      if (!q.title && !q.ref) continue;
      if (q.ref && !q.title) {
        // 番号の物へ線(あとで探す)
        const from: End | null = cur ?? (curRef ? { ref: curRef } : null);
        if (from) pendLinks.push({ from, to: q.ref, label: p.label, arrow: true });
        curRef = q.ref;
        cur = null;
        continue;
      }
      const n: OutlineNode = { title: q.title, children: [], label: p.label, arrow: true };
      if (q.ref) named.set(q.ref, n);
      if (cur) cur.children.push(n);
      else if (curRef) pendKids.push({ parent: curRef, node: n }); // 「(1) → 文」: 文は (1) の子として並べる
      else roots.push(n);
      cur = n;
      curRef = null;
    }
  }
  // 番号を探す(書いていない番号は、その番号の物を作る)
  const find = (ref: string) => {
    let n = named.get(ref);
    if (!n) {
      n = { title: `(${ref})`, children: [] };
      named.set(ref, n);
      roots.push(n);
    }
    return n;
  };
  for (const k of pendKids) find(k.parent).children.push(k.node);
  for (const l of pendLinks) links.push({ from: "ref" in l.from ? find(l.from.ref) : l.from, to: find(l.to), label: l.label, arrow: l.arrow });
  return { roots, links };
}

/** 貼った・落とした文章を木にする。name はファイル名(わかれば。形の見分けに使う) */
export function parseOutline(text: string, name = ""): OutlineNode[] {
  return parseOutlineGraph(text, name).roots;
}
/** 木と、木のほかの線(番号で指した所)。名前はファイル名(わかれば) */
export function parseOutlineGraph(text: string, name = ""): { roots: OutlineNode[]; links: OutlineLink[] } {
  const tree = (roots: OutlineNode[]) => ({ roots, links: [] as OutlineLink[] });
  const t = text.trim();
  if (/\.opml$/i.test(name) || /<opml[\s>]/i.test(t)) return tree(xmlTree(t, "outline", (tag) => attr(tag, "text") ?? attr(tag, "title") ?? ""));
  if (/\.mm$/i.test(name) || /^<map[\s>]/i.test(t)) return tree(xmlTree(t, "node", (tag) => attr(tag, "TEXT") ?? ""));
  if (/^\[\s*\{/.test(t) && t.includes("rootTopic")) return tree(parseXmindJson(t));
  if (/<xmap-content[\s>]/i.test(t)) return tree(parseXmindXml(t));
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
export function layoutOutline(roots: OutlineNode[], size: (i: number) => Box, cx: number, cy: number, gapX = 64, gapY = 12): { x: number; y: number }[] {
  // 線に言葉があれば、その分だけ間を広げる(言葉で線が隠れないように)
  const gapOf = (n: OutlineNode) => gapX + (n.label ? [...n.label].length * 15 + 40 : 0) + (n.arrow ? 10 : 0);
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
  // side = 1 なら右へ、-1 なら左へ。edge = 親の縁の x(子は そこから gapOf だけ離す)
  const place = (n: OutlineNode, side: 1 | -1, edge: number, top: number) => {
    const b = size(idx.get(n)!);
    const hh = hOf.get(n)!;
    const x = side === 1 ? edge + gapOf(n) : edge - gapOf(n) - b.w;
    out[idx.get(n)!] = { x: Math.round(x), y: Math.round(top + hh / 2 - b.h / 2) };
    placeKids(n.children, side, side === 1 ? x + b.w : x, top + hh / 2);
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
    placeKids(right, 1, rx + b.w, mid);
    placeKids(left, -1, rx, mid);
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
