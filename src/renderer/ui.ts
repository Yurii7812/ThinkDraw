// 画面の小さな部品: 要素の作成・知らせ・右クリックのメニュー
import type { ThinkDrawApi } from "../main/preload";

declare global {
  interface Window {
    thinkdraw: ThinkDrawApi;
  }
}
export const api = (): ThinkDrawApi => window.thinkdraw;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const SVG_NS = "http://www.w3.org/2000/svg";
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 2600): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el!.classList.remove("show"), ms);
}

export interface MenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  /** 色の見本など、横並びの小さなボタン */
  swatches?: { color: number; title: string; action: () => void; active?: boolean; key?: string }[];
  sub?: MenuItem[];
  separator?: boolean;
  checked?: boolean;
  /** 右に出すショートカットの書き方(Ctrl+L など) */
  hint?: string;
  /** 赤い字(消すなど) */
  danger?: boolean;
  /** 一番上に横に並べる、絵と名前の大きなボタン(右クリックの「よく使う操作」) */
  bar?: { icon: string; label: string; title?: string; action: () => void; danger?: boolean; keepOpen?: boolean; key?: string; hint?: string }[];
  /** 小さな図・名前・説明・ショートカットの大きなボタンを縦に(束ねる・引用で新しいグループ・枠で囲む の違いを見せる) */
  cards?: { diagram: string; title: string; desc: string; hint?: string; action: () => void }[];
  /** 名前の下に小さく出す説明 */
  desc?: string;
  /** 見出し(押せない小さな字) */
  heading?: boolean;
  /** メニューが開いている間、このキー 1 つで選べる(例: "r")。右に小さく出す */
  key?: string;
  /** 名前の左に出す小さな絵(SVG の中身。幅 64・高さ 14。線の種類の見本) */
  preview?: string;
}

/** 右クリックのボタンの絵(線だけの小さな SVG) */
export const MENU_ICONS: Record<string, string> = {
  open: '<path d="M7 17 17 7M9 7h8v8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  bundle: '<rect x="3" y="5" width="18" height="14" rx="3"/><rect x="7" y="9" width="4" height="2.5"/><rect x="13" y="9" width="4" height="2.5"/><rect x="10" y="13" width="4" height="2.5"/>',
  color: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1.2"/><circle cx="14" cy="9" r="1.2"/><circle cx="16" cy="13" r="1.2"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  reverse: '<path d="M4 8h15l-4-4M20 16H5l4 4"/>',
  quotegroup: '<rect x="2" y="6" width="5" height="3"/><rect x="2" y="14" width="5" height="3"/><path d="M9 12h4M11 10l2 2-2 2"/><rect x="15" y="4" width="7" height="16" rx="2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  frame: '<rect x="3" y="5" width="18" height="14" rx="3" stroke-dasharray="3 2"/>',
  tab: '<path d="M3 19V7h7l2 3h9v9z"/><path d="M14 14h4M16 12v4"/>',
  beside: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>',
};

let openMenu: HTMLElement | null = null;
let menuKeys = new Map<string, () => void>();
/** ↑↓ と Enter で選べるメニューのとき、選べる項目と今の位置(2026-11-26 上の階層の一覧) */
let menuNav: { items: HTMLButtonElement[]; at: number } | null = null;
export function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
  menuKeys = new Map();
  menuNav = null;
}
function navTo(i: number): void {
  if (!menuNav?.items.length) return;
  menuNav.at = (i + menuNav.items.length) % menuNav.items.length;
  menuNav.items.forEach((b, k) => b.classList.toggle("kbd-on", k === menuNav!.at));
  menuNav.items[menuNav.at].scrollIntoView({ block: "nearest" });
}

/** opts.nav: ↑↓ で選び Enter で決められる(はじめは一番上が選ばれている) */
export function showMenu(x: number, y: number, items: MenuItem[], opts: { nav?: boolean } = {}): void {
  closeMenu();
  menuKeys = new Map();
  const el = h("div", { class: "ctxmenu", role: "menu" });
  const build = (parent: HTMLElement, list: MenuItem[]) => {
    for (const it of list) {
      if (it.separator) {
        parent.append(h("div", { class: "sep" }));
        continue;
      }
      if (it.swatches) {
        const row = h("div", { class: "swatches" }, h("span", { class: "swlabel", text: it.label }));
        for (const s of it.swatches) {
          const b = h("button", { class: `sw c${s.color}${s.active ? " active" : ""}`, title: s.title, "aria-label": s.title });
          b.addEventListener("click", () => {
            closeMenu();
            s.action();
          });
          if (s.key) menuKeys.set(s.key, () => b.click());
          row.append(b);
        }
        parent.append(row);
        continue;
      }
      if (it.bar) {
        const row = h("div", { class: "menubar" });
        for (const x of it.bar) {
          const ico = svg("svg", { viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true" });
          ico.innerHTML = MENU_ICONS[x.icon] ?? "";
          const bb = h("button", { class: "mb-btn" + (x.danger ? " danger" : "") + (x.hint ? " has-hint" : ""), title: x.title ?? x.label, "aria-label": x.title ?? x.label }, ico, h("span", { text: x.label }), x.hint ? h("small", { class: "mb-hint", text: x.hint }) : null);
          bb.addEventListener("click", () => {
            if (!x.keepOpen) closeMenu();
            x.action();
          });
          if (x.key) {
            menuKeys.set(x.key.toLowerCase(), () => bb.click());
            bb.append(h("kbd", { class: "mb-key", text: x.key.toUpperCase() }));
          }
          row.append(bb);
        }
        parent.append(row);
        continue;
      }
      if (it.cards) {
        const col = h("div", { class: "menucards" });
        for (const c of it.cards) {
          const pic = svg("svg", { class: "mc-pic", viewBox: "0 0 48 32", width: 48, height: 32, "aria-hidden": "true" });
          pic.innerHTML = c.diagram;
          const b = h("button", { class: "mc", title: c.title + (c.hint ? ` (${c.hint})` : "") }, pic, h("span", { class: "mc-text" }, h("span", { class: "mc-title", text: c.title }), h("span", { class: "mc-desc", text: c.desc })), c.hint ? h("kbd", { class: "mc-hint", text: c.hint }) : null);
          b.addEventListener("click", () => {
            closeMenu();
            c.action();
          });
          col.append(b);
        }
        parent.append(col);
        continue;
      }
      if (it.heading) {
        parent.append(h("div", { class: "menuhead", text: it.label }));
        continue;
      }
      const pv = it.preview ? svg("svg", { class: "mi-preview", viewBox: "0 0 64 14", width: 64, height: 14, "aria-hidden": "true" }) : null;
      if (pv) pv.innerHTML = it.preview!;
      const b = h("button", { class: "item" + (it.checked ? " checked" : "") + (it.danger ? " danger" : "") + (pv ? " has-preview" : "") + (it.desc ? " has-desc" : ""), role: "menuitem", disabled: it.disabled }, pv, it.desc ? h("span", { class: "mi-label" }, h("span", { text: it.label }), h("small", { class: "mi-desc", text: it.desc })) : h("span", { class: "mi-label", text: it.label }), it.hint || it.key ? h("span", { class: "mi-hint", text: it.hint ?? it.key!.toUpperCase() }) : null);
      if (it.key && !it.disabled) menuKeys.set(it.key.toLowerCase(), () => b.click());
      if (it.sub) {
        b.classList.add("hassub");
        const sub = h("div", { class: "submenu" });
        build(sub, it.sub);
        const wrap = h("div", { class: "subwrap" }, b, sub);
        // 画面からはみ出すときは、左や上へ寄せて開く
        const fit = () => {
          sub.style.left = "";
          sub.style.right = "";
          sub.style.top = "";
          requestAnimationFrame(() => {
            const r = sub.getBoundingClientRect();
            if (!r.width) return;
            if (r.right > innerWidth - 4) {
              sub.style.left = "auto";
              sub.style.right = "100%";
            }
            if (r.bottom > innerHeight - 4) sub.style.top = `${Math.round(innerHeight - 4 - r.bottom)}px`;
          });
        };
        wrap.addEventListener("mouseenter", fit);
        // 押すと開いたままにする(斜めにマウスを動かしても閉じないように)
        b.addEventListener("click", () => {
          fit();
          for (const w of parent.querySelectorAll(":scope > .subwrap.open")) if (w !== wrap) w.classList.remove("open");
          wrap.classList.toggle("open");
        });
        parent.append(wrap);
        continue;
      }
      b.addEventListener("click", () => {
        closeMenu();
        it.action?.();
      });
      parent.append(b);
    }
  };
  build(el, items);
  document.body.append(el);
  // 窓より高いときだけ、メニューの中をスクロール(ふだんは横に出る小メニューを切らないよう、そのまま)
  if (el.getBoundingClientRect().height > innerHeight - 8) Object.assign(el.style, { maxHeight: innerHeight - 8 + "px", overflowY: "auto" });
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 4) + "px";
  el.style.top = Math.min(y, innerHeight - r.height - 4) + "px";
  openMenu = el;
  if (opts.nav) {
    menuNav = { items: [...el.querySelectorAll<HTMLButtonElement>(":scope > .item:not(:disabled)")], at: 0 };
    navTo(0);
  }
}

addEventListener(
  "mousedown",
  (e) => {
    if (openMenu && !openMenu.contains(e.target as Node)) closeMenu();
  },
  true,
);
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openMenu) {
    closeMenu();
    e.stopPropagation();
    return;
  }
  if (openMenu && menuNav && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Enter") menuNav.items[menuNav.at]?.click();
    else navTo(menuNav.at + (e.key === "ArrowDown" ? 1 : -1));
    return;
  }
  // メニューが開いている間は、決めたキー 1 つで選べる(右クリックして R で名前を変える、など)
  if (openMenu && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
    const run = menuKeys.get(e.key.toLowerCase());
    if (run) {
      e.preventDefault();
      e.stopPropagation();
      run();
    }
  }
}, true);
export const menuOpen = () => !!openMenu;

/** 小さな入力の窓(prompt の代わり。Electron は window.prompt を持たない) */
export function askText(title: string, initial = "", choices: string[] = []): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", class: "ask-input", value: initial });
    const ok = h("button", { class: "btn primary", text: "OK" });
    const cancel = h("button", { class: "btn", text: "やめる" });
    // 候補(押すとそれで決まる)
    const pick = choices.length ? h("div", { class: "ask-choices" }) : null;
    for (const c of choices) {
      const b = h("button", { class: "ask-choice", text: c });
      b.onclick = () => done(c);
      pick!.append(b);
    }
    const box = h("div", { class: "modal ask" }, h("div", { class: "modal-title", text: title }), input, pick, h("div", { class: "row-end" }, cancel, ok));
    const back = h("div", { class: "backdrop" }, box);
    const done = (v: string | null) => {
      back.remove();
      resolve(v);
    };
    ok.onclick = () => done(input.value);
    cancel.onclick = () => done(null);
    back.addEventListener("mousedown", (e) => e.target === back && done(null));
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.isComposing) done(input.value);
      if (e.key === "Escape") done(null);
    });
    document.body.append(back);
    input.focus();
    input.select();
  });
}
