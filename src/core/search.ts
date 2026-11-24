// 検索の並び(2026-11-24 利用者): グループの名前 → グループの中身 → ノード の順。
// グループの中身 = そのグループの直下にある物(ノートも含む・引用も含む)の題と本文。
import type { Vault } from "./vault";
import { ROOT_ID } from "./types";

export interface SearchResult {
  /** 名前に当たったグループ */
  groups: string[];
  /** 直下の物に当たったグループ。hits は当たった中の物(先頭から数件) */
  contents: { id: string; hits: string[] }[];
  /** グループ以外で当たった物 */
  nodes: string[];
}

export function searchTiered(v: Vault, query: string, limit = 80): SearchResult {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: SearchResult = { groups: [], contents: [], nodes: [] };
  if (!words.length) return out;
  const hitIds = v.index.search(query, 2000);
  const named = new Set<string>();
  for (const id of hitIds) {
    const n = v.get(id);
    if (!n || n.type !== "group") continue;
    const t = (id === ROOT_ID ? "ホーム" : n.title).toLowerCase();
    if (words.every((w) => t.includes(w))) named.add(id);
  }
  out.groups = [...named].slice(0, limit);
  const byGroup = new Map<string, string[]>();
  for (const id of hitIds) {
    for (const g of [...v.parentsOf(id), ...v.quotedBy(id)]) {
      if (named.has(g) || g === ROOT_ID) continue; // ホームは何でも入っているので、中身の段には出さない
      let a = byGroup.get(g);
      if (!a) byGroup.set(g, (a = []));
      if (!a.includes(id)) a.push(id);
    }
  }
  out.contents = [...byGroup.entries()]
    .filter(([g]) => v.get(g)?.type === "group")
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, limit)
    .map(([id, hits]) => ({ id, hits: hits.slice(0, 3) }));
  out.nodes = hitIds.filter((id) => v.get(id)?.type !== "group").slice(0, limit);
  return out;
}
