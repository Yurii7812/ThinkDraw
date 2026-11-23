// 記録一覧(日記・夢日記などの時系列の記録を、日付順のリストで見る画面。右の欄とは関係なく、キャンバスの上に重ねて出す)
// 記録の形(2026-11-23 利用者と決めた):
//   ホーム › 記録 › 2026 › 2026-11 › 2026-11-23(日のグループ)の中に、種類ごとのノートを 1 枚ずつ。
//   ノートの名前は「2026-11-23-日記」「2026-11-23-夢日記-空を飛ぶ」(日付-種類-好きな題)。
//   その日のブレストは、日のグループのキャンバスに一緒に書く。
//   種類には上位を複数付けられる。その日の上位のノートから、下位のノートへ線を引く。
import type { Vault } from "../core/vault";
import { T } from "./strings";
import { h } from "./ui";

export { cleanKind, DEFAULT_KINDS, KINDS_FILE, parseKinds, parseRecordTitle, withDescendants, type RecordKind } from "../core/records";
import { cleanKind, DATE, DEFAULT_KINDS, parseRecordTitle, withDescendants, type RecordKind } from "../core/records";

export interface RecordEntry {
  date: string;
  day: string; // 日のグループの ID
  id: string; // 記録(ノート・グループ)の ID。日のグループに文字しか無いときは day と同じ
  kind: string;
  sub: string; // 名前の「好きな題」の所
  type: "note" | "group" | "day";
  preview: string;
}

function flat(s: string, n = 140): string {
  const t = s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "🖼")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...t].length > n ? [...t].slice(0, n).join("") + "…" : t;
}
function groupPreview(v: Vault, g: string): string {
  const items = v.itemsOf(g).filter((i) => v.exists(i.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  return flat(items.map((i) => v.get(i.id)!.title).filter(Boolean).join(" / "));
}

/** 日のグループ(名前が 2026-11-23 の形)を全部 */
export function dayGroups(v: Vault): { id: string; date: string }[] {
  return [...v.nodes.values()].filter((n) => n.type === "group" && DATE.test(n.title)).map((n) => ({ id: n.id, date: n.title }));
}

/** 日のグループの中の、その種類のノート(古い名前「日記」だけのものも見つける) */
export function findRecordNote(v: Vault, day: string, kind: string): string | null {
  for (const it of v.itemsOf(day)) {
    const n = v.get(it.id);
    if (it.ref || n?.type !== "note") continue;
    if (parseRecordTitle(n.title)?.kind === kind || n.title === kind) return n.id;
  }
  return null;
}

export function collectRecords(v: Vault): RecordEntry[] {
  const out: RecordEntry[] = [];
  for (const d of dayGroups(v)) {
    const items = v.itemsOf(d.id).filter((i) => !i.ref && v.exists(i.id));
    let any = false;
    for (const it of items) {
      const c = v.get(it.id)!;
      if (c.type !== "note" && c.type !== "group") continue;
      any = true;
      const p = parseRecordTitle(c.title);
      out.push({
        date: d.date,
        day: d.id,
        id: c.id,
        kind: p?.kind ?? (c.title || T.untitled),
        sub: p?.sub ?? "",
        type: c.type,
        preview: c.type === "note" ? flat(c.body) : groupPreview(v, c.id),
      });
    }
    if (!any && items.length) out.push({ date: d.date, day: d.id, id: d.id, kind: T.recordsDayMemo, sub: "", type: "day", preview: groupPreview(v, d.id) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind, "ja"));
}

/** 種類を木の順に(上位の無いもの → その下位 …)。複数の上位があるものは最初に出てきた所に置く */
function treeOrder(kinds: RecordKind[]): { k: RecordKind; depth: number }[] {
  const names = new Set(kinds.map((k) => k.name));
  const out: { k: RecordKind; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (k: RecordKind, depth: number) => {
    if (seen.has(k.name)) return;
    seen.add(k.name);
    out.push({ k, depth });
    for (const c of kinds) if (c.parents.includes(k.name)) walk(c, depth + 1);
  };
  for (const k of kinds) if (!k.parents.some((p) => names.has(p))) walk(k, 0);
  for (const k of kinds) walk(k, 0); // 輪になっているもの
  return out;
}

export interface RecordsHost {
  vault: Vault;
  kinds: RecordKind[];
  kind: string | null; // 絞り込み(null = すべて)
  onKind(k: string | null): void;
  open(e: RecordEntry): void;
  writeToday(kind: string): void;
  saveKinds(kinds: RecordKind[]): void;
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
    const kinds = this.host.kinds;
    const all = collectRecords(v);
    const counts = new Map<string, number>();
    for (const e of all) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    let kind = this.host.kind;
    if (kind && !counts.has(kind) && !kinds.some((k) => k.name === kind)) kind = null;
    const shown = kind ? withDescendants(kinds, kind) : null;
    const count = (k: string) => [...withDescendants(kinds, k)].reduce((s, n) => s + (counts.get(n) ?? 0), 0);
    const chip = (label: string, k: string | null, n: number, depth = 0) => {
      const b = h("button", { class: "rec-chip" + (k === kind ? " active" : ""), "data-kind": k ?? "" }, depth ? h("span", { class: "rec-sub", text: "›" }) : null, label, h("span", { class: "rec-n", text: String(n) }));
      b.addEventListener("click", () => {
        this.host.onKind(k);
        this.host.kind = k;
        this.render();
      });
      return b;
    };
    const registered = new Set(kinds.map((k) => k.name));
    const others = [...counts.keys()].filter((k) => !registered.has(k)).sort((a, b) => a.localeCompare(b, "ja"));
    this.chips.replaceChildren(
      chip(T.recordsAll, null, all.length),
      ...treeOrder(kinds).map(({ k, depth }) => chip(k.name, k.name, count(k.name), depth)),
      ...others.map((k) => chip(k, k, counts.get(k)!)),
    );

    // 今日を書く: 登録した種類ごと
    const writes = treeOrder(kinds).map(({ k }) => {
      const b = h("button", { class: "btn small rec-write" + (k.name === kind ? " primary" : ""), "data-kind": k.name, text: k.name });
      b.addEventListener("click", () => this.host.writeToday(k.name));
      return b;
    });
    const edit = h("button", { class: "btn small", text: T.recordsEditKinds });
    edit.addEventListener("click", () => this.editKinds());
    this.actions.replaceChildren(h("span", { class: "rec-label", text: T.recordsWriteToday }), ...writes, h("span", { class: "rec-gap" }), edit);

    const list = all.filter((e) => !shown || shown.has(e.kind));
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
      const wd = WEEK[new Date(e.date + "T00:00:00").getDay()] ?? "";
      const sameDay = e.date === lastDate;
      lastDate = e.date;
      const row = h(
        "button",
        { class: "rec-row" + (sameDay ? " same-day" : ""), "data-id": e.id },
        h("span", { class: "rec-date" }, h("span", { class: "rec-d", text: sameDay ? "" : String(Number(e.date.slice(8))) }), h("span", { class: "rec-wd" + (wd === "日" ? " sun" : wd === "土" ? " sat" : ""), text: sameDay ? "" : wd })),
        h("span", { class: "rec-kind", text: e.kind }),
        h("span", { class: "rec-main" }, e.sub ? h("span", { class: "rec-subt", text: e.sub }) : null, h("span", { class: "rec-prev", text: e.preview || (e.sub ? "" : T.recordsNoText) })),
      );
      row.addEventListener("click", () => this.host.open(e));
      rows.push(row);
    }
    this.body.replaceChildren(...rows);
  }

  /** 種類の登録・名前・上位(複数)・削除 */
  private editKinds(): void {
    const work = this.host.kinds.map((k) => ({ name: k.name, parents: [...k.parents], orig: k.name }));
    const list = h("div", { class: "kind-list" });
    const draw = () => {
      list.replaceChildren(
        ...work.map((k, i) => {
          const name = h("input", { type: "text", class: "kind-name", value: k.name, placeholder: T.recordsKindName }) as HTMLInputElement;
          name.addEventListener("input", () => {
            const old = k.name;
            k.name = cleanKind(name.value);
            for (const o of work) o.parents = o.parents.map((p) => (p === old ? k.name : p));
          });
          name.addEventListener("change", () => draw());
          const parents = h(
            "div",
            { class: "kind-parents" },
            h("span", { class: "muted small", text: T.recordsParents }),
            ...work
              .filter((o) => o !== k && o.name)
              .map((o) => {
                const c = h("input", { type: "checkbox" }) as HTMLInputElement;
                c.checked = k.parents.includes(o.name);
                c.addEventListener("change", () => {
                  k.parents = c.checked ? [...new Set([...k.parents, o.name])] : k.parents.filter((p) => p !== o.name);
                });
                return h("label", { class: "check small" }, c, o.name);
              }),
          );
          const del = h("button", { class: "tbtn", title: T.recordsKindDelete, "aria-label": T.recordsKindDelete, text: "×" });
          del.addEventListener("click", () => {
            const gone = work.splice(i, 1)[0];
            for (const o of work) o.parents = o.parents.filter((p) => p !== gone.name);
            draw();
          });
          return h("div", { class: "kind-row" }, h("div", { class: "kind-top" }, name, del), parents);
        }),
      );
    };
    draw();
    const add = h("button", { class: "btn small", text: T.recordsKindAdd });
    add.addEventListener("click", () => {
      work.push({ name: "", parents: [], orig: "" });
      draw();
      (list.lastElementChild?.querySelector("input.kind-name") as HTMLInputElement | null)?.focus();
    });
    const ok = h("button", { class: "btn primary", text: "OK" });
    const cancel = h("button", { class: "btn", text: T.cancel });
    const box = h(
      "div",
      { class: "modal kinds" },
      h("div", { class: "modal-title", text: T.recordsEditKinds }),
      h("p", { class: "muted small", text: T.recordsKindsHelp }),
      list,
      h("div", {}, add),
      h("div", { class: "row-end" }, cancel, ok),
    );
    const back = h("div", { class: "backdrop" }, box);
    const done = () => {
      back.remove();
      removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done();
      }
    };
    addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", done);
    ok.addEventListener("click", () => {
      const seen = new Set<string>();
      const kinds = work
        .map((k) => ({ name: cleanKind(k.name), parents: k.parents }))
        .filter((k) => k.name && !seen.has(k.name) && (seen.add(k.name), true));
      const names = new Set(kinds.map((k) => k.name));
      for (const k of kinds) k.parents = [...new Set(k.parents.filter((p) => p !== k.name && names.has(p)))];
      done();
      this.host.saveKinds(kinds.length ? kinds : DEFAULT_KINDS.map((k) => ({ ...k })));
      this.render();
    });
    document.body.append(back);
  }
}
