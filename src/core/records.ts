// 記録(日記・夢日記など)の名前と種類。画面に依らない部分
export interface RecordKind {
  name: string;
  parents: string[];
}
export const KINDS_FILE = "record-kinds.json";
// 2026-11-24 統合仕様 11: 日記を必須の種類にしない(新しい環境では種類は空。前に作った種類・ノートはそのまま)
export const DEFAULT_KINDS: RecordKind[] = [];

export function parseKinds(json: string | null): RecordKind[] {
  try {
    const d = JSON.parse(json ?? "");
    const list = (Array.isArray(d?.kinds) ? d.kinds : [])
      .filter((k: unknown): k is RecordKind => !!k && typeof (k as RecordKind).name === "string" && !!(k as RecordKind).name.trim())
      .map((k: RecordKind) => ({ name: cleanKind(k.name), parents: Array.isArray(k.parents) ? k.parents.filter((p) => typeof p === "string") : [] }));
    return list.length ? list : DEFAULT_KINDS.map((k) => ({ ...k }));
  } catch {
    return DEFAULT_KINDS.map((k) => ({ ...k }));
  }
}
/** 種類の名前には「-」を使えない(名前の区切りなので)。前後の空白も取る */
export function cleanKind(s: string): string {
  return s.replace(/[-\n]/g, "・").trim();
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TITLE = /^(\d{4}-\d{2}-\d{2})-([^-]+?)(?:-(.*))?$/;

/** 「2026-11-23-夢日記-空を飛ぶ」→ 日付・種類・題 */
export function parseRecordTitle(title: string): { date: string; kind: string; sub: string } | null {
  const m = TITLE.exec(title.trim());
  return m ? { date: m[1], kind: m[2].trim(), sub: (m[3] ?? "").trim() } : null;
}

/** k とその下位(下位の下位も)の名前 */
export function withDescendants(kinds: RecordKind[], k: string): Set<string> {
  const out = new Set([k]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of kinds) if (!out.has(c.name) && c.parents.some((p) => out.has(p))) (out.add(c.name), (grew = true));
  }
  return out;
}


// ---------- 日付グループ(2026-11-24 統合仕様 11) ----------
// 名前は「2026-11-24」か「2026-11-24-bresutoの設計を考えた日」。先頭 10 文字が日付、その直後の「-」より後ろ全部が題(題の中の「-」もそのまま)
const DAY_GROUP = /^(\d{4})-(\d{2})-(\d{2})(?:-([\s\S]*))?$/;

/** 日付グループの名前 → 日付と題。日付として正しくなければ null */
export function parseDayGroup(title: string): { date: string; title: string } | null {
  const m = DAY_GROUP.exec(title.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, title: (m[4] ?? "").trim() };
}
/** 日付と題 → 日付グループの名前 */
export function dayGroupTitle(date: string, title: string): string {
  const t = title.replace(/\s*\n\s*/g, " ").trim();
  return t ? `${date}-${t}` : date;
}
