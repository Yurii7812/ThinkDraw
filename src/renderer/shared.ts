// 共有ボードにつなぐ(画面の側。2026-11-28)。共有ボードは、手元の小さな vault(ファイルに書かない)の根
import { emptyBoard, SessionSync, type BoardState, type Op, type Person } from "../core/session";
import { Vault } from "../core/vault";

export interface Me {
  pid: string;
  name: string;
  color: string;
}

/** 招待(https://〜/#合言葉 や http://192.168.〜:port/#合言葉)から、つなぐ所と合言葉 */
export function parseInvite(s: string): { ws: string; code: string } | null {
  const m = /^\s*(https?|wss?):\/\/([^/#\s]+)[^#\s]*#([\w-]+)\s*$/.exec(s);
  if (!m) return null;
  const secure = m[1] === "https" || m[1] === "wss";
  return { ws: `${secure ? "wss" : "ws"}://${m[2]}/ws`, code: m[3] };
}

const DENIED = "合言葉が違います";
const memIO = { write: async () => {}, trash: async () => {} };

export class SharedClient {
  readonly vault = new Vault(memIO);
  people: Person[] = [];
  /** ほかの人のマウスの場所(共有ボードの中の座標) */
  readonly cursors = new Map<string, { x: number; y: number; at: number }>();
  onPeople: () => void = () => {};
  onCursor: () => void = () => {};
  /** 開いた人が終えた(最後の状態)。null = つながりが切れた */
  onEnd: (s: BoardState | null) => void = () => {};
  private sync: SessionSync | null = null;
  private ws: WebSocket | null = null;
  private ended = false;
  private lastCursor = 0;

  constructor(
    readonly url: string,
    readonly code: string,
    readonly me: Me,
    /** 開いた人(このPCで中継している) */
    readonly host: boolean,
    /** アプリかブラウザか */
    readonly via: "app" | "web" = "app",
  ) {
    this.vault.load([]);
  }

  get title(): string {
    return this.vault.root().title;
  }

  /** つなぐ。作ったばかりのトンネルは使えるまで 10〜30 秒かかるので、合言葉の違い以外は 1 分ほどつなぎ直す */
  async connect(): Promise<void> {
    const until = Date.now() + 60000;
    for (;;) {
      try {
        return await this.connectOnce();
      } catch (e) {
        if ((e as Error).message === DENIED || Date.now() > until) throw e;
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }
  private connectOnce(): Promise<void> {
    return new Promise((ok, ng) => {
      let welcomed = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => !welcomed && (ws.close(), ng(new Error("つながりませんでした"))), 15000);
      ws.onopen = () => ws.send(JSON.stringify({ t: "hello", code: this.code, person: { ...this.me, via: this.via } }));
      ws.onerror = () => !welcomed && (clearTimeout(timer), ng(new Error("つながりませんでした")));
      ws.onclose = () => {
        if (!welcomed) return;
        if (!this.ended) {
          this.ended = true;
          this.onEnd(null);
        }
      };
      ws.onmessage = (ev) => {
        let m: { t: string; [k: string]: unknown };
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.t === "denied") {
          clearTimeout(timer);
          ng(new Error(DENIED));
        } else if (m.t === "welcome") {
          welcomed = true;
          clearTimeout(timer);
          // 手元で新しく作った物に、書いた人(と名前・色。抜けた人の物も分かるように)を付ける
          this.sync = new SessionSync(this.vault, (ops) => this.send(ops), (n) => {
            if (typeof n.extra.by !== "string") Object.assign(n.extra, { by: this.me.pid, byName: this.me.name, byColor: this.me.color });
          });
          this.sync.load((m.state as BoardState) ?? emptyBoard(""));
          this.people = (m.people as Person[]) ?? [];
          ok();
        } else if (m.t === "ops") this.sync?.receive(m.ops as Op[]);
        else if (m.t === "people") {
          this.people = m.people as Person[];
          for (const pid of [...this.cursors.keys()]) if (!this.people.some((p) => p.pid === pid)) this.cursors.delete(pid);
          this.onPeople();
        } else if (m.t === "cursor") {
          this.cursors.set(String(m.pid), { x: Number(m.x), y: Number(m.y), at: Date.now() });
          this.onCursor();
        } else if (m.t === "end") {
          this.ended = true;
          this.onEnd((m.state as BoardState) ?? null);
          ws.close();
        }
      };
    });
  }

  private send(ops: Op[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "ops", ops }));
  }
  /** マウスの場所を知らせる(多すぎないように 1 秒に 20 回まで) */
  sendCursor(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastCursor < 50 || this.ws?.readyState !== WebSocket.OPEN) return;
    this.lastCursor = now;
    this.ws.send(JSON.stringify({ t: "cursor", x: Math.round(x), y: Math.round(y) }));
  }
  personOf(pid: string | null): Person | undefined {
    return pid ? this.people.find((p) => p.pid === pid) : undefined;
  }
  close(): void {
    this.ended = true;
    this.sync?.close();
    this.ws?.close();
  }
}
