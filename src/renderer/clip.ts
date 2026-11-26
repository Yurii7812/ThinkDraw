// ThinkDraw の中でコピーした物(2026-11-26 修正14)。Ctrl+V はいつもただの貼り付け、Ctrl+Q は引用として貼る。
// ノートの文章をコピーしたときは「どのノートのどこか」を覚える。ボードの物は canvas の refClip が覚える。
// システムのクリップボードの文字が変わっていたら(ほかでコピーした)、覚えた物は使わない。
export interface PassageClip {
  kind: "passage";
  note: string;
  from: number;
  to: number;
  text: string;
  /** コピーしたときの本文(位置がそのまま使えるか確かめる) */
  body: string;
}
export type Clip = PassageClip | { kind: "nodes" };

let last: Clip | null = null;
let lastText = "";
const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();

export function setClip(c: Clip, text: string): void {
  last = c;
  lastText = text;
}

/** 今のクリップボードが、ThinkDraw の中でコピーした物のままなら、それを返す */
export async function currentClip(): Promise<Clip | null> {
  if (!last) return null;
  try {
    const t = await navigator.clipboard.readText();
    if (norm(t) !== norm(lastText)) return null;
  } catch {
    // 読めないときは、覚えている物を使う
  }
  return last;
}
