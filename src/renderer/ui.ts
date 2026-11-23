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
  swatches?: { color: number; title: string; action: () => void; active?: boolean }[];
  sub?: MenuItem[];
  separator?: boolean;
  checked?: boolean;
  /** 右に出すショートカットの書き方(Ctrl+L など) */
  hint?: string;
  /** 赤い字(消すなど) */
  danger?: boolean;
  /** 一番上に横に並べる、絵と名前の大きなボタン(右クリックの「よく使う操作」) */
  bar?: { icon: string; label: string; title?: string; action: () => void; danger?: boolean; keepOpen?: boolean; key?: string }[];
  /** 見出し(押せない小さな字) */
  heading?: boolean;
  /** メニューが開いている間、このキー 1 つで選べる(例: "r")。右に小さく出す */
  key?: string;
}

/** 右クリックのボタンの絵(線だけの小さな SVG) */
export const MENU_ICONS: Record<string, string> = {
  open: '<path d="M7 17 17 7M9 7h8v8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  bundle: '<path d="M3 7h6l2 2h10v10H3z"/><path d="M12 12v5M9.5 14.5h5"/>',
  color: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1.2"/><circle cx="14" cy="9" r="1.2"/><circle cx="16" cy="13" r="1.2"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  beside: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>',
};

let openMenu: HTMLElement | null = null;
let menuKeys = new Map<string, () => void>();
export function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
  menuKeys = new Map();
}

export function showMenu(x: number, y: number, items: MenuItem[]): void {
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
          const bb = h("button", { class: "mb-btn" + (x.danger ? " danger" : ""), title: x.title ?? x.label, "aria-label": x.title ?? x.label }, ico, h("span", { text: x.label }));
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
      if (it.heading) {
        parent.append(h("div", { class: "menuhead", text: it.label }));
        continue;
      }
      const b = h("button", { class: "item" + (it.checked ? " checked" : "") + (it.danger ? " danger" : ""), role: "menuitem", disabled: it.disabled }, h("span", { class: "mi-label", text: it.label }), it.hint || it.key ? h("span", { class: "mi-hint", text: it.hint ?? it.key!.toUpperCase() }) : null);
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
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 4) + "px";
  el.style.top = Math.min(y, innerHeight - r.height - 4) + "px";
  openMenu = el;
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
export function askText(title: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", class: "ask-input", value: initial });
    const ok = h("button", { class: "btn primary", text: "OK" });
    const cancel = h("button", { class: "btn", text: "やめる" });
    const box = h("div", { class: "modal ask" }, h("div", { class: "modal-title", text: title }), input, h("div", { class: "row-end" }, cancel, ok));
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
