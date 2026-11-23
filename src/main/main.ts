// Electron の main プロセス: 窓・フォルダの読み書き・ファイル監視・URL の題の取得
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from "electron";
import { existsSync, watch, type FSWatcher, promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { atomicWrite, FsVaultIO } from "./fsio";

// 試験のときは、利用者の設定・フォルダに触らないよう、環境変数で場所を差し替える
if (process.env.THINKDRAW_USERDATA) app.setPath("userData", process.env.THINKDRAW_USERDATA);
// 画面の試験(xvfb)では、窓が隠れていると見なされて描画が止まることがあるので、止めないようにする
if (process.env.THINKDRAW_TEST) {
  app.commandLine.appendSwitch("ozone-platform", "x11"); // 試験の窓は xvfb の中だけに出す
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
}

protocol.registerSchemesAsPrivileged([{ scheme: "vault", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

interface Config {
  lastFolder?: string;
  theme?: "system" | "light" | "dark";
  reversed?: boolean;
}
const configFile = () => path.join(app.getPath("userData"), "config.json");
async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(await fs.readFile(configFile(), "utf8"));
  } catch {
    return {};
  }
}
async function writeConfig(c: Config): Promise<void> {
  await atomicWrite(configFile(), JSON.stringify(c, null, 2));
}

let win: BrowserWindow | null = null;
let io: FsVaultIO | null = null;
let watcher: FSWatcher | null = null;
const watchTimers = new Map<string, NodeJS.Timeout>();

function needIO(): FsVaultIO {
  if (!io) throw new Error("フォルダが開かれていません");
  return io;
}

async function openVault(dir: string): Promise<string> {
  watcher?.close();
  watcher = null;
  io = new FsVaultIO(dir);
  await fs.mkdir(dir, { recursive: true });
  const c = await readConfig();
  if (!process.env.THINKDRAW_VAULT) await writeConfig({ ...c, lastFolder: dir });
  return dir;
}

function startWatch(): void {
  if (!io || watcher) return;
  const dir = io.dir;
  watcher = watch(dir, (_ev, filename) => {
    if (!filename || !filename.endsWith(".md") || filename.startsWith(".")) return;
    clearTimeout(watchTimers.get(filename));
    watchTimers.set(
      filename,
      setTimeout(async () => {
        watchTimers.delete(filename);
        const content = existsSync(path.join(dir, filename)) ? await io!.readOne(filename) : null;
        win?.webContents.send("vault:changed", { name: filename, content });
      }, 150),
    );
  });
}

// ---------- URL の題(通信が必要。結果は .thinkdraw/ にキャッシュ) ----------
const URL_CACHE = "url-cache.json";
let urlCache: Record<string, { title: string; at: string }> | null = null;
async function urlTitle(url: string): Promise<string | null> {
  if (!/^https?:\/\//.test(url) || !io) return null;
  if (!urlCache) {
    try {
      urlCache = JSON.parse((await io.readAppFile(URL_CACHE)) ?? "{}");
    } catch {
      urlCache = {};
    }
  }
  const hit = urlCache![url];
  if (hit) return hit.title;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await net.fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 ThinkDraw" } });
    clearTimeout(t);
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 300_000);
    const m =
      html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (!m) return null;
    const title = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
    if (!title) return null;
    urlCache![url] = { title, at: new Date().toISOString() };
    await io.writeAppFile(URL_CACHE, JSON.stringify(urlCache, null, 1));
    return title;
  } catch {
    return null;
  }
}
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// ---------- IPC ----------
function registerIpc(): void {
  ipcMain.handle("config:get", () => readConfig());
  ipcMain.handle("config:set", async (_e, patch: Config) => writeConfig({ ...(await readConfig()), ...patch }));

  ipcMain.handle("vault:initial", async () => {
    const forced = process.env.THINKDRAW_VAULT;
    if (forced) return openVault(forced);
    const c = await readConfig();
    if (c.lastFolder && existsSync(c.lastFolder)) return openVault(c.lastFolder);
    return null;
  });
  ipcMain.handle("vault:choose", async () => {
    const r = await dialog.showOpenDialog(win!, { title: "フォルダを開く", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    return openVault(r.filePaths[0]);
  });
  ipcMain.handle("vault:readAll", () => needIO().readAll());
  ipcMain.handle("vault:watch", () => startWatch());
  ipcMain.handle("vault:write", (_e, name: string, content: string) => needIO().write(name, content));
  ipcMain.handle("vault:trash", (_e, name: string, content: string) => needIO().trash(name, content));
  ipcMain.handle("vault:readApp", (_e, name: string) => needIO().readAppFile(name));
  ipcMain.handle("vault:writeApp", (_e, name: string, content: string) => needIO().writeAppFile(name, content));
  ipcMain.handle("vault:saveAsset", (_e, ext: string, data: Uint8Array) => needIO().saveAsset(ext, data));
  ipcMain.handle("export:save", async (_e, name: string, label: string, exts: string[], data: string | Uint8Array) => {
    const forced = process.env.THINKDRAW_EXPORT_DIR; // 試験: 窓を出さず、この場所へ書く
    let file: string;
    if (forced) file = path.join(forced, path.basename(name));
    else {
      const r = await dialog.showSaveDialog(win!, { title: "書き出す", defaultPath: path.join(app.getPath("documents"), name), filters: [{ name: label, extensions: exts }] });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    await fs.writeFile(file, typeof data === "string" ? data : Buffer.from(data));
    return file;
  });
  ipcMain.handle("vault:saveAttachment", (_e, name: string, data: Uint8Array) => needIO().saveAttachment(name, data));
  ipcMain.handle("asset:open", async (_e, rel: string) => {
    const file = needIO().assetPath(rel);
    if (file && existsSync(file)) return shell.openPath(file);
    return "見つかりません";
  });
  ipcMain.handle("url:title", (_e, url: string) => urlTitle(url));
  ipcMain.handle("shell:open", (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "ThinkDraw",
    backgroundColor: "#1e1e1e",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "../renderer/index.html"));
  // 窓の中でのページ移動はさせない(リンクは外部のブラウザで)
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:")) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // 閉じる前に、画面に残っている未保存の変更を書かせる
  let closing = false;
  win.on("close", (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    const done = () => win?.destroy();
    const t = setTimeout(done, 3000);
    ipcMain.once("app:flushed", () => {
      clearTimeout(t);
      done();
    });
    win!.webContents.send("app:flush");
  });
  if (process.env.THINKDRAW_DEVTOOLS) win.webContents.openDevTools();
}

app.whenReady().then(() => {
  // vault://local/<相対パス> で、開いているフォルダの画像を出す
  protocol.handle("vault", (req) => {
    if (!io) return new Response("", { status: 404 });
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
    const file = path.resolve(io.dir, rel);
    if (!file.startsWith(path.resolve(io.dir) + path.sep)) return new Response("", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  registerIpc();
  createWindow();
});
app.on("window-all-closed", () => app.quit());
