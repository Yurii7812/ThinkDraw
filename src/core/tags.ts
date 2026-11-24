// @ のしるし(2026-11-24 利用者): 文字やノートに「@読書」と書くと、それが時系列記録のしるしになる。
// 日付グループのマーカー・記録の種類と同じ名前の集まりとして扱う(@ の候補も、Ctrl+J の一覧も同じ)。
import type { Vault } from "./vault";
import { parseDayGroup, parseRecordTitle } from "./records";

// 前が行頭・空白・かっこ・句読点のときだけ(メールアドレスの @ などは拾わない)
const TAG = /(^|[\s　(（「『、。,，])@([^\s　@#、。,，.．!?！？()（）「」『』[\]]+)/g;

/** 文の中の @しるし(重なりは 1 つ) */
export function tagsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TAG)) if (!out.includes(m[2])) out.push(m[2]);
  return out;
}

/** 文を、ふつうの所と @しるし に分ける(表示用) */
export function splitTags(text: string): { text: string; tag?: string }[] {
  const out: { text: string; tag?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    const at = m.index! + m[1].length;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: "@" + m[2], tag: m[2] });
    last = at + 1 + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** その物の日付: 入っている日付グループの日付、無ければ作った日 */
export function dateOf(v: Vault, id: string): string {
  for (const g of v.parentsOf(id)) {
    const d = parseDayGroup(v.get(g)?.title ?? "");
    if (d) return d.date;
  }
  const t = parseRecordTitle(v.get(id)?.title ?? "");
  if (t) return t.date;
  return (v.get(id)?.created ?? "").slice(0, 10);
}

/** そのしるしの付いた物: 文字・ノート(題・本文の @、記録の種類が同じノート)・マーカーの付いた日付グループ */
export function tagged(v: Vault, tag: string): { id: string; date: string; how: "text" | "note" | "marker" }[] {
  const out: { id: string; date: string; how: "text" | "note" | "marker" }[] = [];
  for (const n of v.nodes.values()) {
    if (n.type === "group") {
      if (n.markers?.includes(tag)) {
        const d = parseDayGroup(n.title);
        if (d) out.push({ id: n.id, date: d.date, how: "marker" });
      }
      continue;
    }
    if (n.type === "note") {
      if (parseRecordTitle(n.title)?.kind === tag || tagsIn(n.title).includes(tag) || tagsIn(n.body).includes(tag)) out.push({ id: n.id, date: dateOf(v, n.id), how: "note" });
      continue;
    }
    if (n.type === "text" && tagsIn(n.title).includes(tag)) out.push({ id: n.id, date: dateOf(v, n.id), how: "text" });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** 使われているしるし全部と数(マーカー・文字とノートの @・記録の種類。extra は種類の名前など) */
export function allTags(v: Vault, extra: string[] = []): { tag: string; n: number }[] {
  const count = new Map<string, number>();
  const add = (t: string) => count.set(t, (count.get(t) ?? 0) + 1);
  for (const n of v.nodes.values()) {
    for (const m of n.markers ?? []) add(m);
    if (n.type === "text") tagsIn(n.title).forEach(add);
    if (n.type === "note") {
      const k = parseRecordTitle(n.title)?.kind;
      if (k) add(k);
      new Set([...tagsIn(n.title), ...tagsIn(n.body)]).forEach(add);
    }
  }
  for (const e of extra) if (!count.has(e)) count.set(e, 0);
  return [...count.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, "ja"));
}
