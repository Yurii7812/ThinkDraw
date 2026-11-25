// 引く(SPEC 第 7 章 + 2026-11-22 の希望): 「引く」の横の ▾ で、デッキのタブ(タロット/易/発想カード/設定)。
// 問いを書いてから引くと、問いを文字として置き、カードをそこにつなぐ。
import { newId } from "../core/ids";
import { freeOffset } from "../core/placement";
import { CARD_H, CARD_W, placeFree, placeSpread, type Placement, type SpreadDef } from "../core/spreadLayout";
import type { Vault } from "../core/vault";
import { cardDef, DECKS, spreadDef } from "../decks";
import { DEFAULT_DRAW, drawIching, drawPrompt, drawTarot, type DrawSettings } from "../decks/draw";
import { HEX_BY_ID } from "../decks/iching";
import { CUSTOM_GROUP, nextCustomId, PROMPT_SETS, type CustomPromptSet } from "../decks/prompts";
import { makeRand, RNG_METHODS, type RngMethod } from "../decks/rng";
import { faceHeight, hexSvg } from "./cardface";
import { T } from "./strings";
import { api, h, svg, toast } from "./ui";

/** 最後に使った引き方(「引く」ボタンで同じものをもう一度) */
export type DrawKind =
  | { k: "tarot"; spread: string | null; count: number; blank?: boolean }
  | { k: "iching" }
  | { k: "prompt"; mode: "one" | "random" }
  | { k: "promptSet"; set: string };

export interface DrawConfig extends DrawSettings {
  method: RngMethod;
  seedText: string;
  last: DrawKind;
}
export const DEFAULT_CONFIG: DrawConfig = { ...DEFAULT_DRAW, method: "crypto", seedText: "", last: { k: "tarot", spread: "one", count: 1 } };

export interface DrawTarget {
  vault: Vault;
  group: string;
  center: { x: number; y: number };
  /** 選んでいるノード(発想カードをつなぐ先) */
  anchor: string | null;
  /** anchor のまわりの空いている所 */
  spotNear(id: string): { x: number; y: number };
  /** 置く前にあったもの(重ならないようにずらすため) */
  obstacles: { x: number; y: number; w: number; h: number }[];
}

export function drawLabel(k: DrawKind): string {
  if (k.k === "tarot") return k.spread ? DECKS.tarot.spreads.find((s) => s.id === k.spread)?.name ?? T.deckTarot : T.drawFreeN(k.count);
  if (k.k === "iching") return T.ichingCast;
  if (k.k === "prompt") return k.mode === "one" ? T.promptOne : T.promptRandom;
  return PROMPT_SETS.find((s) => s.id === k.set)?.name ?? T.deckPrompt;
}

/** 引いて置く。置いたノードの ID を返す */
export function runDraw(t: DrawTarget, cfg: DrawConfig, kind: DrawKind, question: string): string[] {
  const v = t.vault;
  const rand = makeRand(cfg.method, cfg.seedText || question);
  const ids: string[] = [];
  const run = newId(() => false);
  v.tx(() => {
    const putQuestion = (x: number, y: number): string | null => {
      if (!question.trim()) return null;
      return v.create({ type: "text", title: question.trim(), group: t.group, x, y }).id;
    };
    if (kind.k === "tarot") {
      const sp = kind.spread ? DECKS.tarot.spreads.find((s) => s.id === kind.spread) : undefined;
      const places: Placement[] = sp ? placeSpread(sp, t.center) : placeFree(Math.max(1, Math.min(78, kind.count)), t.center);
      // 出たものを並べるモード: まだ選んでいない(空の)カードを、形のとおりに置く
      const cards = kind.blank ? places.map(() => ({ def: { id: "", ja: T.cardBlankName }, reversed: false })) : drawTarot(places.length, cfg, rand);
      const top = Math.min(...places.map((p) => p.y));
      const q = putQuestion(Math.round(t.center.x - 60), Math.round(top - 90));
      places.slice(0, cards.length).forEach((p, i) => {
        const c = cards[i];
        const n = v.create({
          type: "card", title: c.def.ja, group: t.group, x: p.x, y: p.y,
          card: { deck: "tarot", id: c.def.id, reversed: c.reversed },
          spread: p.pos ? { run, pos: p.pos.id, spread: sp!.id } : { run },
        });
        ids.push(n.id);
        if (q) v.addLink(q, n.id);
      });
      if (q) ids.unshift(q);
    } else if (kind.k === "iching") {
      const r = drawIching(rand);
      const hgt = faceHeight("iching", CARD_H);
      const x0 = Math.round(t.center.x - (r.after ? CARD_W + 40 : CARD_W / 2));
      const y0 = Math.round(t.center.y - hgt / 2);
      const q = putQuestion(x0, y0 - 90);
      const base = v.create({ type: "card", title: r.base.name, group: t.group, x: x0, y: y0, card: { deck: "iching", id: r.base.id, reversed: false, moving: r.moving }, spread: { run } });
      ids.push(base.id);
      if (q) {
        v.addLink(q, base.id);
        ids.unshift(q);
      }
      if (r.after) {
        const after = v.create({ type: "card", title: r.after.name, group: t.group, x: x0 + CARD_W + 80, y: y0, card: { deck: "iching", id: r.after.id, reversed: false }, spread: { run } });
        v.addLink(base.id, after.id, "arrow");
        ids.push(after.id);
      }
    } else if (kind.k === "prompt") {
      const sets = kind.mode === "one" ? cfg.promptSets : PROMPT_SETS.map((s) => s.id);
      const p = drawPrompt(sets, rand);
      const pos = t.anchor ? t.spotNear(t.anchor) : { x: Math.round(t.center.x - 50), y: Math.round(t.center.y - 14) };
      const n = v.create({ type: "card", title: p.name, group: t.group, x: pos.x, y: pos.y, card: { deck: "prompt", id: p.id, reversed: false } });
      if (t.anchor) v.addLink(t.anchor, n.id);
      ids.push(n.id);
    } else {
      // 発想カードの種類を、全部並べる(3 列の表。選んでいるものの下か、画面の真ん中)
      const set = PROMPT_SETS.find((s) => s.id === kind.set)!;
      // 札は文字と同じ大きさなので、間を詰めて 2 列(2026-11-24)
      const hgt = 56;
      const CW = 150;
      const cols = 2;
      let ox: number, oy: number;
      if (t.anchor) {
        const a = v.itemPos(t.group, t.anchor)!;
        ox = a.x;
        oy = a.y + 80;
      } else {
        const rows = Math.ceil(set.items.length / cols);
        ox = Math.round(t.center.x - (cols * CW) / 2);
        oy = Math.round(t.center.y - (rows * hgt) / 2);
      }
      set.items.forEach((p, i) => {
        const n = v.create({ type: "card", title: p.name, group: t.group, x: ox + (i % cols) * CW, y: oy + Math.floor(i / cols) * hgt, card: { deck: "prompt", id: p.id, reversed: false }, spread: { run } });
        if (t.anchor) v.addLink(t.anchor, n.id);
        ids.push(n.id);
      });
    }
    // すでにあるものと重なるなら、まとめて一番近い空いた所へずらす(つなぐ先の近くに置く 1 枚は除く)
    if (ids.length > 1 || !t.anchor) {
      const boxes = ids.map((id) => {
        const p = v.itemPos(t.group, id)!;
        const n = v.get(id)!;
        const w = n.type === "card" ? CARD_W : 120;
        const hh = n.type === "card" ? faceHeight(n.card!.deck, CARD_H) + 34 : 30;
        return { x: p.x, y: p.y, w, h: hh };
      });
      const { dx, dy } = freeOffset(boxes, t.obstacles);
      if (dx || dy) v.move(t.group, ids.map((id) => { const p = v.itemPos(t.group, id)!; return { id, x: p.x + dx, y: p.y + dy }; }));
    }
  });
  return ids;
}

// ---------- メニュー ----------
function mini(s: SpreadDef): SVGSVGElement {
  const xs = s.pos.map((p) => p.x), ys = s.pos.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 72, H = 46, cw = 7, ch = 11;
  const k = Math.min((W - cw) / Math.max(1, x1 - x0), (H - ch) / Math.max(1, y1 - y0), 0.09);
  const ox = (W - (x1 - x0) * k - cw) / 2, oy = (H - (y1 - y0) * k - ch) / 2;
  const el = svg("svg", { class: "dm-mini", viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  for (const p of s.pos) el.append(svg("rect", { x: (ox + (p.x - x0) * k).toFixed(1), y: (oy + (p.y - y0) * k).toFixed(1), width: cw, height: ch, rx: 1.5 }));
  return el;
}

/** カードの略号(検索用): 大アルカナ M0〜M21・小アルカナ S(ソード)W(ワンド)C(カップ)P(ペンタクル)+ 1〜10・P(ペイジ)N(ナイト)Q(クイーン)K(キング)。例 S1・WP */
export function cardCode(id: string): string {
  const m = /^([mwcsp])(\d+)$/.exec(id);
  if (!m) return id.toUpperCase();
  const n = Number(m[2]);
  if (m[1] === "m") return "M" + n;
  return m[1].toUpperCase() + (n > 10 ? "PNQK"[n - 11] : n);
}
/** 大アルカナのカタカナの呼び名(「デビル」「タワー」でも探せる) */
const KANA: Record<string, string> = { m0: "フール", m1: "マジシャン", m2: "ハイプリエステス", m3: "エンプレス", m4: "エンペラー", m5: "ハイエロファント", m6: "ラバーズ", m7: "チャリオット", m8: "ストレングス", m9: "ハーミット", m10: "ホイールオブフォーチュン", m11: "ジャスティス", m12: "ハングドマン", m13: "デス", m14: "テンパランス", m15: "デビル", m16: "タワー", m17: "スター", m18: "ムーン", m19: "サン", m20: "ジャッジメント", m21: "ワールド" };
/** 検索: 略号(S1・WP・M0。W11 のような数でも)・日本語名・英語名 */
export function searchTarot(q: string): CardDefLite[] {
  const t = q.trim().toLowerCase();
  const all = DECKS.tarot.cards;
  if (!t) return all;
  const u = t.toUpperCase();
  const num = /^([WCSP])(1[1-4])$/.exec(u);
  const code = num ? u[0] + "PNQK"[Number(num[2]) - 11] : u;
  const exact = all.filter((c) => cardCode(c.id) === code);
  if (exact.length) return exact;
  return all.filter((c) => cardCode(c.id).startsWith(u) || c.ja.includes(q.trim()) || (KANA[c.id] ?? "").includes(q.trim()) || c.en.toLowerCase().includes(t));
}
type CardDefLite = (typeof DECKS.tarot.cards)[number];

/** 並べてあるカードに、紙で出たカードを当てはめる画面(略号・名前で探す。Enter で決める・Shift+Enter で逆位置) */
export function openCardSearch(current: { id: string; reversed: boolean }, pick: (id: string, reversed: boolean) => void): void {
  const back = h("div", { class: "backdrop" });
  const input = h("input", { type: "text", class: "manual-card", placeholder: T.cardSearchPh, spellcheck: "false" }) as HTMLInputElement;
  const rv = h("input", { type: "checkbox", class: "manual-rev" }) as HTMLInputElement;
  rv.checked = current.reversed;
  const list = h("div", { class: "card-results" });
  let hits: CardDefLite[] = [];
  let at = 0;
  const close = () => {
    back.remove();
    removeEventListener("keydown", onKey, true);
  };
  const choose = (c: CardDefLite, reversed: boolean) => {
    close();
    pick(c.id, reversed);
  };
  const fill = () => {
    hits = searchTarot(input.value).slice(0, 12);
    at = Math.min(at, Math.max(0, hits.length - 1));
    list.replaceChildren(
      ...hits.map((c, i) => {
        const b = h("button", { class: "card-result" + (i === at ? " on" : ""), "data-id": c.id }, h("span", { class: "card-code", text: cardCode(c.id) }), h("span", { text: c.ja }), h("span", { class: "muted small", text: c.en }));
        b.addEventListener("click", () => choose(c, rv.checked));
        return b;
      }),
    );
    if (!hits.length) list.append(h("div", { class: "muted small", text: T.cardSearchNone }));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  input.addEventListener("input", () => {
    at = 0;
    fill();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      at = (at + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % Math.max(1, hits.length);
      fill();
    } else if (e.key === "Enter" && hits[at]) {
      e.preventDefault();
      choose(hits[at], e.shiftKey ? !rv.checked : rv.checked);
    }
  });
  back.append(h("div", { class: "modal manual" }, h("div", { class: "modal-title", text: T.cardSearchTitle }), h("p", { class: "muted small", text: T.cardSearchHelp }), h("div", { class: "manual-row" }, input, h("label", { class: "check" }, rv, T.manualReversed)), list));
  back.addEventListener("mousedown", (e) => e.target === back && close());
  addEventListener("keydown", onKey, true);
  fill();
  document.body.append(back);
  input.focus();
}

type Tab = "tarot" | "iching" | "prompt" | "settings";
let openPop: HTMLElement | null = null;
export function closeDrawMenu(): void {
  openPop?.remove();
  openPop = null;
}
export function drawMenuOpen(): boolean {
  return !!openPop;
}

/**
 * 引くメニューを開く。go(kind, question) で引く。設定を変えたら save(cfg)。
 */
export interface CustomSetsHost {
  sets(): CustomPromptSet[];
  save(sets: CustomPromptSet[]): void;
}

export function openDrawMenu(anchorEl: HTMLElement, cfg: DrawConfig, tab: Tab, hasAnchor: boolean, go: (k: DrawKind, q: string) => void, save: (c: DrawConfig) => void, customs?: CustomSetsHost): void {
  closeDrawMenu();
  const pop = h("div", { class: "drawmenu", role: "dialog" });
  let question = "";
  const tabs: [Tab, string][] = [["tarot", T.deckTarot], ["iching", T.deckIching], ["prompt", T.deckPrompt], ["settings", T.settingsTitle]];
  const tile = (o: { name: string; sub?: string; pic?: Element | null; big?: boolean; n?: string; run: () => void; blank?: () => void }) => {
    const b = h("button", { class: "dm-tile" + (o.big ? " big" : "") }, o.pic ?? null, h("span", { class: "dm-tx" }, h("b", { text: o.name }), o.sub ? h("small", { text: o.sub }) : null), o.n ? h("i", { class: "dm-n", text: o.n }) : null);
    b.addEventListener("click", () => {
      closeDrawMenu();
      o.run();
    });
    // 右クリック: 引かずに、紙で出たものを並べるモード(空のカードを形のとおりに置く)
    if (o.blank) {
      b.title = T.drawBlankTip;
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        closeDrawMenu();
        o.blank!();
      });
    }
    return b;
  };
  const qInput = () => {
    const i = h("input", { class: "dm-q", placeholder: T.questionPlaceholder, value: question });
    i.addEventListener("input", () => (question = i.value));
    i.addEventListener("keydown", (e) => e.stopPropagation());
    return i;
  };
  const render = (t: Tab) => {
    tab = t;
    // 2026-11-24 見本 D: タブは小さな切り替え、設定は右の ⚙
    const head = h("div", { class: "dm-tabs" });
    for (const [k, label] of tabs) {
      const b = h("button", { class: (k === t ? "on" : "") + (k === "settings" ? " dm-gear" : ""), text: k === "settings" ? "⚙" : label, title: label, "aria-label": label });
      b.addEventListener("click", () => render(k));
      if (k === "settings") head.append(h("span", { class: "dm-gap" }));
      head.append(b);
    }
    pop.classList.toggle("narrow", t === "prompt");
    const body = h("div", { class: "dm-body" });
    if (t === "tarot") {
      const groups: [string, string[]][] = [
        ["1〜3 枚", ["one", "three", "three-sit", "three-rel", "three-mbs"]],
        ["4〜7 枚", ["diamond", "five", "choice", "hexagram", "horseshoe"]],
        ["たくさん", ["celtic", "tree", "year", "horoscope"]],
      ];
      body.append(qInput(), h("div", { class: "dm-note", text: T.drawBlankHint }));
      for (const [g, ids] of groups) {
        body.append(h("div", { class: "dm-h", text: g }));
        const grid = h("div", { class: "dm-grid" });
        for (const id of ids) {
          const s = DECKS.tarot.spreads.find((x) => x.id === id);
          if (!s) continue;
          grid.append(tile({ name: s.name.replace(/(.+?)(（.*）)$/, "$1"), sub: s.pos.map((p) => p.name).join("・"), pic: mini(s), n: `${s.pos.length}枚`, run: () => go({ k: "tarot", spread: s.id, count: s.pos.length }, question), blank: () => go({ k: "tarot", spread: s.id, count: s.pos.length, blank: true }, question) }));
        }
        body.append(grid);
      }
      const count = h("input", { type: "number", min: 1, max: 78, value: "3", class: "count-input" });
      count.addEventListener("keydown", (e) => e.stopPropagation());
      const free = h("button", { class: "btn small", text: T.drawGo });
      free.addEventListener("click", () => {
        closeDrawMenu();
        go({ k: "tarot", spread: null, count: Math.max(1, Math.min(78, Number(count.value) || 1)) }, question);
      });
      body.append(h("div", { class: "dm-h", text: T.drawFree }), h("div", { class: "row" }, count, h("span", { text: "枚" }), free));
      // タロット小冊子(A6・64 ページ。コンビニで印刷できる A4 面付けと、画面で読む用)
      const save = (kind: "print" | "read") => async () => {
        closeDrawMenu();
        try {
          const data = await api().bookletRead(kind);
          const p = await api().exportSave(kind === "print" ? T.bookletPrintFile : T.bookletReadFile, "PDF", ["pdf"], data);
          if (p) toast(T.bookletSaved(p));
        } catch (e) {
          toast(T.bookletFail((e as Error).message));
        }
      };
      const bp = h("button", { class: "btn small", title: T.bookletPrintTip, text: T.bookletPrint });
      const br = h("button", { class: "btn small", title: T.bookletReadTip, text: T.bookletRead });
      bp.addEventListener("click", save("print"));
      br.addEventListener("click", save("read"));
      body.append(h("div", { class: "dm-h", text: T.bookletHead }), h("div", { class: "row" }, bp, br), h("div", { class: "dm-note", text: T.bookletHint }));
    } else if (t === "iching") {
      body.append(
        qInput(),
        tile({ big: true, name: T.ichingCast, sub: T.ichingCastSub, pic: hexSvg(HEX_BY_ID.h11.lines, [2], 40), run: () => go({ k: "iching" }, question) }),
        h("ol", { class: "dm-steps" },
          h("li", {}, h("b", { text: T.ichingBase }), " " + T.ichingBaseHint),
          h("li", {}, h("b", { text: T.ichingMoving }), " " + T.ichingMovingShort),
          h("li", {}, h("b", { text: T.ichingAfter }), " " + T.ichingAfterHint)),
      );
    } else if (t === "prompt") {
      // 2026-11-24 見本 D: 小さく。上に「1 枚引く」「ランダム」、下に種類を 1 行ずつ(中身の言葉はマウスを乗せたとき)
      const btn = (label: string, title: string, run: () => void) => {
        const b = h("button", { class: "dm-btn", title, text: label });
        b.addEventListener("click", () => {
          closeDrawMenu();
          run();
        });
        return b;
      };
      body.append(
        h("div", { class: "dm-btns" },
          btn(T.promptOne, T.promptOneSub + (hasAnchor ? T.promptConnect : ""), () => go({ k: "prompt", mode: "one" }, "")),
          btn(T.promptRandomShort, T.promptRandomSub, () => go({ k: "prompt", mode: "random" }, ""))),
        h("div", { class: "dm-note", text: hasAnchor ? T.promptAllNear : T.promptAll }),
      );
      let lastGroup = "";
      for (const s of PROMPT_SETS.filter((x) => x.id !== "word" && x.id !== "ask")) {
        if (s.group !== lastGroup) {
          lastGroup = s.group;
          body.append(h("div", { class: "dm-h", text: s.group }));
        }
        if (s.id.startsWith("my-") && customs) {
          // 自分の種類: 押すと並べる・✎ で直す
          const edit = h("button", { class: "dm-edit", title: T.customEdit, "aria-label": T.customEdit, text: "✎" });
          edit.addEventListener("click", (e) => {
            e.stopPropagation();
            closeDrawMenu();
            editCustomSet(customs, s.id);
          });
          const row = h("div", { class: "dm-row", role: "button", tabindex: "0", title: s.items.map((i) => i.name).join("・") }, h("span", { class: `dm-dot c${s.color}` }), h("span", { class: "dm-row-t", text: s.name }), h("span", { class: "dm-row-n", text: `${s.items.length}枚` }), edit);
          row.addEventListener("click", () => {
            if (!s.items.length) return;
            closeDrawMenu();
            go({ k: "promptSet", set: s.id }, "");
          });
          body.append(row);
          continue;
        }
        const row = h("button", { class: "dm-row", title: s.desc + "\n" + s.items.map((i) => i.name).join("・") }, h("span", { class: `dm-dot c${s.color}` }), h("span", { class: "dm-row-t", text: s.name }), h("span", { class: "dm-row-n", text: `${s.items.length}枚` }));
        row.addEventListener("click", () => {
          closeDrawMenu();
          go({ k: "promptSet", set: s.id }, "");
        });
        body.append(row);
      }
      if (customs) {
        if (!customs.sets().length) body.append(h("div", { class: "dm-h", text: CUSTOM_GROUP }));
        const add = h("button", { class: "dm-row dm-add", text: T.customAdd });
        add.addEventListener("click", () => {
          closeDrawMenu();
          editCustomSet(customs, null);
        });
        body.append(add);
      }
    } else {
      const set = (patch: Partial<DrawConfig>) => {
        Object.assign(cfg, patch);
        save(cfg);
        render("settings");
      };
      const check = (label: string, on: boolean, f: (v: boolean) => void) => {
        const i = h("input", { type: "checkbox" });
        i.checked = on;
        i.addEventListener("change", () => f(i.checked));
        return h("label", { class: "check" }, i, label);
      };
      const select = <K extends string>(label: string, val: K, opts: [K, string][], f: (v: K) => void) => {
        const s = h("select", {});
        for (const [k, t2] of opts) {
          const o = h("option", { value: k, text: t2 });
          if (k === val) o.selected = true;
          s.append(o);
        }
        s.addEventListener("change", () => f(s.value as K));
        return h("label", { class: "dm-field" }, h("span", { text: label }), s);
      };
      body.append(
        check(T.drawReversed, cfg.reversed, (v) => set({ reversed: v })),
        select(T.poolLabel, cfg.pool, [["all", T.poolAll], ["major", T.poolMajor], ["minor", T.poolMinor]], (v) => set({ pool: v })),
        select(T.shuffleLabel, cfg.shuffle, [["full", T.shuffleFull], ["riffle", T.shuffleRiffle]], (v) => set({ shuffle: v })),
      );
      if (cfg.shuffle === "riffle") {
        const r = h("input", { type: "range", min: 1, max: 12, value: String(cfg.riffles) });
        const lab = h("span", { class: "muted", text: `${cfg.riffles}回` });
        r.addEventListener("input", () => (lab.textContent = `${r.value}回`));
        r.addEventListener("change", () => set({ riffles: +r.value }));
        body.append(h("div", { class: "row" }, h("span", { class: "muted", text: T.riffleCount }), r, lab));
      }
      body.append(select(T.methodLabel, cfg.method, RNG_METHODS.map(([k, t2, d]) => [k, `${t2}(${d})`] as [RngMethod, string]), (v) => set({ method: v })));
      if (cfg.method === "word") {
        const i = h("input", { class: "dm-q", placeholder: T.seedPlaceholder, value: cfg.seedText });
        i.addEventListener("keydown", (e) => e.stopPropagation());
        i.addEventListener("change", () => set({ seedText: i.value }));
        body.append(i);
      }
      body.append(h("div", { class: "dm-h", text: T.promptSetsLabel }));
      const checks = h("div", { class: "checks" });
      for (const s of PROMPT_SETS)
        checks.append(check(s.name, cfg.promptSets.includes(s.id), (v) => set({ promptSets: v ? [...cfg.promptSets, s.id] : cfg.promptSets.filter((x) => x !== s.id) })));
      body.append(checks);
    }
    pop.replaceChildren(head, body);
  };
  render(tab);
  document.body.append(pop);
  const b = anchorEl.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(b.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + "px";
  pop.style.top = b.bottom + 6 + "px";
  openPop = pop;
  setTimeout(() => (pop.querySelector(".dm-q") as HTMLInputElement | null)?.focus(), 0);
}

addEventListener("pointerdown", (e) => {
  if (openPop && !openPop.contains(e.target as Node) && !(e.target as Element).closest?.(".tbtn.draw")) closeDrawMenu();
}, true);
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openPop) {
    e.stopPropagation();
    closeDrawMenu();
  }
}, true);

// ---------- カードにカーソルを合わせたときの小さな窓 ----------
let tip: HTMLElement | null = null;
let tipFor: string | null = null;
let tipTimer: ReturnType<typeof setTimeout> | undefined;

export function cardTip(v: Vault, id: string | null, e?: MouseEvent): void {
  if (!id) {
    clearTimeout(tipTimer);
    tip?.remove();
    tip = null;
    tipFor = null;
    return;
  }
  if (tipFor === id && tip && e) {
    position(e);
    return;
  }
  clearTimeout(tipTimer);
  tip?.remove();
  tip = null;
  tipFor = id;
  const ev = e;
  tipTimer = setTimeout(() => {
    const n = v.get(id);
    if (!n?.card || tipFor !== id) return;
    let parts: (HTMLElement | null)[] = [];
    if (n.card.deck === "tarot") {
      const def = cardDef(n.card.deck, n.card.id);
      if (!def) return;
      const rv = n.card.reversed;
      const pos = n.spread?.pos ? spreadDef(n.card.deck, n.spread.spread)?.pos.find((p) => p.id === n.spread!.pos) : undefined;
      parts = [
        h("div", { class: "ct-name", text: `${def.ja}  ${def.en}` }),
        h("div", { class: "ct-orient", text: rv ? T.reversedLabel : T.upright }),
        h("div", { class: "ct-text", text: (rv ? def.rv : def.up) ?? "" }),
        pos ? h("div", { class: "ct-pos" }, h("b", { text: `${T.positionMeaning}(${pos.name}): ` }), pos.hint) : null,
      ];
    } else if (n.card.deck === "iching") {
      const hx = HEX_BY_ID[n.card.id];
      if (!hx) return;
      parts = [h("div", { class: "ct-name", text: `第${hx.num}卦 ${hx.name}` }), h("div", { class: "ct-orient", text: hx.kw }), h("div", { class: "ct-text", text: hx.text })];
    } else return;
    tip = h("div", { class: "cardtip" }, ...parts);
    document.body.append(tip);
    if (ev) position(ev);
  }, 350);
}
function position(e: MouseEvent): void {
  if (!tip) return;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 16;
  if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

/** 自分の種類を作る・直す窓。名前と、1 行 1 枚(「言葉: 問い」か問いだけ) */
function editCustomSet(host: CustomSetsHost, id: string | null): void {
  const sets = host.sets();
  const cur = id ? sets.find((s) => s.id === id) : undefined;
  const name = h("input", { type: "text", class: "ask-input", placeholder: T.customNamePh, value: cur?.name ?? "" }) as HTMLInputElement;
  const lines = h("textarea", { class: "ask-input custom-lines", rows: 10, placeholder: T.customLinesPh }) as HTMLTextAreaElement;
  lines.value = (cur?.lines ?? []).join("\n");
  const ok = h("button", { class: "btn primary", text: "OK" });
  const cancel = h("button", { class: "btn", text: T.cancel });
  const del = cur ? h("button", { class: "btn danger", text: T.customDelete }) : null;
  const box = h(
    "div",
    { class: "modal custom-set" },
    h("div", { class: "modal-title", text: cur ? T.customEditTitle : T.customAddTitle }),
    h("label", { class: "kind-field" }, h("span", { class: "set-label", text: T.customName }), name),
    h("label", { class: "kind-field" }, h("span", { class: "set-label", text: T.customLines }), lines),
    h("p", { class: "muted small", text: T.customHelp }),
    h("div", { class: "row-end" }, del, h("span", { class: "rec-gap" }), cancel, ok),
  );
  const back = h("div", { class: "backdrop" }, box);
  const close = () => back.remove();
  for (const el of [name, lines] as HTMLElement[]) el.addEventListener("keydown", (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
  });
  cancel.addEventListener("click", close);
  del?.addEventListener("click", () => {
    host.save(sets.filter((s) => s.id !== id));
    close();
  });
  ok.addEventListener("click", () => {
    const n = name.value.trim();
    if (!n) return name.focus();
    const ls = lines.value.split("\n").map((l) => l.trim()).filter(Boolean);
    const next = cur ? sets.map((s) => (s.id === id ? { ...s, name: n, lines: ls } : s)) : [...sets, { id: nextCustomId(sets), name: n, lines: ls }];
    host.save(next);
    close();
    toast(T.customSaved(n));
  });
  back.addEventListener("mousedown", (e) => e.target === back && close());
  document.body.append(back);
  name.focus();
}
