// 束ねたときの題(2026-11-26 修正13): 選んだ物の中で、決めた色の背景の文字を、グループの題にする。
// 文字のノードはそのまま中に残す。いくつもあれば左上(上が先、同じ高さなら左)のもの。fill = 0 なら切ってある。
export interface TitleCandidate {
  type: string;
  title: string;
  fill?: number;
  file?: string;
  paper?: string;
  x: number;
  y: number;
}

export function autoGroupTitle(items: TitleCandidate[], fill: number): string {
  if (!fill) return "";
  const hit = items
    .filter((n) => n.type === "text" && !n.file && !n.paper && (n.fill ?? 0) === fill && n.title.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x)[0];
  return hit ? hit.title.split("\n").map((l) => l.trim()).find(Boolean) ?? "" : "";
}
