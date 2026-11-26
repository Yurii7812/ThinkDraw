// 検索の窓(Ctrl+F。2026-11-26 までは Ctrl+K)。リンク先・入れる先のグループを選ぶのにも、同じ部品を使う(SPEC 4.3・4.4)
import type { Vault } from "../core/vault";
import { ROOT_ID, type TDNode } from "../core/types";
import { T } from "./strings";
import { h } from "./ui";
import { searchTiered } from "../core/search";

export type PickResult = { id: string; newTab?: boolean } | { url: string } | null;

interface Opts {
  title: string;
  mode: "search" | "link" | "group" | "node";
  exclude?: (n: TDNode) => boolean;
  initial?: string;
}

function snippet(body: string, q: string): string {
  const flat = body.replace(/\s+/g, " ");
  const i = q ? flat.toLowerCase().indexOf(q.toLowerCase().split(/\s+/)[0] ?? "") : -1;
  const s = i > 20 ? "…" + flat.slice(i - 20, i + 60) : flat.slice(0, 80);
  return s;
}

export function openPicker(v: Vault, o: Opts): Promise<PickResult> {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", class: "picker-input", placeholder: T.searchHint, spellcheck: "false" });
    input.value = o.initial ?? "";
    const list = h("div", { class: "picker-list", role: "listbox" });
    const box = h("div", { class: "modal picker" }, h("div", { class: "modal-title", text: o.title }), input, list);
    const back = h("div", { class: "backdrop" }, box);
    let rows: { el: HTMLElement; res: PickResult }[] = [];
    let sel = 0;

    const done = (r: PickResult) => {
      back.remove();
      resolve(r);
    };
    const mark = () => rows.forEach((r, i) => r.el.classList.toggle("active", i === sel));
    const nameOf = (id: string) => {
      const n = v.get(id);
      return id === ROOT_ID ? T.home : n?.title || T.untitledGroup;
    };

    const refresh = () => {
      const q = input.value.trim();
      list.replaceChildren();
      rows = [];
      if (/^https?:\/\/\S+$/.test(q) && o.mode === "link") {
        const el = h("div", { class: "picker-row" }, h("span", { class: "ico ico-url" }), h("div", { class: "pr-main" }, h("div", { class: "pr-title", text: q })));
        rows.push({ el, res: { url: q } });
      }
      const heads: HTMLElement[] = [];
      const addRow = (id: string, inside?: string[]) => {
        const n = v.get(id);
        if (!n) return;
        if (o.exclude?.(n)) return;
        const parents = v.parentsOf(id).map(nameOf).join("、");
        const insideText = inside?.length
          ? inside.map((c) => v.get(c)?.title || T.untitled).map((t) => ([...t].length > 20 ? [...t].slice(0, 20).join("") + "…" : t)).join("・")
          : "";
        const el = h(
          "div",
          { class: "picker-row", role: "option" },
          h("span", { class: `ico ico-${n.type === "group" ? "folder" : n.type}` }),
          h(
            "div",
            { class: "pr-main" },
            h("div", { class: "pr-title", text: id === ROOT_ID ? T.home : n.title || (n.type === "group" ? T.untitledGroup : T.untitled) }),
            insideText ? h("div", { class: "pr-sub pr-inside", text: T.inside(insideText) }) : null,
            !inside && n.type !== "group" && n.body.trim() ? h("div", { class: "pr-sub", text: snippet(n.body, q) }) : null,
            parents ? h("div", { class: "pr-sub pr-parents", text: T.inGroups(parents) }) : null,
          ),
        );
        rows.push({ el, res: { id } });
      };
      /** 見出しを付けて、その後に行を足す(行が 1 つも無ければ見出しも出さない) */
      const section = (title: string, fill: () => void) => {
        const before = rows.length;
        fill();
        if (rows.length > before) {
          const hd = h("div", { class: "picker-sec", text: title });
          hd.dataset.at = String(before);
          heads.push(hd);
        }
      };
      if (q) {
        const r = searchTiered(v, q, 80);
        section(T.secGroups, () => r.groups.forEach((id) => addRow(id)));
        section(T.secContents, () => r.contents.forEach((c) => addRow(c.id, c.hits)));
        if (o.mode !== "group") section(T.secNodes, () => r.nodes.forEach((id) => addRow(id)));
      } else if (o.mode === "group")
        [...v.nodes.values()]
          .filter((n) => n.type === "group")
          .sort((a, b) => (a.id === ROOT_ID ? -1 : b.id === ROOT_ID ? 1 : a.title.localeCompare(b.title, "ja")))
          .forEach((n) => addRow(n.id));
      rows.forEach((r, i) => {
        const hd = heads.find((x) => x.dataset.at === String(i));
        if (hd) list.append(hd);
        r.el.addEventListener("mousemove", () => {
          if (sel !== i) {
            sel = i;
            mark();
          }
        });
        r.el.addEventListener("click", (e) => done(e.ctrlKey && r.res && "id" in r.res ? { ...r.res, newTab: true } : r.res));
        list.append(r.el);
      });
      if (!rows.length && q) list.append(h("div", { class: "picker-empty", text: T.noResults }));
      sel = 0;
      mark();
    };

    input.addEventListener("input", refresh);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === "ArrowDown") {
        sel = Math.min(rows.length - 1, sel + 1);
        mark();
        rows[sel]?.el.scrollIntoView({ block: "nearest" });
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        sel = Math.max(0, sel - 1);
        mark();
        rows[sel]?.el.scrollIntoView({ block: "nearest" });
        e.preventDefault();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const res = rows[sel]?.res;
        // Ctrl+Enter: 新しいタブで(検索の窓だけ)
        if (res) done(e.ctrlKey && o.mode === "search" && "id" in res ? { ...res, newTab: true } : res);
      } else if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    });
    back.addEventListener("mousedown", (e) => e.target === back && done(null));
    document.body.append(back);
    refresh();
    input.focus();
    input.select();
  });
}
