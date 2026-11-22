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
}

let openMenu: HTMLElement | null = null;
export function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

export function showMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
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
      const b = h("button", { class: "item" + (it.checked ? " checked" : ""), role: "menuitem", disabled: it.disabled }, it.label);
      if (it.sub) {
        b.classList.add("hassub");
        const sub = h("div", { class: "submenu" });
        build(sub, it.sub);
        const wrap = h("div", { class: "subwrap" }, b, sub);
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
