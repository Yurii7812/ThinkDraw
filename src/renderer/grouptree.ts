// グループのノードの「▸」: 下のグループの木を、その場に小さく出す。名前を押すとそこへ移る。
// ▸ で、その下を開いたり閉じたりできる(ポンポン下へたどれる)。2026-11-23 利用者の希望
import type { Vault } from "../core/vault";
import { T } from "./strings";
import { h } from "./ui";

let open: { el: HTMLElement; off: () => void } | null = null;

export function closeGroupTree(): void {
  open?.off();
  open?.el.remove();
  open = null;
}

/** その中に所属しているグループ(引用は除く)。名前の順(日付の名前も自然に並ぶ) */
export function subGroups(v: Vault, g: string): string[] {
  return v
    .itemsOf(g)
    .filter((i) => !i.ref && v.get(i.id)?.type === "group")
    .map((i) => i.id)
    .sort((a, b) => (v.get(a)!.title || "").localeCompare(v.get(b)!.title || "", "ja", { numeric: true }));
}

export function showGroupTree(v: Vault, root: string, anchor: Element, go: (id: string) => void): void {
  closeGroupTree();
  const expanded = new Set<string>([root]);
  const list = h("div", { class: "gt-list" });
  const name = (id: string) => v.get(id)?.title || T.untitledGroup;
  const draw = () => {
    const rows: HTMLElement[] = [];
    const walk = (g: string, depth: number, path: Set<string>) => {
      for (const c of subGroups(v, g)) {
        if (path.has(c)) continue; // 輪になっているときは止める
        const kids = subGroups(v, c).length;
        const isOpen = expanded.has(c);
        const tog = h("button", { class: "gt-tog" + (kids ? "" : " none"), text: kids ? (isOpen ? "▾" : "▸") : "", "aria-label": T.treeToggle });
        if (kids)
          tog.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isOpen) expanded.delete(c);
            else expanded.add(c);
            draw();
          });
        const n = h("button", { class: "gt-name", "data-id": c }, h("span", { class: "ico ico-folder" }), h("span", { class: "gt-label", text: name(c) }), h("span", { class: "gt-n", text: String(v.itemsOf(c).length) }));
        n.addEventListener("click", () => {
          closeGroupTree();
          go(c);
        });
        rows.push(h("div", { class: "gt-row", style: `padding-left:${4 + depth * 16}px` }, tog, n));
        if (isOpen) walk(c, depth + 1, new Set([...path, c]));
      }
    };
    walk(root, 0, new Set([root]));
    list.replaceChildren(...(rows.length ? rows : [h("div", { class: "gt-empty", text: T.treeEmpty })]));
  };
  draw();
  const head = h("button", { class: "gt-head", "data-id": root }, h("span", { class: "ico ico-folder" }), h("span", { class: "gt-label", text: name(root) }), h("span", { class: "gt-go", text: T.treeEnter }));
  head.addEventListener("click", () => {
    closeGroupTree();
    go(root);
  });
  const el = h("div", { class: "gtree" }, head, list);
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(r.right + 4, innerWidth - b.width - 4)) + "px";
  el.style.top = Math.max(4, Math.min(r.top - 6, innerHeight - b.height - 4)) + "px";
  const onDown = (e: PointerEvent) => {
    if (!el.contains(e.target as Node)) closeGroupTree();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeGroupTree();
    }
  };
  setTimeout(() => addEventListener("pointerdown", onDown, true));
  addEventListener("keydown", onKey, true);
  open = {
    el,
    off: () => {
      removeEventListener("pointerdown", onDown, true);
      removeEventListener("keydown", onKey, true);
    },
  };
}
