// 記録一覧(日記・夢日記などの時系列の記録を、日付順のリストで見る画面。右の欄とは関係なく、キャンバスの上に重ねて出す)
// 記録の形(2026-11-23 利用者と決めた):
//   ホーム › 記録 › 2026 › 2026-11 › 2026-11-23(日のグループ)の中に、種類ごとのノートを 1 枚ずつ。
//   ノートの名前は「2026-11-23-日記」「2026-11-23-夢日記-空を飛ぶ」(日付-種類-好きな題)。
//   その日のブレストは、日のグループのキャンバスに一緒に書く。
//   種類には上位を複数付けられる。その日の上位のノートから、下位のノートへ線を引く。
import type { Vault } from "../core/vault";
import { T } from "./strings";
import { h, toast } from "./ui";

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
  private side: HTMLElement;
  private head: HTMLElement;
  private body: HTMLElement;
  private adding = false;
  constructor(private host: RecordsHost) {
    const close = h("button", { class: "tbtn rec-close", title: T.recordsClose + " (Esc)", "aria-label": T.recordsClose, text: "×" });
    close.addEventListener("click", () => host.close());
    this.side = h("nav", { class: "rec-side" });
    this.head = h("div", { class: "rec-head" });
    this.body = h("div", { class: "rec-body" });
    this.el = h(
      "section",
      { class: "records", tabindex: "-1" },
      h("div", { class: "rec-top" }, h("div", { class: "rec-title", text: T.recordsTitle }), h("span", { class: "rec-gap" }), close),
      h("div", { class: "rec-cols" }, this.side, h("div", { class: "rec-main-col" }, this.head, this.body)),
    );
    this.render();
  }

  private select(k: string | null): void {
    this.host.onKind(k);
    this.host.kind = k;
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

    // ---- 左: 種類の一覧(木)。いちばん下で新しい種類を足す
    const item = (label: string, k: string | null, n: number, depth = 0, extra = "") => {
      const b = h("button", { class: "rec-k" + (k === kind ? " active" : "") + extra, "data-kind": k ?? "", style: `padding-left:${10 + depth * 16}px` }, depth ? h("span", { class: "rec-sub", text: "└" }) : null, h("span", { class: "rec-kname", text: label }), h("span", { class: "rec-n", text: String(n) }));
      b.addEventListener("click", () => this.select(k));
      return b;
    };
    const registered = new Set(kinds.map((k) => k.name));
    const others = [...counts.keys()].filter((k) => !registered.has(k)).sort((a, b) => a.localeCompare(b, "ja"));
    const add = this.adding ? this.addBox() : h("button", { class: "rec-add", text: T.recordsKindAdd });
    if (!this.adding) add.addEventListener("click", () => ((this.adding = true), this.render()));
    this.side.replaceChildren(
      item(T.recordsAll, null, all.length),
      h("div", { class: "rec-side-label", text: T.recordsKindsLabel }),
      ...treeOrder(kinds).map(({ k, depth }) => item(k.name, k.name, count(k.name), depth)),
      ...(others.length ? [h("div", { class: "rec-side-label", text: T.recordsOthersLabel }), ...others.map((k) => item(k, k, counts.get(k)!, 0, " other"))] : []),
      add,
    );
    if (this.adding) this.side.querySelector<HTMLInputElement>("input")?.focus();

    // ---- 右の上: いま見ている種類と、今日を書くボタン・設定
    const def = kind ? kinds.find((k) => k.name === kind) : undefined;
    const writeKind = def ? def.name : !kind ? (kinds[0]?.name ?? null) : null;
    const btns: HTMLElement[] = [];
    if (writeKind) {
      const w = h("button", { class: "btn primary rec-write", "data-kind": writeKind, text: T.recordsWriteTodayKind(writeKind) });
      w.addEventListener("click", () => this.host.writeToday(writeKind));
      btns.push(w);
    }
    if (def) {
      const set = h("button", { class: "btn small rec-settings", text: T.recordsKindSettings });
      set.addEventListener("click", () => this.editKind(def.name));
      btns.push(set);
    }
    const parentsNote = def?.parents.length ? h("div", { class: "muted small", text: T.recordsParentsNote(def.parents) }) : null;
    this.head.replaceChildren(h("div", { class: "rec-head-row" }, h("div", { class: "rec-h", text: kind ?? T.recordsAll }), h("span", { class: "rec-gap" }), ...btns), parentsNote ?? "");

    // ---- 右: 記録の一覧
    const list = all.filter((e) => !shown || shown.has(e.kind));
    if (!list.length) {
      this.body.replaceChildren(h("div", { class: "rec-empty", text: kind ? T.recordsEmptyKind(kind) : T.recordsEmpty }));
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

  /** 左の一覧のいちばん下で、新しい種類の名前を書く(Enter で足す・Esc でやめる) */
  private addBox(): HTMLElement {
    const input = h("input", { type: "text", class: "rec-add-input", placeholder: T.recordsKindName }) as HTMLInputElement;
    const done = (ok: boolean) => {
      const name = cleanKind(input.value);
      this.adding = false;
      if (ok && name && !this.host.kinds.some((k) => k.name === name)) {
        this.host.saveKinds([...this.host.kinds, { name, parents: [] }]);
        return this.select(name);
      }
      this.render();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") done(true);
      else if (e.key === "Escape") done(false);
    });
    input.addEventListener("blur", () => this.adding && done(true));
    return h("div", { class: "rec-add-box" }, input, h("div", { class: "muted small", text: T.recordsAddHint }));
  }

  /** 1 つの種類の設定: 名前・上位(複数)・消す */
  private editKind(name: string): void {
    const kinds = this.host.kinds;
    const k = kinds.find((x) => x.name === name);
    if (!k) return;
    const input = h("input", { type: "text", class: "kind-name", value: k.name }) as HTMLInputElement;
    const below = withDescendants(kinds, k.name); // 自分の下位は上位にできない(輪になる)
    const boxes = kinds
      .filter((o) => !below.has(o.name))
      .map((o) => {
        const c = h("input", { type: "checkbox", value: o.name }) as HTMLInputElement;
        c.checked = k.parents.includes(o.name);
        return { c, el: h("label", { class: "check" }, c, o.name) };
      });
    const del = h("button", { class: "btn danger", text: T.recordsKindDelete });
    const ok = h("button", { class: "btn primary", text: "OK" });
    const cancel = h("button", { class: "btn", text: T.cancel });
    const box = h(
      "div",
      { class: "modal kinds" },
      h("div", { class: "modal-title", text: T.recordsKindSettingsTitle(k.name) }),
      h("label", { class: "kind-field" }, h("span", { class: "set-label", text: T.recordsKindNameLabel }), input),
      h("div", { class: "kind-field" }, h("span", { class: "set-label", text: T.recordsParents }), boxes.length ? h("div", { class: "kind-parents" }, ...boxes.map((b) => b.el)) : h("span", { class: "muted small", text: T.recordsNoParents })),
      h("p", { class: "muted small", text: T.recordsKindsHelp }),
      h("div", { class: "row-end" }, del, h("span", { class: "rec-gap" }), cancel, ok),
    );
    const back = h("div", { class: "backdrop" }, box);
    const close = () => {
      back.remove();
      removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", close);
    del.addEventListener("click", () => {
      close();
      this.host.saveKinds(kinds.filter((x) => x.name !== k.name).map((x) => ({ ...x, parents: x.parents.filter((p) => p !== k.name) })));
      this.select(null);
    });
    ok.addEventListener("click", () => {
      const nn = cleanKind(input.value) || k.name;
      if (nn !== k.name && kinds.some((x) => x.name === nn)) return toast(T.recordsKindExists);
      const parents = boxes.filter((b) => b.c.checked).map((b) => b.c.value);
      close();
      this.host.saveKinds(kinds.map((x) => (x.name === k.name ? { name: nn, parents } : { ...x, parents: x.parents.map((p) => (p === k.name ? nn : p)) })));
      this.select(nn);
    });
    document.body.append(back);
    input.focus();
  }
}
