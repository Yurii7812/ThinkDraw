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
function ymd(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
function todayStr(): string {
  return ymd(new Date());
}
/** 種類ごとの色(名前から決める。いつも同じ色) */
const KIND_COLORS = ["#2f6fdf", "#0f8a7a", "#c2417f", "#c0691b", "#7c5cd6", "#2e8540", "#b8860b", "#4a6178"];
export function kindColor(k: string): string {
  let h = 0;
  for (const ch of k) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return KIND_COLORS[h % KIND_COLORS.length];
}

export class RecordsView {
  readonly el: HTMLElement;
  private cal: HTMLElement;
  private day: HTMLElement;
  private month: string; // 2026-11
  private sel: string; // 2026-11-24
  private adding = false;
  constructor(private host: RecordsHost) {
    // 2026-11-24 利用者が見本 B を選んだ: 左に月のカレンダー(書いた物のある日に点)、右にその日の中身(タイトルだけ)
    const today = todayStr();
    this.sel = today;
    this.month = today.slice(0, 7);
    this.cal = h("div", { class: "rec-cal" });
    this.day = h("div", { class: "rec-dayview" });
    this.el = h("section", { class: "records", tabindex: "-1" }, h("div", { class: "rec-box", role: "dialog", "aria-label": T.recordsTitle }, this.cal, this.day));
    this.el.addEventListener("mousedown", (e) => e.target === this.el && host.close());
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as Element).closest?.("input")) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      e.stopPropagation();
      const d = new Date(this.sel + "T00:00:00");
      d.setDate(d.getDate() + step);
      this.pick(ymd(d));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const g = this.dayId(this.sel);
      if (g) this.host.open({ date: this.sel, day: g, id: g, kind: "", sub: "", type: "day", preview: "" });
    }
  }

  private dayId(date: string): string | null {
    return dayGroups(this.host.vault).find((d) => d.date === date)?.id ?? null;
  }

  private pick(date: string): void {
    this.sel = date;
    this.month = date.slice(0, 7);
    this.render();
  }

  render(): void {
    const v = this.host.vault;
    const today = todayStr();
    const days = new Map<string, string>(); // 日付 → 日のグループ(中に何かある日だけ)
    for (const d of dayGroups(v)) if (v.itemsOf(d.id).some((i) => v.exists(i.id))) days.set(d.date, d.id);

    // ---- 左: 月のカレンダー
    const [y, m] = this.month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const n = new Date(y, m, 0).getDate();
    const prev = h("button", { class: "rec-nav", "aria-label": T.recordsPrevMonth, title: T.recordsPrevMonth, text: "‹" });
    const next = h("button", { class: "rec-nav", "aria-label": T.recordsNextMonth, title: T.recordsNextMonth, text: "›" });
    const shift = (k: number) => {
      const d = new Date(y, m - 1 + k, 1);
      this.month = ymd(d).slice(0, 7);
      this.render();
    };
    prev.addEventListener("click", () => shift(-1));
    next.addEventListener("click", () => shift(1));
    const grid = h("div", { class: "rec-grid" }, ...WEEK.map((w, i) => h("span", { class: "rec-wd" + (i === 0 ? " sun" : i === 6 ? " sat" : ""), text: w })));
    for (let i = 0; i < first.getDay(); i++) grid.append(h("span", { class: "rec-cell blank" }));
    for (let d = 1; d <= n; d++) {
      const date = `${this.month}-${String(d).padStart(2, "0")}`;
      const has = days.has(date);
      const b = h(
        "button",
        { class: "rec-cell" + (date === this.sel ? " sel" : "") + (date === today ? " today" : "") + (has ? " has" : ""), "data-date": date, "aria-label": date },
        h("span", { class: "rec-num", text: String(d) }),
        h("span", { class: "rec-mark" }),
      );
      b.addEventListener("click", () => this.pick(date));
      b.addEventListener("dblclick", () => {
        const g = days.get(date);
        if (g) this.host.open({ date, day: g, id: g, kind: "", sub: "", type: "day", preview: "" });
      });
      grid.append(b);
    }
    const kindsBtn = h("button", { class: "rec-kinds-btn", text: T.recordsKindsBtn });
    kindsBtn.addEventListener("click", () => this.kindsDialog());
    this.cal.replaceChildren(
      h("div", { class: "rec-cal-head" }, prev, h("span", { class: "rec-month-name", text: `${y}年 ${m}月` }), next),
      grid,
      h("div", { class: "rec-cal-foot" }, h("span", { class: "rec-legend", text: T.recordsLegend }), h("span", { class: "rec-gap" }), kindsBtn),
    );

    // ---- 右: 選んだ日の中身(タイトルだけ)
    const d = new Date(this.sel + "T00:00:00");
    const close = h("button", { class: "rec-close", title: T.recordsClose + " (Esc)", "aria-label": T.recordsClose, text: "×" });
    close.addEventListener("click", () => this.host.close());
    const g = days.get(this.sel) ?? this.dayId(this.sel);
    const head = h(
      "div",
      { class: "rec-day-title" },
      h("span", { class: "rec-day-date", text: `${d.getMonth() + 1}月${d.getDate()}日` }),
      h("span", { class: "rec-day-wd", text: WEEK[d.getDay()] + "曜日" }),
      this.sel === today ? h("span", { class: "rec-today", text: T.recordsToday }) : null,
      h("span", { class: "rec-gap" }),
      close,
    );
    const parts: HTMLElement[] = [head];
    if (g) {
      const open = h("button", { class: "btn small rec-open-day", text: T.recordsOpenDay });
      open.addEventListener("click", () => this.host.open({ date: this.sel, day: g, id: g, kind: "", sub: "", type: "day", preview: "" }));
      parts.push(open);
    }
    const entries = collectRecords(v).filter((e) => e.date === this.sel && e.type !== "day");
    const memos = g ? v.itemsOf(g).filter((i) => !i.ref && v.get(i.id)?.type === "text").length : 0;
    const list = h("div", { class: "rec-items" });
    for (const e of entries) {
      const n = v.get(e.id);
      const label = e.type === "group" ? n?.title || T.untitledGroup : e.sub ? `${e.kind} — ${e.sub}` : e.kind;
      const row = h("button", { class: "rec-item" + (e.type === "group" ? " group" : ""), "data-id": e.id }, h("span", { class: "rec-ico" }), h("span", { class: "rec-item-t", text: label }));
      row.addEventListener("click", () => this.host.open(e));
      list.append(row);
    }
    if (memos) list.append(h("div", { class: "rec-memos", text: T.recordsMemos(memos) }));
    if (!entries.length && !memos) list.append(h("div", { class: "rec-none", text: T.recordsNothing }));
    parts.push(list);
    if (this.sel === today && this.host.kinds.length) {
      const w = h("div", { class: "rec-write-row" });
      for (const k of this.host.kinds) {
        const b = h("button", { class: "rec-write", "data-kind": k.name, text: "＋ " + k.name });
        b.addEventListener("click", () => this.host.writeToday(k.name));
        w.append(b);
      }
      parts.push(w);
    }
    this.day.replaceChildren(...parts);
  }

  /** 種類の一覧(足す・押すと設定)。カレンダーの下の「種類…」から */
  private kindsDialog(): void {
    const list = h("div", { class: "kind-list" });
    const input = h("input", { type: "text", class: "rec-add-input", placeholder: T.recordsKindName }) as HTMLInputElement;
    const back = h("div", { class: "backdrop" });
    const close = () => {
      back.remove();
      removeEventListener("keydown", onKey, true);
      this.render();
    };
    const fill = () => {
      list.replaceChildren(
        ...treeOrder(this.host.kinds).map(({ k, depth }) => {
          const b = h("button", { class: "rec-k", "data-kind": k.name, style: `padding-left:${10 + depth * 16}px` }, depth ? h("span", { class: "rec-sub", text: "└" }) : null, h("span", { class: "rec-dot", style: `background:${kindColor(k.name)}` }), h("span", { class: "rec-kname", text: k.name }));
          b.addEventListener("click", () => {
            close();
            this.editKind(k.name);
          });
          return b;
        }),
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") {
        const name = cleanKind(input.value);
        if (name && !this.host.kinds.some((k) => k.name === name)) this.host.saveKinds([...this.host.kinds, { name, parents: [] }]);
        input.value = "";
        fill();
      } else if (e.key === "Escape") close();
    });
    const done = h("button", { class: "btn", text: T.close });
    done.addEventListener("click", close);
    back.append(h("div", { class: "modal kinds" }, h("div", { class: "modal-title", text: T.recordsKindsLabel }), list, input, h("div", { class: "muted small", text: T.recordsAddHint }), h("p", { class: "muted small", text: T.recordsKindsHelp }), h("div", { class: "row-end" }, done)));
    back.addEventListener("mousedown", (e) => e.target === back && close());
    addEventListener("keydown", onKey, true);
    fill();
    document.body.append(back);
    input.focus();
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
      this.render();
    });
    ok.addEventListener("click", () => {
      const nn = cleanKind(input.value) || k.name;
      if (nn !== k.name && kinds.some((x) => x.name === nn)) return toast(T.recordsKindExists);
      const parents = boxes.filter((b) => b.c.checked).map((b) => b.c.value);
      close();
      this.host.saveKinds(kinds.map((x) => (x.name === k.name ? { name: nn, parents } : { ...x, parents: x.parents.map((p) => (p === k.name ? nn : p)) })));
      this.render();
    });
    document.body.append(back);
    input.focus();
  }
}
