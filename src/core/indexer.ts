// メモリ上の索引(SPEC 3.5): 親の逆引き・リンクの逆引き・全文検索の元。
// ノードが変わるたびに、その古い寄与を外し新しい寄与を足す(差分の更新)。

import { bodyLinkTargets } from "./links";
import type { TDNode } from "./types";

interface Contribution {
  members: string[];
  refs: string[];
  linkTargets: string[]; // 線と本文のリンクの両方
}

export class Index {
  /** 子 → それを含むグループ */
  private parents = new Map<string, Set<string>>();
  /** リンク先 → リンク元 */
  private backlinks = new Map<string, Set<string>>();
  /** 引用されているノード → 引用しているグループ */
  private quotedBy = new Map<string, Set<string>>();
  private contrib = new Map<string, Contribution>();
  private haystack = new Map<string, { title: string; body: string }>();

  clear(): void {
    this.parents.clear();
    this.backlinks.clear();
    this.quotedBy.clear();
    this.contrib.clear();
    this.haystack.clear();
  }

  update(id: string, node: TDNode | null): void {
    const old = this.contrib.get(id);
    if (old) {
      for (const c of old.members) this.parents.get(c)?.delete(id);
      for (const t of old.linkTargets) this.backlinks.get(t)?.delete(id);
      for (const r of old.refs) this.quotedBy.get(r)?.delete(id);
      this.contrib.delete(id);
      this.haystack.delete(id);
    }
    if (!node) return;
    const members = node.type === "group" ? [...new Set(node.members.map((m) => m.id))] : [];
    const refs = node.type === "group" ? [...new Set(node.refs.map((m) => m.id))] : [];
    for (const r of refs) {
      let s = this.quotedBy.get(r);
      if (!s) this.quotedBy.set(r, (s = new Set()));
      s.add(id);
    }
    const linkTargets = [...new Set([...node.links.map((l) => l.to), ...bodyLinkTargets(node.body)])].filter(
      (t) => t !== id,
    );
    for (const c of members) {
      let s = this.parents.get(c);
      if (!s) this.parents.set(c, (s = new Set()));
      s.add(id);
    }
    for (const t of linkTargets) {
      let s = this.backlinks.get(t);
      if (!s) this.backlinks.set(t, (s = new Set()));
      s.add(id);
    }
    this.contrib.set(id, { members, refs, linkTargets });
    this.haystack.set(id, { title: node.title.toLowerCase(), body: node.body.toLowerCase() });
  }

  parentsOf(id: string): string[] {
    return [...(this.parents.get(id) ?? [])];
  }
  quotedByOf(id: string): string[] {
    return [...(this.quotedBy.get(id) ?? [])];
  }
  backlinksOf(id: string): string[] {
    return [...(this.backlinks.get(id) ?? [])];
  }
  /** このノードから出るリンク(線と本文) */
  outlinksOf(id: string): string[] {
    return [...(this.contrib.get(id)?.linkTargets ?? [])];
  }

  /** anc が node の祖先(または同じ)か。親の逆引きを辿る */
  isAncestorOrSelf(anc: string, node: string): boolean {
    if (anc === node) return true;
    const seen = new Set<string>();
    const stack = [node];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const p of this.parents.get(cur) ?? []) {
        if (p === anc) return true;
        if (!seen.has(p)) {
          seen.add(p);
          stack.push(p);
        }
      }
    }
    return false;
  }

  /** 題と本文で検索する。語を空白で区切り、すべてを含むものを返す。題に当たるものを先に */
  search(query: string, limit = 50): string[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored: { id: string; score: number; title: string }[] = [];
    for (const [id, h] of this.haystack) {
      let score = 0;
      let ok = true;
      for (const w of words) {
        const inTitle = h.title.includes(w);
        if (!inTitle && !h.body.includes(w)) {
          ok = false;
          break;
        }
        score += inTitle ? (h.title.startsWith(w) ? 3 : 2) : 1;
      }
      if (ok) scored.push({ id, score, title: h.title });
    }
    scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ja") || a.id.localeCompare(b.id));
    return scored.slice(0, limit).map((s) => s.id);
  }
}
