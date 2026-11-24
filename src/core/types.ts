// データモデル(SPEC 第 3 章)。画面にも Electron にも依存しない。

// frame = 枠(2026-11-24): 見た目だけの囲み。所属は変えない。枠そのものは 1 つの物で、線を引ける
// alias = 同じボードの中の引用(2026-11-24 利用者): target の物を、別の場所にもう 1 つ見せる。中身は持たない
export type NodeType = "text" | "note" | "group" | "card" | "frame" | "alias";
export type LinkKind = "line" | "arrow" | "double" | "dashed" | "thick" | "oppose";
export const LINK_KINDS: LinkKind[] = ["line", "arrow", "double", "dashed", "thick", "oppose"];

export interface Member {
  id: string;
  x: number;
  y: number;
}

/** ペンで描いた線(グループのキャンバスに属する)。p は x0,y0,x1,y1,… の平らな配列 */
export interface Stroke {
  id: string;
  c: number; // 色(0 = 文字と同じ色、1〜8 = プリセット)
  w: number; // 太さ
  hl?: boolean; // 蛍光ペン(半透明)
  p: number[];
}

export interface Link {
  to: string;
  kind: LinkKind;
  label?: string;
}

export interface CardRef {
  deck: string;
  id: string;
  reversed: boolean;
  /** 易: 変わる爻(0 = 初爻 … 5 = 上爻) */
  moving?: number[];
}

export interface SpreadRef {
  run: string;
  pos?: string; // 自由に引いたときは位置の名前なし
  spread?: string; // どのスプレッドで引いたか(装飾のラベルを引くのに使う)
}

export interface TDNode {
  id: string;
  title: string;
  type: NodeType;
  color: number; // 0 は無し(文字の色)
  fill?: number; // 文字の背景の色。無し/0 は背景なし
  file?: string; // 添付(assets/… の場所)。文字のノードがファイルを指す
  paper?: string; // 紙PKM のページ(内部ID p…)。文字のノードが紙のページを指す(紙の Folgezettel ID とは別)
  created: string;
  updated: string;
  members: Member[]; // type: group のみ意味を持つ。所属
  refs: Member[]; // type: group のみ。引用(ほかのグループの物を見せているだけ。所属には数えない)
  strokes: Stroke[]; // type: group のみ。ペンの線
  links: Link[];
  card?: CardRef;
  spread?: SpreadRef;
  /** type: frame のみ。枠の大きさ(位置は所属の x, y = 左上) */
  size?: { w: number; h: number };
  /** type: alias のみ。見せている元の物 */
  target?: string;
  body: string;
  /** 知らない frontmatter のキー(外部のエディタで足されたもの)。書き戻すときに残す */
  extra: Record<string, unknown>;
}

export const ROOT_ID = "root";
export const ROOT_TITLE = "ホーム";

export function isGroupType(t: NodeType): boolean {
  return t === "group";
}

/** 深い複製(undo の写しに使う) */
export function cloneNode(n: TDNode): TDNode {
  return {
    ...n,
    members: n.members.map((m) => ({ ...m })),
    refs: n.refs.map((m) => ({ ...m })),
    strokes: n.strokes.map((s) => ({ ...s, p: [...s.p] })),
    links: n.links.map((l) => ({ ...l })),
    card: n.card ? { ...n.card, moving: n.card.moving ? [...n.card.moving] : undefined } : undefined,
    spread: n.spread ? { ...n.spread } : undefined,
    size: n.size ? { ...n.size } : undefined,
    extra: JSON.parse(JSON.stringify(n.extra)),
  };
}
