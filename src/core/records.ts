// 記録(日記・夢日記など)の名前と種類。画面に依らない部分
export interface RecordKind {
  name: string;
  parents: string[];
}
export const KINDS_FILE = "record-kinds.json";
export const DEFAULT_KINDS: RecordKind[] = [{ name: "日記", parents: [] }];

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

