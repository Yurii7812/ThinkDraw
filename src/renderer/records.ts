// 時系列記録(Ctrl+J)。2026-11-24 統合仕様 11〜14:
//   その日にブレストや文章を書いた日付グループ(2026-11-24 / 2026-11-24-題)そのものを、その日の記録とする。日記は必須ではない。
//   日付グループには @ マーカー(@読書・@夢 など。時系列記録だけのしるし)を付けられる。
//   画面はアプリの中身の所全体: 左に月のカレンダーとマーカーの絞り込み、右に選んだ日の題・マーカー・ボードの縮小・記録ノート。
import type { Vault } from "../core/vault";
import { ROOT_ID } from "../core/types";
import { T } from "./strings";
import { askText, h, toast } from "./ui";
import { openTasks, toggleTask } from "./mdschema";

export { cleanKind, DEFAULT_KINDS, KINDS_FILE, parseKinds, parseRecordTitle, withDescendants, type RecordKind } from "../core/records";
import { cleanKind, parseDayGroup, parseRecordTitle, withDescendants, type RecordKind } from "../core/records";
import { allTags, tagged, tagsIn } from "../core/tags";

export interface RecordEntry {
  date: string;
  day: string; // 日のグループの ID
  id: string; // 記録(ノート・グループ)の ID。日のグループに文字しか無いときは day と同じ
  kind: string;
  sub: string; // 名前の「好きな題」の所
  type: "note" | "group" | "day";
  preview: string;
}

/**
 * 日付グループか(名前が 2026-11-24 か 2026-11-24-題)。日付だけの名前は前の版と同じくどこにあっても日付グループ。
 * 題の付いたものは、記録 › 年 › 月(2026-11)の下にあるときだけ(関係ない「2026-11-24-会議」などと混ぜない)
 */
export function isDayGroup(v: Vault, id: string): { date: string; title: string } | null {
  const n = v.get(id);
  if (n?.type !== "group" || id === ROOT_ID) return null;
  const p = parseDayGroup(n.title);
  if (!p) return null;
  if (n.title.trim() === p.date) return p;
  return v.parentsOf(id).some((g) => v.get(g)?.title === p.date.slice(0, 7)) ? p : null;
}

/** 日付グループを全部(同じ日に複数あれば全部) */
export function dayGroups(v: Vault): { id: string; date: string; title: string }[] {
  const out: { id: string; date: string; title: string }[] = [];
  for (const n of v.nodes.values()) {
    const d = isDayGroup(v, n.id);
    if (d) out.push({ id: n.id, ...d });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** その日の日付グループ(月のグループの下にあるものを先に) */
export function findDayGroup(v: Vault, date: string): string | null {
  const list = dayGroups(v).filter((d) => d.date === date);
  const under = list.find((d) => v.parentsOf(d.id).some((g) => v.get(g)?.title === date.slice(0, 7)));
  return (under ?? list[0])?.id ?? null;
}

/** 日のグループの中の、その種類のノート(古い名前「日記」だけのものも見つける)。except は除く */
export function findRecordNote(v: Vault, day: string, kind: string, except?: string): string | null {
  for (const it of v.itemsOf(day)) {
    const n = v.get(it.id);
    if (it.ref || n?.type !== "note" || n.id === except) continue;
    if (parseRecordTitle(n.title)?.kind === kind || n.title === kind) return n.id;
  }
  return null;
}

/** その日の記録(ノートとグループ)。同じ種類・同じ名前でも別々に */
export function collectRecords(v: Vault): RecordEntry[] {
  const out: RecordEntry[] = [];
  for (const d of dayGroups(v)) {
    for (const it of v.itemsOf(d.id).filter((i) => !i.ref && v.exists(i.id)).sort((a, b) => a.y - b.y || a.x - b.x)) {
      const c = v.get(it.id)!;
      if (c.type !== "note" && c.type !== "group") continue;
      const p = parseRecordTitle(c.title);
      out.push({ date: d.date, day: d.id, id: c.id, kind: p?.kind ?? (c.title || T.untitled), sub: p?.sub ?? "", type: c.type, preview: "" });
    }
  }
  return out;
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
  /** マーカーの絞り込み(null = すべて) */
  marker: string | null;
  onMarker(m: string | null): void;
  open(e: RecordEntry): void;
  /** その日に新しい記録ノート(日付グループが無ければ作る) */
  newNote(date: string, kind: string): void;
  /** 日付グループの題(日付はそのまま)。無ければ作る */
  renameDay(date: string, title: string): void;
  /** その日の日付グループ(無ければ作る) */
  dayGroup(date: string): string;
  /** 日付グループの @ マーカー。無ければ作る */
  setMarkers(date: string, markers: string[]): void;
  /** ボードの縮小(見るだけ)を el に出す。group = null なら消す */
  preview(el: HTMLElement, group: string | null): void;
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
  /** 右: その日 / 選んだしるしの記録の一覧 */
  private mode: "day" | "list" = "day";
  constructor(private host: RecordsHost) {
    const today = todayStr();
    this.sel = today;
    this.month = today.slice(0, 7);
    if (host.marker) this.mode = "list";
    this.cal = h("div", { class: "rec-cal" });
    this.day = h("div", { class: "rec-dayview" });
    const close = h("button", { class: "rec-close", title: T.recordsClose + " (Esc・Ctrl+J)", "aria-label": T.recordsClose, text: "×" });
    close.addEventListener("click", () => host.close());
    this.el = h(
      "section",
      { class: "records", tabindex: "-1", role: "dialog", "aria-label": T.recordsTitle },
      h("header", { class: "rec-top" }, h("span", { class: "rec-top-title", text: T.recordsTitle }), h("span", { class: "rec-gap" }), close),
      h("div", { class: "rec-box" }, this.cal, this.day),
    );
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as Element).closest?.("input, textarea")) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const d = new Date(this.sel + "T00:00:00");
      d.setDate(d.getDate() + step);
      this.pick(ymd(d));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const g = this.dayId(this.sel);
      if (g) this.openDay(g);
    }
  }

  private dayId(date: string): string | null {
    return findDayGroup(this.host.vault, date);
  }
  private openDay(g: string): void {
    this.host.open({ date: this.sel, day: g, id: g, kind: "", sub: "", type: "day", preview: "" });
  }

  private pick(date: string): void {
    this.sel = date;
    this.month = date.slice(0, 7);
    this.render();
  }

  render(): void {
    const v = this.host.vault;
    const today = todayStr();
    // 記録のある日: 中に何かある・題がある・マーカーがある日付グループ
    const days = new Map<string, { id: string; markers: string[] }[]>();
    const allMarkers = new Set<string>();
    for (const d of dayGroups(v)) {
      const n = v.get(d.id)!;
      const markers = n.markers ?? [];
      markers.forEach((m) => allMarkers.add(m));
      if (!d.title && !markers.length && !v.itemsOf(d.id).some((i) => v.exists(i.id))) continue;
      (days.get(d.date) ?? days.set(d.date, []).get(d.date)!).push({ id: d.id, markers });
    }
    // しるし: マーカー・文字とノートの @・記録の種類(同じ名前の集まり。2026-11-24 利用者)
    const tags = allTags(v, this.host.kinds.map((k) => k.name));
    const filter = this.host.marker && tags.some((t) => t.tag === this.host.marker) ? this.host.marker : null;
    const hits = filter ? tagged(v, filter) : [];
    const hitDates = new Set(hits.map((x) => x.date));
    const shown = (date: string) => (filter ? hitDates.has(date) : days.has(date));

    // ---- 左: 月のカレンダーとマーカー
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
      const b = h(
        "button",
        { class: "rec-cell" + (date === this.sel ? " sel" : "") + (date === today ? " today" : "") + (shown(date) ? " has" : ""), "data-date": date, "aria-label": date },
        h("span", { class: "rec-num", text: String(d) }),
        h("span", { class: "rec-mark" }),
      );
      b.addEventListener("click", () => {
        this.mode = "day";
        this.pick(date);
      });
      b.addEventListener("dblclick", () => {
        const g = this.dayId(date);
        if (g) this.openDay(g);
      });
      grid.append(b);
    }
    const mk = h("div", { class: "rec-markers" }, h("div", { class: "rec-h", text: T.recordsMarkers }));
    const mrow = (label: string, val: string | null, count?: number) => {
      const b = h("button", { class: "rec-mk" + (filter === val ? " on" : ""), "data-marker": val ?? "" }, h("span", { text: label }), h("span", { class: "rec-gap" }), count ? h("span", { class: "rec-count", text: String(count) }) : null);
      b.addEventListener("click", () => {
        this.host.onMarker(val);
        // しるしを選ぶと、そのしるしの記録の一覧(日付の新しい順)
        this.mode = val ? "list" : "day";
        this.render();
      });
      return b;
    };
    mk.append(mrow(T.recordsAll, null));
    for (const t of tags) mk.append(mrow("@" + t.tag, t.tag, t.n));
    if (!tags.length) mk.append(h("div", { class: "rec-none small", text: T.recordsNoMarkers }));
    const kindsBtn = h("button", { class: "rec-kinds-btn", text: T.recordsKindsBtn });
    kindsBtn.addEventListener("click", () => this.kindsDialog());
    this.cal.replaceChildren(
      h("div", { class: "rec-cal-head" }, prev, h("span", { class: "rec-month-name", text: `${y}年${m}月` }), next),
      grid,
      h("div", { class: "rec-sep" }),
      mk,
      h("div", { class: "rec-cal-foot" }, h("span", { class: "rec-gap" }), kindsBtn),
    );

    // ---- 右: 選んだ日
    const d = new Date(this.sel + "T00:00:00");
    const g = this.dayId(this.sel);
    const gNode = g ? v.get(g) : undefined;
    const info = g ? isDayGroup(v, g) : null;
    const others = dayGroups(v).filter((x) => x.date === this.sel && x.id !== g);
    const dateLine = h("div", { class: "rec-day-date", text: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})` + (this.sel === today ? " · " + T.recordsToday : "") });
    // 題(グループの名前の日付より後ろ)。直すとグループの名前に入る(日付はそのまま)
    const title = h("input", { class: "rec-day-name", type: "text", placeholder: T.recordsTitlePh, spellcheck: "false" }) as HTMLInputElement;
    title.value = info?.title ?? "";
    const saveTitle = () => {
      if (title.value.trim() !== (info?.title ?? "")) this.host.renameDay(this.sel, title.value);
    };
    title.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") title.blur();
      if (e.key === "Escape") {
        title.value = info?.title ?? "";
        title.blur();
      }
    });
    title.addEventListener("change", saveTitle);
    const openBtn = h("button", { class: "btn rec-open-day", text: g ? T.recordsOpenBoard : T.recordsMakeBoard });
    // その日のボードが無くても、ここから作って開ける(2026-11-25 利用者)
    openBtn.addEventListener("click", () => this.openDay(g ?? this.host.dayGroup(this.sel)));
    // マーカー(付けたもの)と、その日のボードに書いた @(ボードの文字から。ここでは外せない)
    const markers = gNode?.markers ?? [];
    const chips = h("div", { class: "rec-chips" });
    const written = new Set<string>();
    if (g)
      for (const it of v.itemsOf(g)) {
        const c = v.get(it.id);
        if (c?.type === "text") tagsIn(c.title).forEach((x) => written.add(x));
      }
    for (const x of written) if (!markers.includes(x)) chips.append(h("span", { class: "rec-chip written", "data-marker": x, title: T.recordsWrittenTag }, "@" + x));
    for (const x of markers) {
      const del = h("button", { class: "rec-chip-x", title: T.recordsMarkerRemove, "aria-label": T.recordsMarkerRemove, text: "×" });
      del.addEventListener("click", () => {
        this.host.setMarkers(this.sel, markers.filter((y) => y !== x));
        this.render();
      });
      chips.append(h("span", { class: "rec-chip", "data-marker": x }, "@" + x, del));
    }
    const add = h("button", { class: "rec-chip add", title: T.recordsMarkerAdd, "aria-label": T.recordsMarkerAdd, text: "＋ @" });
    add.addEventListener("click", async () => {
      const t = await askText(T.recordsMarkerAsk, "", tags.map((x) => x.tag).filter((x) => !markers.includes(x)));
      const name = (t ?? "").replace(/^@/, "").trim();
      if (!name) return;
      if (markers.includes(name)) return toast(T.recordsMarkerDup);
      this.host.setMarkers(this.sel, [...markers, name]);
      this.render();
    });
    chips.append(add);
    // ボードの縮小(見るだけ。押すと開く)
    const pv = h("div", { class: "rec-preview" + (g && v.itemsOf(g).length ? "" : " empty") });
    if (g && v.itemsOf(g).length) {
      pv.title = T.recordsOpenBoard;
      pv.addEventListener("dblclick", () => this.openDay(g));
      const hint = h("button", { class: "rec-preview-open", text: T.recordsOpenBoard });
      hint.addEventListener("click", () => this.openDay(g));
      pv.append(hint);
    } else pv.append(h("div", { class: "rec-none", text: T.recordsNoBoard }));
    // まだ済んでいないチェック(その日のボードの中のノートから。済んだものは出さない)
    const tasks = this.openTaskRows(g, others.map((o) => o.id));
    // 記録ノート(全部。同じ種類・同じ名前でも別々に)
    const entries = collectRecords(v).filter((e) => e.date === this.sel && (e.day === g || others.some((o) => o.id === e.day)));
    const list = h("div", { class: "rec-items" });
    for (const e of entries) {
      const nn = v.get(e.id);
      const label = e.type === "group" ? nn?.title || T.untitledGroup : e.sub ? `${e.kind} — ${e.sub}` : e.kind;
      // 同じ名前でも分かるように、作った時刻を右に
      const t = nn?.created ? new Date(nn.created) : null;
      const time = t && !isNaN(+t) ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "";
      const row = h("button", { class: "rec-item" + (e.type === "group" ? " group" : ""), "data-id": e.id }, h("span", { class: "rec-ico" }), h("span", { class: "rec-item-t", text: label }), h("span", { class: "rec-gap" }), h("span", { class: "rec-time", text: time }));
      row.addEventListener("click", () => this.host.open(e));
      list.append(row);
    }
    if (!entries.length) list.append(h("div", { class: "rec-none", text: T.recordsNoNotes }));
    const newBtn = h("button", { class: "rec-new", text: T.recordsNewNote });
    newBtn.addEventListener("click", async () => {
      const kinds = tags.map((x) => x.tag); // 種類と @しるし は同じ候補
      const t = await askText(T.recordsNewNoteAsk, this.host.kinds[0]?.name ?? "", kinds);
      const kind = cleanKind(t ?? "");
      if (!kind) return;
      if (!this.host.kinds.some((k) => k.name === kind)) this.host.saveKinds([...this.host.kinds, { name: kind, parents: [] }]);
      this.host.newNote(this.sel, kind);
    });
    const otherDays: HTMLElement | null = others.length
      ? h("div", { class: "rec-others" }, h("span", { class: "rec-h", text: T.recordsOtherGroups }), ...others.map((o) => {
          const b = h("button", { class: "rec-item group", text: v.get(o.id)?.title ?? o.date });
          b.addEventListener("click", () => this.openDay(o.id));
          return b;
        }))
      : null;
    // 切り替え: この日 / @しるし の記録
    const sw = filter
      ? h(
          "div",
          { class: "rec-switch", role: "tablist" },
          ...(["day", "list"] as const).map((md) => {
            const b = h("button", { class: "rec-sw" + (this.mode === md ? " on" : ""), role: "tab", text: md === "day" ? T.recordsThisDay : T.recordsTagList(filter) });
            b.addEventListener("click", () => {
              this.mode = md;
              this.render();
            });
            return b;
          }),
        )
      : null;
    if (filter && this.mode === "list") {
      this.day.replaceChildren(...[sw, this.tagList(filter, hits)].filter((x): x is HTMLElement => !!x));
      this.host.preview(pv, null);
      return;
    }
    this.day.replaceChildren(
      ...([
        sw,
        h("div", { class: "rec-day-head" }, h("div", { class: "rec-day-main" }, dateLine, title), openBtn),
        chips,
        tasks,
        h("div", { class: "rec-h", text: T.recordsBrainstorm }),
        pv,
        h("div", { class: "rec-h-row" }, h("span", { class: "rec-h", text: T.recordsNotes }), h("span", { class: "rec-gap" }), newBtn),
        list,
        otherDays,
      ] as (HTMLElement | null)[]).filter((x): x is HTMLElement => !!x),
    );
    this.host.preview(pv, g && v.itemsOf(g).length ? g : null);
  }

  /** その日のボード(下のグループも)のノートにある、まだ済んでいないチェック項目。押すと済みにして消える */
  private openTaskRows(g: string | null, others: string[]): HTMLElement | null {
    const v = this.host.vault;
    const seen = new Set<string>();
    const notes: { id: string; gid: string }[] = [];
    const walk = (gid: string) => {
      if (seen.has(gid)) return;
      seen.add(gid);
      for (const it of v.itemsOf(gid)) {
        const n = v.get(it.id);
        if (!n || it.ref) continue;
        if (n.type === "group") walk(n.id);
        else if (n.type === "note" && !notes.some((x) => x.id === n.id)) notes.push({ id: n.id, gid });
      }
    };
    for (const x of [g, ...others]) if (x) walk(x);
    const rows: HTMLElement[] = [];
    for (const { id, gid } of notes) {
      const n = v.get(id)!;
      for (const t of openTasks(n.body)) {
        const box = h("input", { type: "checkbox", class: "rec-task-box", title: T.recordsTaskDone }) as HTMLInputElement;
        box.addEventListener("click", () => {
          v.setBody(id, toggleTask(v.get(id)!.body, t.index));
          this.render();
        });
        const label = h("button", { class: "rec-task-t", text: t.text || T.untitled });
        label.addEventListener("click", () => this.host.open({ date: this.sel, day: gid, id, kind: "", sub: "", type: "note", preview: "" }));
        rows.push(h("div", { class: "rec-task", "data-id": id }, box, label, h("span", { class: "rec-task-from", text: n.title || T.untitled })));
      }
    }
    if (!rows.length) return null;
    return h("div", {}, h("div", { class: "rec-h", text: T.recordsTasks }), h("div", { class: "rec-tasks" }, ...rows));
  }

  /** そのしるしの記録を、日付の新しい順に(日ごとに見出し。文字・ノート・マーカーだけの日) */
  private tagList(tag: string, hits: { id: string; date: string; how: "text" | "note" | "marker" }[]): HTMLElement {
    const v = this.host.vault;
    const box = h("div", { class: "rec-taglist" }, h("div", { class: "rec-day-name static", text: "@" + tag }), h("div", { class: "rec-day-date", text: T.recordsTagCount(hits.length) }));
    let cur = "";
    let ul: HTMLElement | null = null;
    for (const x of hits) {
      if (x.date !== cur) {
        cur = x.date;
        const d = new Date(x.date + "T00:00:00");
        const g = findDayGroup(v, x.date);
        const dt = g ? isDayGroup(v, g)?.title : "";
        const head = h("button", { class: "rec-tl-date", "data-date": x.date }, h("span", { text: isNaN(+d) ? x.date : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})` }), dt ? h("span", { class: "rec-tl-title", text: dt }) : null);
        head.addEventListener("click", () => {
          this.mode = "day";
          this.pick(x.date);
        });
        ul = h("div", { class: "rec-items" });
        box.append(head, ul);
      }
      const n = v.get(x.id);
      const label = x.how === "marker" ? T.recordsMarkerOnly : n?.type === "note" ? (() => { const p = parseRecordTitle(n.title); return p ? (p.sub ? `${p.kind} — ${p.sub}` : p.kind) : n.title || T.untitled; })() : (n?.title ?? "").replace(/\s+/g, " ");
      const row = h("button", { class: "rec-item" + (x.how === "note" ? " note" : x.how === "marker" ? " group" : ""), "data-id": x.id }, h("span", { class: "rec-ico" }), h("span", { class: "rec-item-t", text: label }));
      row.addEventListener("click", () => {
        if (x.how === "marker") return this.openDay(x.id);
        const day = v.parentsOf(x.id).find((p) => isDayGroup(v, p)) ?? v.parentsOf(x.id)[0] ?? ROOT_ID;
        this.host.open({ date: x.date, day, id: x.id, kind: "", sub: "", type: x.how === "note" ? "note" : "day", preview: "" });
      });
      ul!.append(row);
    }
    if (!hits.length) box.append(h("div", { class: "rec-none", text: T.recordsNoNotes }));
    return box;
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
