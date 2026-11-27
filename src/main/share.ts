// 共有ボードの中継(開いた人の PC で動く。2026-11-28 利用者。質問票 br-1128a)。
// - ボードごとに招待(合言葉)。招待は「https://〜.trycloudflare.com/#合言葉」の 1 行で送れる
// - 外からは Cloudflare のトンネル(cloudflared。アカウント不要の一時的な URL)。家の中なら同じ Wi-Fi の URL でも入れる
// - 最新の状態をここで持ち、あとから入った人にも渡す。終えると、みんなに「終わり」を送る(それぞれ自分のホームに保存する)
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import * as path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { applyOps, emptyBoard, type BoardState, type Op, type Person } from "../core/session";

interface Client {
  ws: WebSocket;
  person: Person | null;
}

export interface ShareInfo {
  /** 送る招待(外から入れる URL + #合言葉)。トンネルが使えなければ null */
  invite: string | null;
  /** 同じ Wi-Fi の中から入る招待 */
  lanInvite: string | null;
  /** 開いた人のアプリがつなぐ所 */
  local: string;
  code: string;
  tunnelError?: string;
}

const WORDS = ["sora", "umi", "yama", "hana", "kaze", "hoshi", "mori", "kawa", "tsuki", "yuki", "ame", "kumo", "niji", "hi", "ki", "ishi"];
function newCode(): string {
  const b = randomBytes(4);
  return `${WORDS[b[0] % WORDS.length]}-${WORDS[b[1] % WORDS.length]}-${String(b.readUInt16BE(2) % 10000).padStart(4, "0")}`;
}

export class ShareServer {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private tunnel: ChildProcess | null = null;
  private clients = new Set<Client>();
  private state: BoardState = emptyBoard("");
  private code = "";
  info: ShareInfo | null = null;

  constructor(
    private binDir: string,
    /** ブラウザから入るページ(dist/web) */
    private webDir: string,
  ) {}

  get running(): boolean {
    return !!this.http;
  }

  async start(title: string, initial?: BoardState): Promise<ShareInfo> {
    if (this.info) return this.info;
    this.state = initial ?? emptyBoard(title);
    this.code = newCode();
    // 招待の URL をブラウザで開くと、共有ボードのページ(アプリを入れなくても入れる。2026-11-28 利用者)
    const FILES: Record<string, [string, string]> = { "/": ["index.html", "text/html; charset=utf-8"], "/web.js": ["web.js", "text/javascript; charset=utf-8"], "/style.css": ["style.css", "text/css; charset=utf-8"] };
    const http = createServer(async (req, res) => {
      const f = FILES[(req.url ?? "/").split("?")[0]];
      if (!f) {
        res.writeHead(404);
        return void res.end();
      }
      try {
        const body = await fs.readFile(path.join(this.webDir, f[0]));
        res.writeHead(200, { "content-type": f[1], "cache-control": "no-cache" });
        res.end(body);
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 8 * 1024 * 1024 });
    wss.on("connection", (ws) => this.onConnection(ws));
    await new Promise<void>((ok) => http.listen(0, "0.0.0.0", () => ok()));
    this.http = http;
    this.wss = wss;
    const port = (http.address() as { port: number }).port;
    const lan = lanAddress();
    const info: ShareInfo = { invite: null, lanInvite: lan ? `http://${lan}:${port}/#${this.code}` : null, local: `ws://127.0.0.1:${port}/ws`, code: this.code };
    try {
      if (process.env.BRESUTO_TEST) throw new Error("試験ではトンネルを開かない");
      info.invite = `${await this.openTunnel(port)}/#${this.code}`;
    } catch (e) {
      info.tunnelError = (e as Error).message;
    }
    this.info = info;
    return info;
  }

  /** cloudflared の一時的なトンネル(アカウント不要)。URL が出るまで待つ */
  private openTunnel(port: number): Promise<string> {
    const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
    const local = path.join(this.binDir, exe);
    const cmd = existsSync(local) ? local : exe;
    return new Promise((ok, ng) => {
      let done = false;
      const p = spawn(cmd, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
      this.tunnel = p;
      const timer = setTimeout(() => finish(new Error("トンネルの URL が出ませんでした(インターネットにつながっているか確かめてください)")), 30000);
      const finish = (e: Error | null, url?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (e) ng(e);
        else ok(url!);
      };
      const look = (b: Buffer) => {
        const m = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/.exec(b.toString());
        if (m) finish(null, m[0]);
      };
      p.stdout?.on("data", look);
      p.stderr?.on("data", look);
      p.on("error", () => finish(new Error("cloudflared がありません")));
      p.on("exit", () => finish(new Error("cloudflared が止まりました")));
    });
  }

  private onConnection(ws: WebSocket): void {
    const c: Client = { ws, person: null };
    this.clients.add(c);
    ws.on("message", (raw) => {
      let m: { t: string; [k: string]: unknown };
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!c.person) {
        // はじめは合言葉と、名前・色
        if (m.t !== "hello" || m.code !== this.code || !m.person) {
          ws.send(JSON.stringify({ t: "denied" }));
          ws.close();
          return;
        }
        const p = m.person as Person;
        c.person = { pid: String(p.pid).slice(0, 40), name: String(p.name).slice(0, 40) || "?", color: /^#[0-9a-f]{6}$/i.test(String(p.color)) ? String(p.color) : "#888888", via: p.via === "web" ? "web" : "app" };
        ws.send(JSON.stringify({ t: "welcome", state: this.state, people: this.people() }));
        this.broadcast({ t: "people", people: this.people() });
        return;
      }
      if (m.t === "ops" && Array.isArray(m.ops)) {
        const ops = m.ops as Op[];
        applyOps(this.state, ops);
        this.broadcast({ t: "ops", ops, from: c.person.pid }, c);
      } else if (m.t === "cursor") {
        this.broadcast({ t: "cursor", pid: c.person.pid, x: m.x, y: m.y }, c);
      }
    });
    ws.on("close", () => {
      this.clients.delete(c);
      if (c.person) this.broadcast({ t: "people", people: this.people() });
    });
  }

  private people(): Person[] {
    return [...this.clients].map((c) => c.person).filter((p): p is Person => !!p);
  }
  private broadcast(m: unknown, except?: Client): void {
    const s = JSON.stringify(m);
    for (const c of this.clients) if (c !== except && c.person && c.ws.readyState === 1) c.ws.send(s);
  }

  /** 共有を終える: みんなに「終わり」を送り(それぞれ自分のホームに保存する)、閉じる */
  async stop(): Promise<void> {
    this.broadcast({ t: "end", state: this.state });
    await new Promise((r) => setTimeout(r, 400));
    for (const c of this.clients) c.ws.close();
    this.clients.clear();
    this.wss?.close();
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
    this.tunnel?.kill();
    this.http = null;
    this.wss = null;
    this.tunnel = null;
    this.info = null;
  }
}

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return null;
}
