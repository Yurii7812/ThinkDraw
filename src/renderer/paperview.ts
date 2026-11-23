// 紙PKM の画面(キャンバスの上に重ねる専用の画面)。
// 左 = 系列(0 全体索引・1・2…)、中 = その系列の ID(Folgezettel の順)、右 = スキャン画像。
// PDF・画像を落とすと取り込み: ページに分ける → 左上の ID を OCR → 確かめが要るページだけ確認 → 一覧へ足す。

import { parseFz } from "../core/folgezettel";
import { bySeries, byPid, duplicateFz, ordered, pagesWithFz, unsorted, type PaperIndex, type PaperPage, type StagedPage } from "../core/paper";
import { paperStore, vaultUrl } from "./paperstore";
import { PT } from "./strings";
import { api, askText, h, svg, toast } from "./ui";

export interface PaperHost {
  close(): void;
  /** いま開いているグループにページを置く */
  place(pid: string): void;
  /** そのページを置いたノード(グループと名前) */
  usedIn(pid: string): { id: string; group: string; groupTitle: string }[];
  goTo(group: string, id: string): void;
}

type SeriesSel = number | "undecided";

interface StageState {
  batch: string;
  pages: StagedPage[];
  ocrError: string | null;
  engine: string | null;
  fz: Map<string, string>;
  include: Map<string, boolean>;
  showAuto: boolean;
}

const ICONS: Record<string, string> = {
  import: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 15v5h14v-5"/>',
  export: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 14v6h14v-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  zin: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8 11h6M11 8v6"/>',
  zout: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8 11h6"/>',
  fit: '<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  place: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

function ico(name: string, size = 18): SVGSVGElement {
  const s = svg("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", class: "tb-ico" });
  s.innerHTML = ICONS[name] ?? "";
  return s;
}

function iconBtn(name: string, title: string, fn: () => void, cls = ""): HTMLButtonElement {
  const b = h("button", { class: "tbtn has-ico pp-btn " + cls, title, "aria-label": title }, ico(name));
  b.addEventListener("click", fn);
  return b;
}

export class PaperView {
  readonly el: HTMLElement;
  private side: HTMLElement;
  private list: HTMLElement;
  private viewer: HTMLElement;
  private cols: HTMLElement;
  private stageEl: HTMLElement;
  private series: SeriesSel = 0;
  private pid: string | null = null;
  /** 0 = 幅に合わせる。ほかは元の大きさに対する倍率 */
  private zoom = 0;
  private stage: StageState | null = null;
  private progress: { phase: string; done: number; total: number; message?: string } | null = null;
  private unsub: () => void;

  constructor(private host: PaperHost, start?: string) {
    const top = h(
      "div",
      { class: "rec-top pp-top" },
      h("div", { class: "rec-title", text: PT.title }),
      h("span", { class: "rec-gap" }),
      iconBtn("import", PT.importTip, () => void this.pickAndImport(), "pp-import"),
      iconBtn("export", PT.exportTip, () => void this.exportAll(), "pp-export"),
      iconBtn("settings", PT.settings, () => void this.openSettings(), "pp-settings"),
      iconBtn("close", PT.close + " (Esc)", () => host.close(), "pp-close"),
    );
    this.side = h("nav", { class: "rec-side pp-side" });
    this.list = h("div", { class: "pp-list" });
    this.viewer = h("div", { class: "pp-viewer", tabindex: "-1" });
    this.cols = h("div", { class: "rec-cols" }, this.side, this.list, this.viewer);
    this.stageEl = h("div", { class: "pp-stage" });
    this.stageEl.hidden = true;
    this.el = h("section", { class: "records paper", tabindex: "-1" }, top, this.cols, this.stageEl);

    // 落とすと取り込み
    this.el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      this.el.classList.add("dropping");
    });
    this.el.addEventListener("dragleave", (e) => {
      if (e.target === this.el || !this.el.contains(e.relatedTarget as Node)) this.el.classList.remove("dropping");
    });
    this.el.addEventListener("drop", (e) => {
      e.preventDefault();
      this.el.classList.remove("dropping");
      const files = [...(e.dataTransfer?.files ?? [])].map((f) => api().pathOf(f)).filter(Boolean);
      if (files.length) void this.importFiles(files);
    });
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.unsub = paperStore.on(() => this.render());

    if (start) {
      const p = byPid(paperStore.index, start);
      if (p) {
        this.pid = p.pid;
        this.series = p.fz && parseFz(p.fz) ? parseFz(p.fz)!.series : "undecided";
      }
    } else {
      // 最初は、ページのある一番小さい系列
      const s = bySeries(paperStore.index).find((x) => x.pages.length);
      if (s) this.series = s.series;
    }
    this.render();
  }

  dispose(): void {
    this.unsub();
  }

  /** そのページを出す(キャンバスの「紙」ノードから) */
  show(pid: string): void {
    const p = byPid(paperStore.index, pid);
    if (!p) return;
    this.pid = p.pid;
    this.series = p.fz && parseFz(p.fz) ? parseFz(p.fz)!.series : "undecided";
    if (!this.stage && !this.progress) this.render();
  }

  onProgress(p: { batch: string; phase: string; done: number; total: number; message?: string }): void {
    this.progress = p;
    if (!this.stage) this.renderStage();
  }

  // ---------- 一覧と画像 ----------

  render(): void {
    if (this.stage || this.progress) {
      this.cols.hidden = true;
      this.stageEl.hidden = false;
      this.renderStage();
      return;
    }
    this.cols.hidden = false;
    this.stageEl.hidden = true;
    const ix = paperStore.index;
    this.renderSide(ix);
    this.renderList(ix);
    this.renderViewer(ix);
  }

  private renderSide(ix: PaperIndex): void {
    const groups = bySeries(ix);
    const und = unsorted(ix);
    const item = (sel: SeriesSel, label: string, sub: string, n: number) => {
      const b = h(
        "button",
        { class: "rec-k pp-series" + (this.series === sel ? " active" : ""), "data-series": String(sel) },
        h("span", { class: "pp-sno", text: label }),
        h("span", { class: "rec-kname", text: sub }),
        h("span", { class: "rec-n", text: String(n) }),
      );
      b.addEventListener("click", () => {
        this.series = sel;
        this.pid = null;
        this.render();
      });
      return b;
    };
    this.side.replaceChildren(
      ...groups.map((g) => item(g.series, String(g.series), g.series === 0 ? PT.master : "", g.pages.length)),
      ...(und.length ? [h("div", { class: "rec-side-label", text: PT.needCheck }), item("undecided", "?", PT.undecided, und.length)] : []),
    );
  }

  private seriesPages(ix: PaperIndex): PaperPage[] {
    if (this.series === "undecided") return unsorted(ix);
    return bySeries(ix).find((s) => s.series === this.series)?.pages ?? [];
  }

  private renderList(ix: PaperIndex): void {
    const pages = this.seriesPages(ix);
    const dups = new Set(duplicateFz(ix));
    if (!ix.pages.length) {
      this.list.replaceChildren(h("div", { class: "pp-empty", text: PT.empty }));
      return;
    }
    const head = h("div", { class: "pp-list-head", text: this.series === "undecided" ? PT.undecided : this.series === 0 ? `0 ${PT.master}` : String(this.series) });
    const rows = pages.map((p) => {
      const f = p.fz ? parseFz(p.fz) : null;
      const depth = f ? Math.max(0, f.baseSegs.length - 1 + (f.indexSegs ? 1 : 0)) : 0;
      const b = h(
        "button",
        { class: "pp-row" + (p.pid === this.pid ? " active" : "") + (f?.kind === "index" || f?.kind === "master" ? " idx" : ""), "data-pid": p.pid, "data-fz": p.fz ?? "", style: `padding-left:${8 + Math.min(depth, 8) * 12}px` },
        h("img", { class: "pp-thumb", src: vaultUrl(p.thumb), loading: "lazy", alt: "", draggable: "false" }),
        h("span", { class: "pp-fz", text: p.fz ?? "?" }),
        p.status === "review" ? h("span", { class: "pp-flag", title: p.ocr?.reason ?? PT.needCheck, text: "!" }) : null,
        p.fz && dups.has(p.fz) ? h("span", { class: "pp-dup", title: PT.dupIds, text: "×" + pagesWithFz(ix, p.fz).length }) : null,
      );
      b.addEventListener("click", () => {
        this.pid = p.pid;
        this.render();
      });
      return b;
    });
    this.list.replaceChildren(head, ...(rows.length ? rows : [h("div", { class: "pp-empty small", text: this.series === 0 ? PT.masterEntry : PT.emptySeries })]));
    this.list.querySelector(".pp-row.active")?.scrollIntoView({ block: "nearest" });
  }

  private renderViewer(ix: PaperIndex): void {
    const p = this.pid ? byPid(ix, this.pid) : undefined;
    if (!p) {
      this.viewer.replaceChildren(...(ix.pages.length ? [h("div", { class: "pp-empty", text: PT.pickPage })] : []));
      return;
    }
    const same = p.fz ? pagesWithFz(ix, p.fz).filter((x) => x.pid !== p.pid).length : 0;
    const used = this.host.usedIn(p.pid);
    const bar = h(
      "div",
      { class: "pp-vbar" },
      iconBtn("prev", PT.prev, () => this.step(-1), "pp-prev"),
      h("span", { class: "pp-vid", text: p.fz ?? "?" }),
      iconBtn("next", PT.next, () => this.step(1), "pp-next"),
      h("span", { class: "rec-gap" }),
      iconBtn("zout", PT.zoomOut, () => this.setZoom(-1)),
      iconBtn("fit", PT.fit, () => this.setZoom(0)),
      iconBtn("zin", PT.zoomIn, () => this.setZoom(1)),
      iconBtn("full", PT.full, () => void this.viewer.requestFullscreen?.()),
      h("span", { class: "pp-sep" }),
      iconBtn("edit", PT.editId, () => void this.editId(p), "pp-edit"),
      iconBtn("place", PT.placeTip, () => this.host.place(p.pid), "pp-place"),
      iconBtn("trash", PT.remove, () => void this.removePage(p), "pp-remove danger"),
    );
    const img = h("img", { class: "pp-img", src: vaultUrl(p.img), alt: p.fz ?? "", draggable: "false" }) as HTMLImageElement;
    const wrap = h("div", { class: "pp-imgwrap" }, img);
    const applyZoom = () => {
      if (!this.zoom) {
        img.style.width = "100%";
        img.style.maxWidth = "900px";
      } else {
        img.style.maxWidth = "none";
        img.style.width = `${Math.round(p.w * this.zoom)}px`;
      }
    };
    applyZoom();
    wrap.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.setZoom(e.deltaY < 0 ? 1 : -1, false);
      applyZoom();
    }, { passive: false });
    const info = h(
      "div",
      { class: "pp-info" },
      p.status === "review" && p.ocr ? h("div", { class: "pp-warn", text: p.ocr.reason || PT.needCheck }) : null,
      same ? h("div", { class: "pp-warn", text: PT.sameId(same) }) : null,
      p.ocr ? h("div", { class: "pp-ocr", text: PT.ocrLine(p.ocr.engine, p.ocr.reads.join(" / "), p.ocr.reason) }) : null,
      p.status === "manual" ? h("div", { class: "pp-ocr", text: PT.manual }) : null,
      h(
        "div",
        { class: "pp-used" },
        h("span", { class: "bl-label", text: PT.usedIn }),
        ...(used.length
          ? used.map((u) => {
              const c = h("button", { class: "chip", text: u.groupTitle });
              c.addEventListener("click", () => this.host.goTo(u.group, u.id));
              return c;
            })
          : [h("span", { class: "muted", text: PT.notUsed })]),
      ),
    );
    this.viewer.replaceChildren(bar, wrap, info);
  }

  private setZoom(dir: -1 | 0 | 1, rerender = true): void {
    const steps = [0.15, 0.2, 0.25, 0.33, 0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
    if (dir === 0) this.zoom = 0;
    else {
      const img = this.viewer.querySelector<HTMLImageElement>(".pp-img");
      const cur = this.zoom || (img && img.naturalWidth ? img.clientWidth / img.naturalWidth : 0.33);
      const i = steps.findIndex((s) => s >= cur - 0.001);
      const k = dir > 0 ? Math.min(steps.length - 1, (i < 0 ? steps.length - 1 : steps[i]! > cur + 0.001 ? i : i + 1)) : Math.max(0, (i < 0 ? steps.length : i) - 1);
      this.zoom = steps[k]!;
    }
    if (rerender) this.renderViewer(paperStore.index);
  }

  /** 前後のページ(全体の Folgezettel の順。未確定のページはその中で) */
  private step(d: number): void {
    const ix = paperStore.index;
    const all = this.series === "undecided" ? unsorted(ix) : ordered(ix);
    const i = all.findIndex((p) => p.pid === this.pid);
    const next = all[i < 0 ? 0 : i + d];
    if (!next) return;
    this.pid = next.pid;
    const f = next.fz ? parseFz(next.fz) : null;
    if (f) this.series = f.series;
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    if (this.stage) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), this.step(1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), this.step(-1));
    else if (e.key === "+" || e.key === "=") this.setZoom(1);
    else if (e.key === "-") this.setZoom(-1);
    else if (e.key === "0") this.setZoom(0);
    else if (e.key === "f" || e.key === "F") void this.viewer.requestFullscreen?.();
  }

  private async editId(p: PaperPage): Promise<void> {
    const s = await askText(PT.editIdPrompt, p.fz ?? "");
    if (s === null) return;
    const t = s.trim();
    if (t && !parseFz(t)) return toast(PT.badId(t));
    try {
      const ix = await api().paperSetFz(p.pid, t || null);
      paperStore.set(ix);
      const f = t ? parseFz(t)! : null;
      this.series = f ? f.series : "undecided";
      this.render();
      toast(PT.idSaved(f ? f.id : "?"));
    } catch (e) {
      toast((e as Error).message);
    }
  }

  private async removePage(p: PaperPage): Promise<void> {
    if (!confirm(PT.removeConfirm(p.fz ?? "?"))) return;
    const all = this.series === "undecided" ? unsorted(paperStore.index) : ordered(paperStore.index);
    const i = all.findIndex((x) => x.pid === p.pid);
    paperStore.set(await api().paperRemove(p.pid));
    this.pid = (all[i + 1] ?? all[i - 1])?.pid ?? null;
    if (this.pid === p.pid) this.pid = null;
    this.render();
    toast(PT.removed);
  }

  private async exportAll(): Promise<void> {
    const r = await api().paperExport();
    if (r) toast(PT.exported(r.n, r.dir), 5000);
  }

  // ---------- 取り込み ----------

  private async pickAndImport(): Promise<void> {
    const files = await api().paperPickFiles();
    if (files.length) await this.importFiles(files);
  }

  async importFiles(files: string[]): Promise<void> {
    if (this.stage || this.progress) return;
    this.progress = { phase: "render", done: 0, total: files.length, message: PT.staging };
    this.render();
    try {
      const r = await api().paperStage(files);
      const fz = new Map(r.pages.map((p: StagedPage) => [p.key, p.fz ?? ""]));
      const include = new Map(r.pages.map((p: StagedPage) => [p.key, !p.dupOf]));
      this.stage = { ...r, fz, include, showAuto: false };
      if (!this.el.isConnected) toast(PT.stageReady(r.pages.length), 8000);
    } catch (e) {
      toast(PT.stageFailed((e as Error).message), 6000);
    }
    this.progress = null;
    this.render();
  }

  private renderStage(): void {
    this.cols.hidden = true;
    this.stageEl.hidden = false;
    if (!this.stage) {
      const p = this.progress;
      const label = !p ? PT.staging : p.phase === "ocr" ? PT.ocr(p.done, p.total) : p.message ?? PT.render(p.done, p.total);
      const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
      this.stageEl.replaceChildren(
        h(
          "div",
          { class: "pp-progress" },
          h("div", { class: "pp-ptext", text: label }),
          h("div", { class: "pp-pbar" }, h("i", { style: `width:${pct}%` })),
          p?.phase === "ocr" ? h("div", { class: "muted", text: PT.ocrSlow }) : null,
        ),
      );
      return;
    }
    const st = this.stage;
    const base = `paper/.staging/${st.batch}/`;
    const review = st.pages.filter((p) => p.status !== "auto");
    const auto = st.pages.filter((p) => p.status === "auto");
    const row = (p: StagedPage) => {
      const input = h("input", { class: "pp-in", value: st.fz.get(p.key) ?? "", "data-key": p.key, placeholder: "?", spellcheck: "false" }) as HTMLInputElement;
      const check = () => input.classList.toggle("bad", !!input.value.trim() && !parseFz(input.value));
      check();
      input.addEventListener("input", () => {
        st.fz.set(p.key, input.value);
        check();
        this.updateCommit();
      });
      const inc = h("input", { type: "checkbox", class: "pp-inc", checked: st.include.get(p.key) ?? true }) as HTMLInputElement;
      inc.addEventListener("change", () => {
        st.include.set(p.key, inc.checked);
        this.updateCommit();
      });
      const cands = (p.ocr?.candidates ?? []).map((c) => {
        const b = h("button", { class: "chip pp-cand", text: c });
        b.addEventListener("click", () => {
          input.value = c;
          st.fz.set(p.key, c);
          check();
          this.updateCommit();
        });
        return b;
      });
      const whole = h("button", { class: "pp-link", text: PT.wholePage });
      whole.addEventListener("click", () => lightbox(vaultUrl(base + p.key + ".jpg")));
      return h(
        "div",
        { class: "pp-srow" + (p.status === "auto" ? " auto" : ""), "data-key": p.key },
        h("img", { class: "pp-crop", src: vaultUrl(base + p.key + ".crop.png"), alt: "", draggable: "false" }),
        h(
          "div",
          { class: "pp-sinfo" },
          h("div", { class: "pp-sline" }, h("span", { class: "muted", text: `${p.source.name} p.${p.source.page}` }), whole),
          h("div", { class: "pp-sline" }, input, ...(cands.length ? [h("span", { class: "muted", text: PT.candidates }), ...cands] : [])),
          p.ocr?.reason ? h("div", { class: p.status === "auto" ? "muted" : "pp-warn", text: `${p.ocr.reads.length ? p.ocr.reads.join(" / ") + " — " : ""}${p.ocr.reason}` }) : null,
          p.dupOf ? h("div", { class: "pp-warn", text: p.dupOf.startsWith("batch:") ? PT.dupInBatch : PT.dupOf }) : null,
        ),
        h("label", { class: "pp-incl" }, inc, PT.include),
      );
    };
    const toggle = h("button", { class: "pp-link", text: st.showAuto ? PT.hideAuto : PT.showAuto });
    toggle.addEventListener("click", () => {
      st.showAuto = !st.showAuto;
      this.renderStage();
    });
    const commit = h("button", { class: "btn primary pp-commit" });
    commit.addEventListener("click", () => void this.commit());
    const cancel = h("button", { class: "btn pp-cancel", text: PT.cancel });
    cancel.addEventListener("click", () => void this.cancelStage());
    this.stageEl.replaceChildren(
      h(
        "div",
        { class: "pp-shead" },
        h("div", { class: "rec-h", text: PT.reviewTitle(st.pages.length) }),
        st.ocrError ? h("div", { class: "pp-warn", text: PT.ocrUnavailable(st.ocrError) }) : h("div", { class: "muted", text: PT.reviewHelp }),
        h("div", { class: "pp-invalid pp-warn" }),
      ),
      h(
        "div",
        { class: "pp-sbody" },
        ...review.map(row),
        auto.length ? h("div", { class: "pp-autohead" }, h("span", { text: PT.autoOk(auto.length) }), toggle) : null,
        ...(st.showAuto ? auto.map(row) : []),
      ),
      h("div", { class: "pp-sfoot" }, cancel, commit),
    );
    this.updateCommit();
  }

  private updateCommit(): void {
    const st = this.stage;
    if (!st) return;
    const inc = st.pages.filter((p) => st.include.get(p.key));
    const bad = inc.filter((p) => {
      const v = (st.fz.get(p.key) ?? "").trim();
      return v && !parseFz(v);
    }).length;
    const b = this.stageEl.querySelector<HTMLButtonElement>(".pp-commit");
    if (b) {
      b.textContent = PT.commit(inc.length);
      b.disabled = bad > 0 || !inc.length;
    }
    const w = this.stageEl.querySelector<HTMLElement>(".pp-invalid");
    if (w) w.textContent = bad ? PT.invalidLeft(bad) : "";
  }

  private async commit(): Promise<void> {
    const st = this.stage;
    if (!st) return;
    const decisions = st.pages.map((p) => ({ key: p.key, fz: (st.fz.get(p.key) ?? "").trim() || null, include: !!st.include.get(p.key) }));
    try {
      const before = new Set(paperStore.index.pages.map((p) => p.pid));
      const ix = await api().paperCommit(st.batch, decisions);
      this.stage = null;
      paperStore.set(ix);
      const added = ix.pages.filter((p: PaperPage) => !before.has(p.pid));
      const first = ordered(ix).find((p) => added.some((a: PaperPage) => a.pid === p.pid)) ?? added[0];
      if (first) {
        this.pid = first.pid;
        this.series = first.fz && parseFz(first.fz) ? parseFz(first.fz)!.series : "undecided";
      }
      this.render();
      toast(PT.committed(added.length));
    } catch (e) {
      toast((e as Error).message, 6000);
    }
  }

  private async cancelStage(): Promise<void> {
    const st = this.stage;
    this.stage = null;
    if (st) await api().paperDiscard(st.batch);
    this.render();
  }

  // ---------- 詳細設定 ----------
  private async openSettings(): Promise<void> {
    const s = await api().paperOcrSettings();
    const model = h("input", { class: "pp-set-in", value: (s.models as { model: string; batch: number }[]).map((m) => `${m.model}×${m.batch}`).join(", ") }) as HTMLInputElement;
    const url = h("input", { class: "pp-set-in", value: s.url }) as HTMLInputElement;
    const cw = h("input", { class: "pp-set-in", type: "number", min: "5", max: "100", value: String(Math.round(s.crop.w * 100)) }) as HTMLInputElement;
    const ch = h("input", { class: "pp-set-in", type: "number", min: "3", max: "100", value: String(Math.round(s.crop.h * 100)) }) as HTMLInputElement;
    const save = h("button", { class: "btn primary", text: PT.save });
    const cancel = h("button", { class: "btn", text: PT.cancel });
    const field = (label: string, el: HTMLElement) => h("label", { class: "pp-set-row" }, h("span", { text: label }), el);
    const box = h(
      "div",
      { class: "dialog pp-set" },
      h("h3", { text: PT.setTitle }),
      field(PT.setModel, model),
      field(PT.setUrl, url),
      field(PT.setCropW, cw),
      field(PT.setCropH, ch),
      h("div", { class: "pp-set-row" }, h("span", { text: PT.setStatus }), h("span", { class: s.status ? "pp-warn" : "", text: s.status ?? PT.setOk })),
      h("div", { class: "pp-sfoot" }, cancel, save),
    );
    const back = h("div", { class: "backdrop" }, box);
    const close = () => back.remove();
    cancel.addEventListener("click", close);
    back.addEventListener("click", (e) => e.target === back && close());
    save.addEventListener("click", async () => {
      const models = model.value
        .split(/[,、\s]+/)
        .filter(Boolean)
        .map((x) => {
          const [m, b] = x.split(/[×x*](?=\d+$)/);
          return { model: m!.trim(), batch: Number(b) || 1 };
        });
      await api().paperSetOcrSettings({ engine: models.length ? "ollama" : "none", models, url: url.value.trim(), crop: { w: Number(cw.value) / 100, h: Number(ch.value) / 100 } });
      close();
    });
    document.body.append(back);
  }
}

/** ページ全体を大きく見る(取り込み前の確認) */
function lightbox(src: string): void {
  const back = h("div", { class: "backdrop pp-lightbox" }, h("img", { src, alt: "" }));
  back.addEventListener("click", () => back.remove());
  document.body.append(back);
}
