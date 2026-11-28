// スマホ(BRESUTO のスマホ用アプリ)と USB でつないだとき(2026-11-28)。取り込み先は core/phoneimport.ts
import { doneTaskIds, emptyPhoneState, importPhone, type PhoneHost, type PhoneState } from "../core/phoneimport";
import { ROOT_ID } from "../core/types";
import type { Vault } from "../core/vault";
import { api, toast } from "./ui";

const STATE = "phone.json";

export interface PhoneApp {
  vault: Vault;
  dayGroupFor(ymd: string): string;
  /** その日・その種類の記録ノート(無ければ作る) */
  recordNoteFor(day: string, ymd: string, kind: string): string;
  kindNames(): string[];
  addKinds(names: string[]): void;
  /** 紙PKM の取り込みに、画像の場所を渡す */
  importPapers(paths: string[]): void;
}

export class PhoneSync {
  private busy = false;
  private seenDevices = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private app: PhoneApp) {}

  /** つながったら自動で取り込む(5 秒ごとに見る。adb が無ければ何もしない) */
  startAuto(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), 5000);
  }
  private async poll(): Promise<void> {
    if (this.busy || document.visibilityState !== "visible") return;
    let devs: { serial: string; state: string }[] = [];
    try {
      devs = (await api().phoneDevices()).filter((d) => d.state === "device");
    } catch {
      return;
    }
    const now = new Set(devs.map((d) => d.serial));
    const fresh = [...now].some((s) => !this.seenDevices.has(s));
    this.seenDevices = now;
    if (fresh) await this.pull(true);
  }

  private async loadState(): Promise<PhoneState> {
    try {
      return { ...emptyPhoneState(), ...JSON.parse((await api().readApp(STATE)) ?? "{}") };
    } catch {
      return emptyPhoneState();
    }
  }

  /** スマホから取り込む。quiet = 自動のとき(アプリが入っていない・何も無いときは黙る) */
  async pull(quiet = false): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await api().phonePull();
      if (!r.ok) {
        if (!quiet) toast(r.message, 8000);
        return;
      }
      const st = await this.loadState();
      const v = this.app.vault;
      const res = await importPhone(r.files, st, this.host());
      await api().writeApp(STATE, JSON.stringify(st));
      // スマホへ返す: 取り込み済みの名前・種類の名前・PC で済んだタスク
      await api().phoneMark(res.names);
      await api().phoneKinds(this.app.kindNames());
      if (st.taskNote && v.exists(st.taskNote)) await api().phoneTasksDone(doneTaskIds(v.get(st.taskNote)!.body, st));
      if (res.papers.length) this.app.importPapers(await api().phoneSavePapers(res.papers.map((p) => ({ name: p.name, data: p.data }))));
      const c = res.counts;
      const parts = [c.memo && `メモ ${c.memo}`, c.diary && `日記・記録 ${c.diary}`, c.note && `ノート ${c.note}`, (c.task || c.taskdone) && `タスク ${(c.task ?? 0) + (c.taskdone ?? 0)}`, c.file && `写真 ${c.file}`, c.paper && `紙 ${c.paper}`].filter(Boolean);
      if (parts.length) toast("スマホから取り込みました: " + parts.join("・"), 6000);
      else if (!quiet) toast("スマホに新しいものはありません");
    } finally {
      this.busy = false;
    }
  }

  private host(): PhoneHost {
    const v = this.app.vault;
    const rootItems = () => v.itemsOf(ROOT_ID).filter((i) => !i.ref);
    const freeSpot = (x: number, y: number) => {
      const taken = rootItems().map((i) => ({ x: i.x, y: i.y }));
      for (let k = 0; k < 200 && taken.some((r) => Math.abs(r.x - x) < 220 && Math.abs(r.y - y) < 70); k++) y += 80;
      return { x, y };
    };
    return {
      recordNote: (ymd, kind) => this.app.recordNoteFor(this.app.dayGroupFor(ymd), ymd, kind),
      appendBody: (id, text) => {
        const b = (v.get(id)?.body ?? "").replace(/\n+$/, "");
        v.setBody(id, (b ? b + "\n\n" : "") + text + "\n");
      },
      placeNote: (title, body, near) => {
        // 親の右に、無ければホームの物の下に(重ならない所へ)
        const p = near ? v.itemPos(ROOT_ID, near) : null;
        const items = rootItems();
        const at = p ? freeSpot(p.x + 260, p.y) : freeSpot(items.length ? Math.min(...items.map((i) => i.x)) : 0, items.length ? Math.max(...items.map((i) => i.y)) + 120 : 0);
        const n = v.create({ type: "note", title, group: ROOT_ID, x: at.x, y: at.y });
        v.setBody(n.id, body.endsWith("\n") ? body : body + "\n");
        return n.id;
      },
      updateNote: (id, title, body) => {
        v.update(id, { title });
        v.setBody(id, body.endsWith("\n") ? body : body + "\n");
      },
      link: (a, b) => v.addLink(a, b),
      parentOf: (id) => rootItems().find((i) => v.get(i.id)?.links.some((l) => l.to === id))?.id ?? null,
      exists: (id) => v.exists(id),
      taskNote: (ex) => {
        if (ex && v.exists(ex)) return ex;
        const items = rootItems();
        const at = freeSpot(items.length ? Math.max(...items.map((i) => i.x)) + 300 : 0, 0);
        return v.create({ type: "note", kind: "check", title: "スマホのタスク", group: ROOT_ID, x: at.x, y: at.y }).id;
      },
      getBody: (id) => v.get(id)?.body ?? "",
      setBody: (id, body) => v.setBody(id, body),
      attachToDay: async (ymd, name, data) => {
        const day = this.app.dayGroupFor(ymd);
        const rel = await api().saveAttachment(name, data);
        const items = v.itemsOf(day);
        v.create({ type: "text", title: name, file: rel, group: day, x: 0, y: items.length ? Math.max(...items.map((i) => i.y)) + 120 : 0 });
      },
      addKinds: (names) => this.app.addKinds(names),
    };
  }
}
