// 記録一覧(日記・夢などの時系列の記録を、日付順のリストで見る画面。右の欄とは関係なく、キャンバスの上に重ねて出す)
// 記録の形: 名前が「2026-11-23」の日のグループ(ふつうは ホーム › 記録 › 年 › 月 の中)。
// その中のノート・グループが 1 件の記録で、その名前(「日記」「夢」など)が記録の種類。
import type { Vault } from "../core/vault";
import { T } from "./strings";
import { h } from "./ui";

export interface RecordEntry {
  date: string; // 2026-11-23
  day: string; // 日のグループの ID
  id: string; // 記録(ノート・グループ)の ID。日のグループに文字しか無いときは day と同じ
  kind: string; // 日記・夢 など
  type: "note" | "group" | "day";
  preview: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function flat(s: string, n = 140): string {
  const t = s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "🖼")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...t].length > n ? [...t].slice(0, n).join("") + "…" : t;
}

/** 中の文字・ノートの題を並べた、グループの短い中身 */
function groupPreview(v: Vault, g: string): string {
  const items = v.itemsOf(g).filter((i) => v.exists(i.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  return flat(items.map((i) => v.get(i.id)!.title).filter(Boolean).join(" / "));
}

export function collectRecords(v: Vault): RecordEntry[] {
  const out: RecordEntry[] = [];
  for (const n of v.nodes.values()) {
    if (n.type !== "group" || !DATE.test(n.title)) continue;
    const items = v.itemsOf(n.id).filter((i) => !i.ref && v.exists(i.id));
    let any = false;
    for (const it of items) {
      const c = v.get(it.id)!;
      if (c.type !== "note" && c.type !== "group") continue;
      any = true;
      out.push({
        date: n.title,
        day: n.id,
        id: c.id,
        kind: c.title || T.untitled,
        type: c.type,
        preview: c.type === "note" ? flat(c.body) : groupPreview(v, c.id),
      });
    }
    if (!any && items.length) out.push({ date: n.title, day: n.id, id: n.id, kind: T.recordsDayMemo, type: "day", preview: groupPreview(v, n.id) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind, "ja"));
}

export interface RecordsHost {
  vault: Vault;
  kind: string | null; // 絞り込み(null = すべて)
  onKind(k: string | null): void;
  open(e: RecordEntry): void;
  writeToday(kind: string): void;
  close(): void;
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

export class RecordsView {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private chips: HTMLElement;
  private actions: HTMLElement;
  constructor(private host: RecordsHost) {
    const close = h("button", { class: "tbtn rec-close", title: T.recordsClose + " (Esc)", "aria-label": T.recordsClose, text: "×" });
    close.addEventListener("click", () => host.close());
    this.chips = h("div", { class: "rec-chips" });
    this.actions = h("div", { class: "rec-actions" });
    this.body = h("div", { class: "rec-body" });
    this.el = h(
      "section",
      { class: "records", tabindex: "-1" },
      h("div", { class: "rec-head" }, h("div", { class: "rec-title", text: T.recordsTitle }), this.chips, close),
      this.actions,
      this.body,
    );
    this.render();
  }

  render(): void {
    const v = this.host.vault;
    const all = collectRecords(v);
    const counts = new Map<string, number>();
    for (const e of all) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    const kinds = [...counts.keys()].sort((a, b) => (a === T.diaryNote ? -1 : b === T.diaryNote ? 1 : (counts.get(b)! - counts.get(a)!) || a.localeCompare(b, "ja")));
    let kind = this.host.kind;
    if (kind && !counts.has(kind)) kind = null;
    const chip = (label: string, k: string | null, n: number) => {
      const b = h("button", { class: "rec-chip" + (k === kind ? " active" : ""), "data-kind": k ?? "" }, label, h("span", { class: "rec-n", text: String(n) }));
      b.addEventListener("click", () => {
        this.host.onKind(k);
        this.host.kind = k;
        this.render();
      });
      return b;
    };
    this.chips.replaceChildren(chip(T.recordsAll, null, all.length), ...kinds.map((k) => chip(k, k, counts.get(k)!)));

    const todayKind = kind ?? T.diaryNote;
    const write = h("button", { class: "btn primary small", text: T.recordsWriteToday(todayKind) });
    write.addEventListener("click", () => this.host.writeToday(todayKind));
    this.actions.replaceChildren(write, h("span", { class: "muted small", text: T.recordsHint }));

    const list = all.filter((e) => !kind || e.kind === kind);
    if (!list.length) {
      this.body.replaceChildren(h("div", { class: "rec-empty", text: T.recordsEmpty }));
      return;
    }
    const rows: HTMLElement[] = [];
    let month = "";
    let lastDate = "";
    for (const e of list) {
      const m = e.date.slice(0, 7);
      if (m !== month) {
        month = m;
        rows.push(h("div", { class: "rec-month", text: `${m.slice(0, 4)}年 ${Number(m.slice(5))}月` }));
      }
      const d = new Date(e.date + "T00:00:00");
      const wd = WEEK[d.getDay()] ?? "";
      const sameDay = e.date === lastDate;
      lastDate = e.date;
      const row = h(
        "button",
        { class: "rec-row" + (sameDay ? " same-day" : ""), "data-id": e.id },
        h("span", { class: "rec-date" }, h("span", { class: "rec-d", text: sameDay ? "" : String(Number(e.date.slice(8))) }), h("span", { class: "rec-wd" + (wd === "日" ? " sun" : wd === "土" ? " sat" : ""), text: sameDay ? "" : wd })),
        h("span", { class: "rec-kind", text: e.kind }),
        h("span", { class: "rec-prev", text: e.preview || T.recordsNoText }),
      );
      row.addEventListener("click", () => this.host.open(e));
      rows.push(row);
    }
    this.body.replaceChildren(...rows);
  }
}
