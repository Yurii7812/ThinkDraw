// 共有ボードにブラウザから入る(2026-11-28 利用者「アプリを入れなくても入れる感じ」)。
// 開いた人の PC の中継が、このページも出す。招待の URL(https://〜/#合言葉)を開くだけ。
// アプリと同じボードの部品を使う。アプリにしかない物(添付・紙PKM・画面の写し)は使えない
import { boardOf, authorOf, type BoardState } from "../core/session";
import { ROOT_ID, type TDNode } from "../core/types";
import { toJsonCanvas, toOutlineText } from "../core/share";
import { Vault } from "../core/vault";
import { Canvas } from "../renderer/canvas";
import { SharedClient } from "../renderer/shared";
import { h, toast } from "../renderer/ui";

// アプリの窓口(window.bresuto)の代わり: 外のリンクだけ開き、ほかは「使えない」
const unsupported = async () => {
  throw new Error("ブラウザでは使えません");
};
(window as unknown as { bresuto: unknown }).bresuto = new Proxy(
  { openExternal: async (u: string) => void window.open(u, "_blank", "noopener"), urlTitle: async () => null, paperIndex: async () => ({ pages: [] }) },
  { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : unsupported) },
);


interface Me {
  pid: string;
  name: string;
  color: string;
}
const COLORS: [string, string][] = [["赤", "#e5484d"], ["橙", "#f76b15"], ["黄", "#ffb224"], ["緑", "#30a46c"], ["青緑", "#12a594"], ["青", "#0090ff"], ["紫", "#6e56cf"], ["桃", "#d6409f"]];

function loadMe(): Me | null {
  try {
    const m = JSON.parse(localStorage.getItem("bresuto.me") ?? "null");
    return m?.pid && m.name ? m : null;
  } catch {
    return null;
  }
}
/** 名前と色を聞く(この端末に覚える) */
function askMe(): Promise<Me> {
  return new Promise((ok) => {
    const old = loadMe();
    const name = h("input", { class: "ask-input", placeholder: "名前", value: old?.name ?? "" }) as HTMLInputElement;
    let color = old?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)][1];
    const chips = h("div", { class: "web-colors" });
    for (const [label, c] of COLORS) {
      const b = h("button", { class: "web-color" + (c === color ? " on" : ""), title: label, "aria-label": label });
      b.style.background = c;
      b.addEventListener("click", () => {
        color = c;
        chips.querySelectorAll(".web-color").forEach((x) => x.classList.toggle("on", x === b));
      });
      chips.append(b);
    }
    const go = h("button", { class: "btn primary", text: "入る" });
    const box = h("div", { class: "modal web-join" }, h("div", { class: "modal-title", text: "BRESUTO の共有ボードに入る" }), h("p", { class: "muted small", text: "ほかの人に見せる名前と色" }), name, chips, h("div", { class: "row-end" }, go));
    const back = h("div", { class: "backdrop" }, box);
    const done = () => {
      if (!name.value.trim()) return name.focus();
      const me: Me = { pid: old?.pid ?? Math.random().toString(36).slice(2, 12), name: name.value.trim().slice(0, 30), color };
      try {
        localStorage.setItem("bresuto.me", JSON.stringify(me));
      } catch {
        /* 覚えられなくても入れる */
      }
      back.remove();
      ok(me);
    };
    go.addEventListener("click", done);
    name.addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && done());
    document.body.append(back);
    name.focus();
  });
}

/** ファイルとして持ち帰る(ブラウザではホームに保存できないので) */
function download(name: string, text: string, type: string): void {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

async function main(): Promise<void> {
  const code = decodeURIComponent(location.hash.slice(1));
  if (!code) {
    document.body.append(h("p", { class: "web-msg", text: "招待の URL(# から後ろも)を、そのまま開いてください。" }));
    return;
  }
  const me = await askMe();
  const ws = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const c = new SharedClient(ws, code, me, false, "web");
  const msg = h("p", { class: "web-msg", text: "つないでいます…" });
  document.body.append(msg);
  try {
    await c.connect();
  } catch (e) {
    msg.textContent = "入れませんでした: " + (e as Error).message;
    return;
  }
  msg.remove();
  const people = h("span", { class: "shared-people" });
  const title = h("span", { class: "pane-title shared-title", text: "👥 " + (c.title || "共有ボード") });
  const takeBtn = h("button", { class: "tbtn", text: "持ち帰る", title: "今のボードをファイルにする(Obsidian のキャンバス .canvas と、BRESUTO に貼れる箇条書き .md)" });
  const head = h("header", { class: "web-head" }, title, people, h("span", { class: "pane-space" }), takeBtn);
  const wrap = h("div", { class: "pane shared-pane web-pane" });
  document.body.append(head, wrap);
  const v: Vault = c.vault;
  const cv = new Canvas(
    {
      vault: v,
      openGroup: () => toast("共有ボードの中のグループは、まだ開けません"),
      openBody: () => toast("共有ボードのノートの中身は、まだ開けません"),
      goToNode: () => {},
      pickGroup: async () => null,
      cardHover: () => {},
      onViewChange: () => {},
      onSelectionChange: () => {},
      canEditText: (id) => {
        const by = authorOf(v.get(id));
        return !by || by === me.pid;
      },
      nodeDecor: (n: TDNode, el: HTMLElement) => {
        if (typeof n.extra.byColor !== "string") return;
        const dot = h("span", { class: "by-dot", title: `${n.extra.byName ?? "?"} が書いた` });
        dot.style.setProperty("--pc", String(n.extra.byColor));
        el.append(dot);
      },
    },
    wrap,
  );
  cv.el.classList.add("shared-canvas");
  cv.show(ROOT_ID, null);
  cv.fitAll(true);
  cv.el.focus();
  v.onChange(() => cv.requestRender());
  // キーはボードへ(アプリと同じ操作)
  addEventListener("keydown", (e) => {
    if (document.querySelector(".backdrop")) return;
    if ((e.target as Element)?.closest?.("input, textarea, .ProseMirror")) return;
    if (cv.handleKey(e)) e.preventDefault();
  });
  addEventListener("paste", (e) => {
    if ((e.target as Element)?.closest?.("input, textarea, .ProseMirror")) return;
    e.preventDefault();
    cv.pasteCopies();
  });
  cv.el.addEventListener("pointermove", (e) => {
    const p = cv.toWorld(e.clientX, e.clientY);
    c.sendCursor(p.x, p.y);
  });
  const presence = () => {
    const now = Date.now();
    cv.setPresence(
      [...c.cursors]
        .filter(([pid, p]) => pid !== me.pid && now - p.at < 20000)
        .map(([pid, p]) => ({ x: p.x, y: p.y, name: c.personOf(pid)?.name ?? "?", color: c.personOf(pid)?.color ?? "#888" })),
    );
  };
  const renderPeople = () =>
    people.replaceChildren(
      ...c.people.map((p) => {
        const chip = h("span", { class: "shared-person", title: p.name + (p.pid === me.pid ? "(自分)" : "") }, h("span", { class: "sp-dot" }), p.name);
        chip.style.setProperty("--pc", p.color);
        return chip;
      }),
    );
  renderPeople();
  c.onPeople = () => (renderPeople(), presence());
  c.onCursor = presence;
  const take = (st?: BoardState) => {
    const name = (st?.title || c.title || "共有ボード").replace(/[\\/:*?"<>|]/g, "_");
    const rect = (id: string) => cv.rectOf(id);
    download(`${name}.canvas`, toJsonCanvas(v, ROOT_ID, rect), "application/json");
    setTimeout(() => download(`${name}.md`, toOutlineText(v, ROOT_ID, rect), "text/markdown"), 300);
  };
  takeBtn.addEventListener("click", () => take());
  c.onEnd = (st) => {
    const done = h("button", { class: "btn primary", text: "ファイルで持ち帰る" });
    done.addEventListener("click", () => take(st ?? boardOf(v)));
    const box = h("div", { class: "modal" }, h("div", { class: "modal-title", text: st ? "共有が終わりました" : "つながりが切れました" }), h("p", { class: "muted small", text: "今のボードを、ファイル(.canvas と、BRESUTO に Ctrl+Q で貼れる箇条書き .md)で持ち帰れます。" }), h("div", { class: "row-end" }, done));
    document.body.append(h("div", { class: "backdrop" }, box));
  };
}
void main();
