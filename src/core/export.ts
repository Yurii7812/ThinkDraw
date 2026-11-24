// 書き出し(Markdown): いまのグループを、リンクの木+ノート+中のグループの順に文章にする
import { cardName } from "../decks";
import type { TDNode } from "./types";
import { ROOT_ID } from "./types";
import type { Vault } from "./vault";

export function labelOf(n: TDNode): string {
  const t = n.card ? cardName(n.card) : n.title || "(無題)";
  return t.replace(/\s*\n\s*/g, " ").trim();
}

/** only を渡すと、そのグループの中の、その物だけ(選んだ範囲の書き出し)。中のグループは丸ごと */
export function groupToMarkdown(v: Vault, group: string, depth = 1, seen: Set<string> = new Set(), only?: Set<string>, forCopy = false): string {
  const g = v.get(group);
  if (!g || seen.has(group)) return "";
  seen.add(group);
  const h = "#".repeat(Math.min(depth, 6));
  const name = group === ROOT_ID ? g.title || "ホーム" : labelOf(g);
  const out: string[] = forCopy ? [] : [`${h} ${only ? `${name}(選んだ ${only.size} 件)` : name}`, ""];
  if (g.body.trim() && !only) out.push(g.body.trim(), "");
  const items = v.itemsOf(group).filter((i) => v.exists(i.id) && (!only || only.has(i.id)));
  const ids = new Set(items.map((i) => i.id));
  const refSet = new Set(items.filter((i) => i.ref).map((i) => i.id));
  const pos = new Map(items.map((i) => [i.id, i]));
  const byPos = (a: string, b: string) => pos.get(a)!.y - pos.get(b)!.y || pos.get(a)!.x - pos.get(b)!.x;
  const targets = new Set<string>();
  for (const id of ids) for (const l of v.get(id)!.links) if (ids.has(l.to)) targets.add(l.to);
  const shown = new Set<string>();
  const lines: string[] = [];
  const walk = (id: string, level: number): void => {
    const n0 = v.get(id)!;
    // ボードの中の引用は、元の物の名前で
    const n = n0.type === "alias" && n0.target && v.get(n0.target) ? v.get(n0.target)! : n0;
    const mark = !forCopy && (refSet.has(id) || n0.type === "alias") ? "(引用)" : "";
    const kind = n.type === "note" ? "📄 " : n.type === "group" ? "📁 " : "";
    const again = shown.has(id);
    lines.push(`${"  ".repeat(level)}- ${kind}${labelOf(n)}${mark}${again ? " ↩" : ""}`);
    if (again) return;
    shown.add(id);
    for (const l of [...n.links].filter((l) => ids.has(l.to)).sort((a, b) => byPos(a.to, b.to))) walk(l.to, level + 1);
  };
  const roots = [...ids].filter((i) => !targets.has(i)).sort(byPos);
  for (const r of roots) walk(r, 0);
  for (const i of [...ids].sort(byPos)) if (!shown.has(i)) walk(i, 0); // 輪になっているもの
  if (lines.length) out.push(...lines, "");
  for (const id of [...ids].filter((i) => !refSet.has(i)).sort(byPos)) {
    const n = v.get(id)!;
    if (n.type === "note") out.push(`${"#".repeat(Math.min(depth + 1, 6))} ${labelOf(n)}`, "", n.body.trim(), "");
    else if (n.type === "group") out.push(groupToMarkdown(v, id, depth + 1, seen));
    else if (n.body.trim()) out.push(`${"#".repeat(Math.min(depth + 1, 6))} ${labelOf(n)}`, "", n.body.trim(), "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Ctrl+C で外へ貼る Markdown(2026-11-24 統合仕様 2)。選んだ物だけ。
 * 文字 1 つなら、その文字だけ。ノートは見出しと本文、グループは中身ごと。線でつないだものは字下げの箇条書き(つないでいないものに階層は付けない)
 */
export function selectionToMarkdown(v: Vault, group: string, ids: string[]): string {
  const real = ids.map((id) => {
    const n = v.get(id);
    return n?.type === "alias" && n.target && v.get(n.target) ? n.target : id;
  });
  if (real.length === 1) {
    const n = v.get(real[0]);
    if (!n) return "";
    if (n.type === "group") return groupToMarkdown(v, n.id, 1);
    if (n.type === "note") return `# ${labelOf(n)}\n\n${n.body.trim()}\n`.replace(/\n{3,}/g, "\n\n");
    return n.body.trim() ? `${labelOf(n)}\n\n${n.body.trim()}\n` : (n.card ? labelOf(n) : n.title) + "\n";
  }
  return groupToMarkdown(v, group, 0, new Set(), new Set(ids), true);
}
