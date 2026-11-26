// データモデル(SPEC 第 3 章)。画面にも Electron にも依存しない。

// frame = 枠(2026-11-24): 見た目だけの囲み。所属は変えない。枠そのものは 1 つの物で、線を引ける
// alias = 同じボードの中の引用(2026-11-24 利用者): target の物を、別の場所にもう 1 つ見せる。中身は持たない
export type NodeType = "text" | "note" | "group" | "card" | "frame" | "alias";
// part = 部分・全体(2026-11-24 統合仕様 3): to の側に小さな括弧「[」。括弧の側が部分、反対側が全体。所属には影響しない
export type LinkKind = "line" | "arrow" | "double" | "dashed" | "thick" | "oppose" | "part";
/** 読み込める種類(古い太線・対立も壊さない) */
export const LINK_KINDS: LinkKind[] = ["line", "arrow", "double", "dashed", "thick", "oppose", "part"];
/** 新しく選べる種類(統合仕様 4.1。太線・対立は選択肢から外した) */
export const NEW_LINK_KINDS: LinkKind[] = ["line", "arrow", "double", "dashed", "part"];

export interface Member {
  id: string;
  x: number;
  y: number;
  /** 画像の表示の幅(置いた場所ごと。無ければ元の大きさ) */
  w?: number;
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
  /** 線の色(0/無し = いつもの色、1〜8 = プリセット) */
  color?: number;
  /** 文字の位置(線の上の割合 0〜1。無ければ真ん中) */
  at?: number;
  /** 文字の大きさ(px。無ければ文章と同じ) */
  size?: number;
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
  /** 日付グループの @ マーカー(時系列記録だけに使う。2026-11-24 統合仕様 12) */
  markers?: string[];
  /** type: text のみ。ノートの文章の引用(「ノートID#q-目印」。2026-11-26 修正14) */
  cite?: string;
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
    markers: n.markers ? [...n.markers] : undefined,
    card: n.card ? { ...n.card, moving: n.card.moving ? [...n.card.moving] : undefined } : undefined,
    spread: n.spread ? { ...n.spread } : undefined,
    size: n.size ? { ...n.size } : undefined,
    extra: JSON.parse(JSON.stringify(n.extra)),
  };
}
