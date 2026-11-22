// データモデル(SPEC 第 3 章)。画面にも Electron にも依存しない。

export type NodeType = "text" | "note" | "group" | "card";
export type LinkKind = "line" | "arrow" | "double" | "dashed" | "thick" | "oppose";
export const LINK_KINDS: LinkKind[] = ["line", "arrow", "double", "dashed", "thick", "oppose"];

export interface Member {
  id: string;
  x: number;
  y: number;
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
  color: number; // 0 は無し
  created: string;
  updated: string;
  members: Member[]; // type: group のみ意味を持つ
  links: Link[];
  card?: CardRef;
  spread?: SpreadRef;
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
    links: n.links.map((l) => ({ ...l })),
    card: n.card ? { ...n.card } : undefined,
    spread: n.spread ? { ...n.spread } : undefined,
    extra: JSON.parse(JSON.stringify(n.extra)),
  };
}
