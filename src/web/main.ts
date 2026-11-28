// 招待付きの URL は共有セッションに入り、招待がない URL はブラウザ内の個人ボードを開く。
import { authorOf } from "../core/session";
import { serializeNode } from "../core/frontmatter";
import { ROOT_ID, type TDNode } from "../core/types";
import { toJsonCanvas, toOutlineText } from "../core/share";
import { Vault, type FileEntry } from "../core/vault";
import { Canvas } from "../renderer/canvas";
import { SharedClient } from "../renderer/shared";
import { h, showMenu, toast } from "../renderer/ui";
import { languageOfBrowser, setLanguage, T } from "../renderer/strings";

// アプリの窓口(window.bresuto)の代わり: 外のリンクだけ開き、ほかは「使えない」
const unsupported = async () => {
  throw new Error(webText("ブラウザでは使えません", "Unavailable in the browser"));
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
const COLORS = ["#e5484d", "#f76b15", "#ffb224", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f"];
const webText = (ja: string, en: string) => document.documentElement.lang === "en" ? en : ja;
const localKey = "bresuto.browser-vault";

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
    const name = h("input", { class: "ask-input", placeholder: webText("名前", "Name"), value: old?.name ?? "" }) as HTMLInputElement;
    let color = old?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)];
    const chips = h("div", { class: "web-colors" });
    for (const [i, c] of COLORS.entries()) {
      const label = T.shareColorNames[i];
      const b = h("button", { class: "web-color" + (c === color ? " on" : ""), title: label, "aria-label": label });
      b.style.background = c;
      b.addEventListener("click", () => {
        color = c;
        chips.querySelectorAll(".web-color").forEach((x) => x.classList.toggle("on", x === b));
      });
      chips.append(b);
    }
    const lang = h("button", { class: "btn", text: webText("English", "日本語") });
    lang.addEventListener("click", () => {
      localStorage.setItem("bresuto.language", webText("en", "ja"));
      location.reload();
    });
    const go = h("button", { class: "btn primary", text: webText("入る", "Join") });
    const box = h("div", { class: "modal web-join" }, h("div", { class: "modal-title", text: webText("BRESUTO の共有ボードに入る", "Join a BRESUTO shared board") }), h("p", { class: "muted small", text: webText("ほかの人に見せる名前と色", "Choose the name and color others will see") }), name, chips, h("div", { class: "row-end" }, lang, go));
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
  setLanguage(languageOfBrowser());
  const code = location.hash.slice(1);
  const me = code ? await askMe() : null;
  const ws = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const c = me ? new SharedClient(ws, code, me, false, "web") : null;
  if (c) {
    const msg = h("p", { class: "web-msg", text: T.shareJoining });
    document.body.append(msg);
    try {
      await c.connect();
    } catch (e) {
      msg.textContent = T.shareFailed((e as Error).message);
      return;
    }
    msg.remove();
  }
  const people = h("span", { class: "shared-people" });
  const boardTitle = c ? c.title || T.shareUntitled : webText("自分のボード", "My board");
  const title = h("span", { class: "pane-title shared-title", text: c ? "👥 " + boardTitle : boardTitle });
  const takeBtn = h("button", { class: "tbtn", text: webText("持ち帰る", "Export"), title: T.exportTip });
  const open = !c ? h("button", { class: "tbtn", text: webText("開く .canvas", "Open .canvas") }) : null;
  const home = !c ? h("button", { class: "tbtn", text: T.home }) : null;
  const pen = h("button", { class: "tbtn", text: T.pen, "aria-pressed": "false" });
  const language = h("button", { class: "tbtn", text: webText("English", "日本語"), title: "言語 / Language" });
  language.hidden = !!c;
  language.addEventListener("click", () => {
    localStorage.setItem("bresuto.language", webText("en", "ja"));
    location.reload();
  });
  const head = h("header", { class: "web-head" }, title, people, h("span", { class: "pane-space" }), home, open, pen, takeBtn, language);
  const wrap = h("div", { class: "pane shared-pane web-pane" });
  document.body.append(head, wrap);
  const v = c?.vault ?? new Vault({ write: async () => {}, trash: async () => {} });
  if (!c) {
    try {
      const saved = localStorage.getItem(localKey);
      v.load(saved ? JSON.parse(saved) as FileEntry[] : []);
    } catch {
      v.load([]);
      toast(webText("保存したボードを開けませんでした。", "Could not open your locally saved board."));
    }
    let warned = false;
    v.onChange(() => {
      try {
        const files = [...v.nodes].map(([id, node]) => ({ name: id + ".md", content: serializeNode(node) }));
        localStorage.setItem(localKey, JSON.stringify(files));
      } catch {
        if (!warned) toast(webText("このブラウザには保存できません。ファイルに書き出して保存してください。", "Browser storage is unavailable. Export a file to save your work."));
        warned = true;
      }
    });
  }
  const goToGroup = (id: string) => {
    cv.show(id, null);
    title.textContent = id === ROOT_ID ? boardTitle : v.get(id)?.title || T.untitledGroup;
  };
  const cv: Canvas = new Canvas(
    {
      vault: v,
      openGroup: (id) => c ? toast(T.sharedNoGroup) : goToGroup(id),
      openBody: () => toast(T.sharedNoNote),
      goToNode: () => {},
      pickGroup: async () => null,
      cardHover: () => {},
      onViewChange: () => {},
      onSelectionChange: () => {},
      canEditText: (id) => {
        const by = authorOf(v.get(id));
        return !me || !by || by === me.pid;
      },
      nodeDecor: (n: TDNode, el: HTMLElement) => {
        if (typeof n.extra.byColor !== "string") return;
        const dot = h("span", { class: "by-dot", title: T.shareBy(String(n.extra.byName ?? "?")) });
        dot.style.setProperty("--pc", String(n.extra.byColor));
        el.append(dot);
      },
    },
    wrap,
  );
  home?.addEventListener("click", () => goToGroup(ROOT_ID));
  pen.addEventListener("click", () => {
    cv.setPen({ on: !cv.pen.on });
    pen.setAttribute("aria-pressed", String(cv.pen.on));
  });
  if (open) {
    const file = h("input", { type: "file", accept: ".canvas", hidden: true });
    head.append(file);
    open.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (f && cv.importJsonCanvas(await f.text(), cv.visibleCenter())) cv.fitAll();
      else if (f) toast(webText("キャンバスを開けませんでした。", "Could not open this canvas."));
      file.value = "";
    });
  }
  cv.el.classList.add("shared-canvas");
  cv.show(ROOT_ID, null);
  cv.fitAll(true);
  cv.el.focus();
  v.onChange(() => cv.requestRender());
  // キーはボードへ(アプリと同じ操作)
  addEventListener("keydown", (e) => {
    if (document.querySelector(".backdrop")) return;
    if ((e.target as Element)?.closest?.("input, textarea, .ProseMirror")) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === "z") (v.undo(), e.preventDefault());
    else if (e.ctrlKey && k === "y") (v.redo(), e.preventDefault());
    else if (e.key === "Escape" && cv.pen.on) { pen.click(); e.preventDefault(); }
    else if (cv.handleKey(e)) e.preventDefault();
  });
  addEventListener("paste", (e) => {
    if ((e.target as Element)?.closest?.("input, textarea, .ProseMirror")) return;
    e.preventDefault();
    cv.pasteCopies();
  });
  const take = (button: HTMLElement) => {
    cv.commitDraft("esc");
    const name = (cv.group === ROOT_ID ? boardTitle : v.get(cv.group)?.title || T.untitledGroup).replace(/[\\/:*?"<>|]/g, "_");
    const r = button.getBoundingClientRect();
    const rect = (id: string) => cv.rectOf(id);
    showMenu(r.left, r.bottom, [
      { label: T.exportCanvas, action: () => download(`${name}.canvas`, toJsonCanvas(v, cv.group, rect), "application/json") },
      { label: T.exportOutline, action: () => download(`${name}.md`, toOutlineText(v, cv.group, rect), "text/markdown") },
    ]);
  };
  takeBtn.addEventListener("click", () => take(takeBtn));
  if (!c || !me) return;
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
        const chip = h("span", { class: "shared-person", title: p.name + (p.pid === me.pid ? T.shareYou : "") }, h("span", { class: "sp-dot" }), p.name);
        chip.style.setProperty("--pc", p.color);
        return chip;
      }),
    );
  renderPeople();
  c.onPeople = () => (renderPeople(), presence());
  c.onCursor = presence;
  c.onEnd = (st) => {
    const done = h("button", { class: "btn primary", text: webText("ボードに戻る", "Back to board") });
    const box = h("div", { class: "modal" },
      h("div", { class: "modal-title", text: st ? webText("共有が終わりました", "Sharing has ended") : webText("つながりが切れました", "Connection lost") }),
      h("p", { class: "muted small", text: webText("「持ち帰る」からボードを .canvas または .md で保存できます。", "Use Export to save the board as a .canvas or .md file.") }),
      h("div", { class: "row-end" }, done));
    const back = h("div", { class: "backdrop" }, box);
    done.addEventListener("click", () => back.remove());
    cv.setPen({ on: false });
    pen.disabled = true;
    pen.setAttribute("aria-pressed", "false");
    cv.readOnly = true;
    document.body.append(back);
  };
}
void main();
