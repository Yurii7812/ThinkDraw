// vault(利用者が開いたフォルダ)の中身をメモリに持ち、操作の意味(SPEC 3.6)・元に戻す・自動保存を受け持つ。
// ファイルの読み書きそのものは VaultIO に任せる(本番は Electron の main、試験は一時ディレクトリ)。

import { parseNode, serializeNode } from "./frontmatter";
import { ID_RE, newId, nowIso } from "./ids";
import { Index } from "./indexer";
import { cloneNode, ROOT_ID, ROOT_TITLE, type CardRef, type Link, type LinkKind, type NodeType, type SpreadRef, type TDNode } from "./types";

export interface VaultIO {
  /** 一時ファイルに書いてからリネームする。.trash/ に同じ名前があれば消す(復元) */
  write(name: string, content: string): Promise<void>;
  /** .trash/ へ移す */
  trash(name: string, content: string): Promise<void>;
}

export class CycleError extends Error {
  constructor() {
    super("グループの中に、そのグループ自身(またはその親)は入れられません。");
  }
}

export interface FileEntry {
  name: string;
  content: string;
}

type Snap = TDNode | null;
interface UndoEntry {
  before: Map<string, Snap>;
  after: Map<string, Snap>;
}

export interface CreateOptions {
  type: NodeType;
  title?: string;
  body?: string;
  group: string;
  x: number;
  y: number;
  color?: number;
  card?: CardRef;
  spread?: SpreadRef;
  id?: string;
}

export function fileNameOf(id: string): string {
  return `${id}.md`;
}

export class Vault {
  readonly nodes = new Map<string, TDNode>();
  readonly index = new Index();
  /** 読み込めなかったファイル(報告用) */
  readonly broken: { name: string; error: string }[] = [];

  private dirty = new Set<string>();
  private onDisk = new Set<string>();
  /** 最後に自分で書いた中身(ファイル監視で自分の書き込みを無視するため) */
  private lastWritten = new Map<string, string>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private txDepth = 0;
  private txBefore: Map<string, Snap> | null = null;
  private listeners = new Set<(ids: Set<string>) => void>();
  private pendingChanged = new Set<string>();
  private flushing: Promise<void> | null = null;

  constructor(private io: VaultIO, private now: () => string = () => nowIso()) {}

  // ---------- 読み込み ----------

  /** 起動時の全ファイルの走査。根が無ければ作る。どこにも属さないノードは根に入れる */
  load(files: FileEntry[]): void {
    this.nodes.clear();
    this.index.clear();
    this.broken.length = 0;
    for (const f of files) {
      const id = f.name.replace(/\.md$/, "");
      if (id !== ROOT_ID && !ID_RE.test(id)) continue; // ThinkDraw のノードではない .md
      try {
        const n = parseNode(f.content, id);
        this.nodes.set(id, n);
        this.index.update(id, n);
        this.onDisk.add(id);
        this.lastWritten.set(f.name, f.content);
      } catch (e) {
        this.broken.push({ name: f.name, error: (e as Error).message });
      }
    }
    if (!this.nodes.has(ROOT_ID)) {
      const t = this.now();
      const root: TDNode = {
        id: ROOT_ID, title: ROOT_TITLE, type: "group", color: 0, created: t, updated: t,
        members: [], links: [], body: "", extra: {},
      };
      this.setRaw(ROOT_ID, root);
    } else if (this.nodes.get(ROOT_ID)!.type !== "group") {
      const r = this.nodes.get(ROOT_ID)!;
      r.type = "group";
      this.setRaw(ROOT_ID, r);
    }
    this.adoptOrphans();
    this.undoStack = [];
    this.redoStack = [];
  }

  /** どこにも属さないノードを根に入れる(読み込み時・外部変更の後) */
  private adoptOrphans(): void {
    const root = this.nodes.get(ROOT_ID)!;
    let k = 0;
    const orphans = [...this.nodes.keys()].filter((id) => id !== ROOT_ID && this.index.parentsOf(id).filter((p) => this.nodes.has(p)).length === 0).sort();
    if (!orphans.length) return;
    const maxY = root.members.reduce((a, m) => Math.max(a, m.y), 0);
    for (const id of orphans) {
      root.members.push({ id, x: (k % 6) * 180, y: maxY + 120 + Math.floor(k / 6) * 90 });
      k++;
    }
    this.setRaw(ROOT_ID, root);
  }

  // ---------- 参照 ----------

  get(id: string): TDNode | undefined {
    return this.nodes.get(id);
  }
  root(): TDNode {
    return this.nodes.get(ROOT_ID)!;
  }
  exists(id: string): boolean {
    return this.nodes.has(id);
  }
  /** 存在する親だけ */
  parentsOf(id: string): string[] {
    return this.index.parentsOf(id).filter((p) => this.nodes.get(p)?.type === "group");
  }
  backlinksOf(id: string): string[] {
    return this.index.backlinksOf(id).filter((p) => this.nodes.has(p));
  }
  /** キャンバスに描くメンバー(存在するものだけ) */
  membersOf(group: string): { id: string; x: number; y: number }[] {
    const g = this.nodes.get(group);
    if (!g || g.type !== "group") return [];
    return g.members.filter((m) => this.nodes.has(m.id));
  }
  memberPos(group: string, id: string): { x: number; y: number } | null {
    const m = this.nodes.get(group)?.members.find((m) => m.id === id);
    return m ? { x: m.x, y: m.y } : null;
  }
  /** 両方向のどちらかに線があれば返す */
  findLine(a: string, b: string): { from: string; link: Link } | null {
    const la = this.nodes.get(a)?.links.find((l) => l.to === b);
    if (la) return { from: a, link: la };
    const lb = this.nodes.get(b)?.links.find((l) => l.to === a);
    if (lb) return { from: b, link: lb };
    return null;
  }
  newId(): string {
    return newId((id) => this.nodes.has(id) || this.onDisk.has(id));
  }

  onChange(fn: (ids: Set<string>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- 取引(元に戻すの単位) ----------

  tx<T>(fn: () => T): T {
    if (this.txDepth === 0) this.txBefore = new Map();
    this.txDepth++;
    try {
      return fn();
    } finally {
      this.txDepth--;
      if (this.txDepth === 0) this.commitTx();
    }
  }

  private commitTx(): void {
    const before = this.txBefore!;
    this.txBefore = null;
    const after = new Map<string, Snap>();
    const t = this.now();
    for (const id of before.keys()) {
      const cur = this.nodes.get(id) ?? null;
      const b = before.get(id) ?? null;
      if (cur && b && serializeNode(cur) === serializeNode(b)) {
        before.delete(id);
        continue;
      }
      if (cur) cur.updated = t;
      after.set(id, cur ? cloneNode(cur) : null);
      if (cur) this.index.update(id, cur);
    }
    if (after.size) {
      this.undoStack.push({ before, after });
      if (this.undoStack.length > 300) this.undoStack.shift();
      this.redoStack = [];
    }
    this.emit();
  }

  /** 変更する前に呼ぶ。最初の 1 回だけ、元の状態を写す */
  private touch(id: string): void {
    if (!this.txBefore) throw new Error("touch は tx の中で呼ぶ");
    if (!this.txBefore.has(id)) {
      const cur = this.nodes.get(id);
      this.txBefore.set(id, cur ? cloneNode(cur) : null);
    }
    this.dirty.add(id);
    this.pendingChanged.add(id);
  }

  private mut(id: string): TDNode {
    this.touch(id);
    const n = this.nodes.get(id);
    if (!n) throw new Error(`ノードがありません: ${id}`);
    return n;
  }

  /** 取引の外で、元に戻すに積まずに状態を置く(読み込み・外部変更・undo の適用) */
  private setRaw(id: string, n: TDNode | null): void {
    if (n) this.nodes.set(id, n);
    else this.nodes.delete(id);
    this.index.update(id, n);
    this.dirty.add(id);
    this.pendingChanged.add(id);
  }

  private emit(): void {
    if (!this.pendingChanged.size) return;
    const ids = this.pendingChanged;
    this.pendingChanged = new Set();
    for (const fn of this.listeners) fn(ids);
  }

  /** 元に戻すは、キャンバスと所属の操作だけ。本文はポップアップのエディタの履歴に任せ、今の本文を保つ */
  private restoreSnap(id: string, s: Snap): TDNode | null {
    if (!s) return null;
    const n = cloneNode(s);
    const cur = this.nodes.get(id);
    if (cur) n.body = cur.body;
    return n;
  }

  /** 本文の書き換え(元に戻すには積まない。restoreSnap を参照) */
  setBody(id: string, body: string): void {
    const n = this.nodes.get(id);
    if (!n || n.body === body) return;
    n.body = body;
    n.updated = this.now();
    this.setRaw(id, n);
    this.emit();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    for (const [id, s] of e.before) this.setRaw(id, this.restoreSnap(id, s));
    this.redoStack.push(e);
    this.emit();
    return true;
  }
  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    for (const [id, s] of e.after) this.setRaw(id, this.restoreSnap(id, s));
    this.undoStack.push(e);
    this.emit();
    return true;
  }

  // ---------- 作る・直す ----------

  create(o: CreateOptions): TDNode {
    return this.tx(() => {
      const id = o.id ?? this.newId();
      const t = this.now();
      const n: TDNode = {
        id, title: o.title ?? "", type: o.type, color: o.color ?? 0, created: t, updated: t,
        members: [], links: [], body: o.body ?? "", extra: {},
      };
      if (o.card) n.card = { ...o.card };
      if (o.spread) n.spread = { ...o.spread };
      this.touch(id);
      this.nodes.set(id, n);
      this.index.update(id, n);
      this.addToGroup(o.group, id, o.x, o.y);
      return n;
    });
  }

  update(id: string, patch: { title?: string; body?: string; color?: number }): void {
    this.tx(() => {
      const n = this.mut(id);
      if (patch.title !== undefined) n.title = patch.title;
      if (patch.body !== undefined) n.body = patch.body;
      if (patch.color !== undefined) n.color = patch.color;
    });
  }

  setCard(id: string, card: CardRef): void {
    this.tx(() => {
      this.mut(id).card = { ...card };
    });
  }

  move(group: string, positions: { id: string; x: number; y: number }[]): void {
    this.tx(() => {
      const g = this.mut(group);
      for (const p of positions) {
        const m = g.members.find((m) => m.id === p.id);
        if (m) {
          m.x = p.x;
          m.y = p.y;
        }
      }
    });
  }

  // ---------- 線 ----------

  addLink(from: string, to: string, kind: LinkKind = "line"): void {
    if (from === to) return;
    this.tx(() => {
      if (this.findLine(from, to)) return;
      this.mut(from).links.push({ to, kind });
    });
  }
  removeLink(a: string, b: string): void {
    this.tx(() => {
      for (const [x, y] of [[a, b], [b, a]]) {
        const n = this.nodes.get(x);
        if (n && n.links.some((l) => l.to === y)) {
          const m = this.mut(x);
          m.links = m.links.filter((l) => l.to !== y);
        }
      }
    });
  }
  /** 線があれば外し、無ければ引く(ノードからノードへのドラッグ) */
  toggleLink(from: string, to: string, kind: LinkKind = "line"): "added" | "removed" | "none" {
    if (from === to) return "none";
    return this.tx(() => {
      if (this.findLine(from, to)) {
        this.removeLink(from, to);
        return "removed";
      }
      this.addLink(from, to, kind);
      return "added";
    });
  }
  setLinkKind(from: string, to: string, kind: LinkKind): void {
    this.tx(() => {
      const l = this.mut(from).links.find((l) => l.to === to);
      if (l) l.kind = kind;
    });
  }
  setLinkLabel(from: string, to: string, label: string): void {
    this.tx(() => {
      const l = this.mut(from).links.find((l) => l.to === to);
      if (!l) return;
      if (label) l.label = label;
      else delete l.label;
    });
  }
  /** 向きを逆にする: リンクを、もう一方のノードの links へ移す */
  reverseLink(from: string, to: string): void {
    this.tx(() => {
      const a = this.mut(from);
      const l = a.links.find((l) => l.to === to);
      if (!l) return;
      a.links = a.links.filter((x) => x !== l);
      const b = this.mut(to);
      b.links = b.links.filter((x) => x.to !== from);
      const moved: Link = { to: from, kind: l.kind };
      if (l.label) moved.label = l.label;
      b.links.push(moved);
    });
  }

  // ---------- 所属 ----------

  /** child を group に入れてよいか(循環しないか) */
  canContain(group: string, child: string): boolean {
    const g = this.nodes.get(group);
    if (!g || g.type !== "group") return false;
    if (child === ROOT_ID) return false; // 根は、どのグループにも入れられない
    const c = this.nodes.get(child);
    if (c?.type === "group" && this.index.isAncestorOrSelf(child, group)) return false;
    return true;
  }

  /** 入れる: members に足す(元の所属は残る)。すでに入っていれば何もしない */
  addToGroup(group: string, child: string, x: number, y: number): void {
    if (!this.canContain(group, child)) throw new CycleError();
    this.tx(() => {
      const g = this.mut(group);
      if (g.members.some((m) => m.id === child)) return;
      g.members.push({ id: child, x, y });
      this.index.update(group, g);
    });
  }

  /** 外す: このグループの members から抜く。最後の所属なら根に入る。根が最後の所属なら何もしない(false) */
  removeFromGroup(group: string, child: string): boolean {
    const parents = this.parentsOf(child);
    if (!parents.includes(group)) return false;
    if (group === ROOT_ID && parents.length === 1) return false;
    this.tx(() => {
      const pos = this.memberPos(group, child)!;
      const g = this.mut(group);
      g.members = g.members.filter((m) => m.id !== child);
      this.index.update(group, g);
      if (this.parentsOf(child).length === 0) this.addToGroup(ROOT_ID, child, pos.x, pos.y);
    });
    return true;
  }

  /** 別のグループへ移す(入れる + 外す) */
  moveToGroup(from: string, to: string, child: string, x: number, y: number): void {
    if (!this.canContain(to, child)) throw new CycleError();
    this.tx(() => {
      this.addToGroup(to, child, x, y);
      this.removeFromGroup(from, child);
    });
  }

  /** 削除: .trash/ へ。どのグループの members からも消える。グループなら、親を失った中身は根へ */
  trash(ids: string[]): void {
    const targets = ids.filter((id) => id !== ROOT_ID && this.nodes.has(id));
    if (!targets.length) return;
    this.tx(() => {
      const gone = new Set(targets);
      for (const id of targets) {
        for (const p of this.parentsOf(id)) {
          const g = this.mut(p);
          g.members = g.members.filter((m) => m.id !== id);
          this.index.update(p, g);
        }
      }
      for (const id of targets) {
        const n = this.nodes.get(id)!;
        const children = n.type === "group" ? n.members.filter((m) => this.nodes.has(m.id) && !gone.has(m.id)) : [];
        this.touch(id);
        this.nodes.delete(id);
        this.index.update(id, null);
        for (const c of children) {
          if (this.parentsOf(c.id).length === 0) this.addToGroup(ROOT_ID, c.id, c.x, c.y);
        }
      }
    });
  }

  /** 束ねる: 選んだノードから新しいグループを作り、元の場所にそのグループを置く */
  bundle(group: string, ids: string[], title = ""): TDNode {
    const picked = ids.filter((id) => id !== ROOT_ID && this.memberPos(group, id));
    if (!picked.length) throw new Error("束ねるノードがありません");
    return this.tx(() => {
      const pos = picked.map((id) => ({ id, ...this.memberPos(group, id)! }));
      const cx = pos.reduce((a, p) => a + p.x, 0) / pos.length;
      const cy = pos.reduce((a, p) => a + p.y, 0) / pos.length;
      const g = this.create({ type: "group", title, group, x: Math.round(cx), y: Math.round(cy) });
      const gm = this.mut(g.id);
      for (const p of pos) gm.members.push({ id: p.id, x: Math.round(p.x - cx), y: Math.round(p.y - cy) });
      this.index.update(g.id, gm);
      const parent = this.mut(group);
      parent.members = parent.members.filter((m) => !picked.includes(m.id));
      this.index.update(group, parent);
      return gm;
    });
  }

  /** 解く: グループを解散。中のノードは、そのグループの親すべてに(グループの位置に)足す */
  unbundle(groupId: string): void {
    const g = this.nodes.get(groupId);
    if (!g || g.type !== "group" || groupId === ROOT_ID) return;
    this.tx(() => {
      const members = this.membersOf(groupId);
      const cx = members.length ? members.reduce((a, m) => a + m.x, 0) / members.length : 0;
      const cy = members.length ? members.reduce((a, m) => a + m.y, 0) / members.length : 0;
      for (const p of this.parentsOf(groupId)) {
        const gp = this.memberPos(p, groupId)!;
        for (const m of members) {
          if (this.memberPos(p, m.id)) continue;
          this.addToGroup(p, m.id, Math.round(gp.x + m.x - cx), Math.round(gp.y + m.y - cy));
        }
      }
      this.trash([groupId]);
    });
  }

  // ---------- 保存 ----------

  hasPendingWrites(): boolean {
    return this.dirty.size > 0;
  }

  /** 変更のあったノードを書く(まとめて) */
  async flush(): Promise<void> {
    while (this.flushing) await this.flushing;
    if (!this.dirty.size) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    const run = (async () => {
      for (const id of ids) {
        const name = fileNameOf(id);
        const n = this.nodes.get(id);
        try {
          if (n) {
            const content = serializeNode(n);
            if (this.lastWritten.get(name) === content && this.onDisk.has(id)) continue;
            this.lastWritten.set(name, content);
            await this.io.write(name, content);
            this.onDisk.add(id);
          } else if (this.onDisk.has(id)) {
            const content = this.lastWritten.get(name) ?? "";
            this.lastWritten.delete(name);
            await this.io.trash(name, content);
            this.onDisk.delete(id);
          }
        } catch (e) {
          this.dirty.add(id); // 次の機会に書き直す
          throw e;
        }
      }
    })();
    this.flushing = run;
    try {
      await run;
    } finally {
      this.flushing = null;
    }
  }

  /** 外部のエディタでファイルが変わった(content=null は消えた)。変わったら true */
  applyExternal(name: string, content: string | null): boolean {
    const id = name.replace(/\.md$/, "");
    if (id !== ROOT_ID && !ID_RE.test(id)) return false;
    if (content === null) {
      if (!this.nodes.has(id) || id === ROOT_ID) return false;
      // 自分で .trash/ へ移した直後の通知は、すでにメモリから消えているので上で弾かれる
      this.nodes.delete(id);
      this.index.update(id, null);
      this.onDisk.delete(id);
      this.lastWritten.delete(name);
      this.pendingChanged.add(id);
    } else {
      if (this.lastWritten.get(name) === content) return false;
      let n: TDNode;
      try {
        n = parseNode(content, id);
      } catch {
        return false; // 書きかけで壊れている。次の変更を待つ
      }
      this.nodes.set(id, n);
      this.index.update(id, n);
      this.onDisk.add(id);
      this.lastWritten.set(name, content);
      this.pendingChanged.add(id);
    }
    // 外から変わったものと、元に戻すの写しが食い違わないように、履歴は捨てる
    this.undoStack = [];
    this.redoStack = [];
    this.adoptOrphans();
    this.emit();
    return true;
  }
}
