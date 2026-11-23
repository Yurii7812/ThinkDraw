// 紙PKM の一覧を画面で持つ(キャンバスの「紙」ノードの名前・絵にも使う)
import { byPid, emptyIndex, type PaperIndex } from "../core/paper";
import { api } from "./ui";

let ix: PaperIndex = emptyIndex();
const subs = new Set<() => void>();

export const paperStore = {
  get index(): PaperIndex {
    return ix;
  },
  async load(): Promise<void> {
    try {
      ix = await api().paperIndex();
    } catch {
      ix = emptyIndex();
    }
    for (const f of subs) f();
  },
  set(next: PaperIndex): void {
    ix = next;
    for (const f of subs) f();
  },
  on(fn: () => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  /** キャンバスに出す名前(今の ID。直せば変わる) */
  fzOf(pid: string): string | null | undefined {
    const p = byPid(ix, pid);
    return p ? p.fz : undefined;
  },
  thumbOf(pid: string): string | null {
    const p = byPid(ix, pid);
    return p ? "vault://local/" + p.thumb.split("/").map(encodeURIComponent).join("/") : null;
  },
};

export function vaultUrl(rel: string): string {
  return "vault://local/" + rel.split("/").map(encodeURIComponent).join("/");
}
