// スマホ(BRESUTO のスマホ用アプリ)と USB(adb)でやりとりする(2026-11-28。YuriiNote の phone.js を BRESUTO 用に写したもの)。
// スマホは files/inbox/ に新しいファイルだけを書く。PC は読んで取り込み、取り込んだ名前を files/imported.json で返す。
// PC からスマホへ返すのは、取り込み済みの名前・時系列記録の種類の名前・PC で済んだタスクの id だけ(PC のノートなどは映さない)
import { spawn } from "node:child_process";
import { existsSync, promises as fs, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";

export const PKG = "net.yurii.bresuto";
const EXT = `/sdcard/Android/data/${PKG}/`;

interface Out {
  code: number;
  out: Buffer;
  err: string;
}
function run(cmd: string, args: string[], o: { input?: string | Buffer; timeout?: number } = {}): Promise<Out> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "", done = false;
    const t = setTimeout(() => !done && (p.kill(), resolve({ code: -1, out: Buffer.concat(out), err: err + "(時間切れ)" })), o.timeout ?? 120000);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => ((done = true), clearTimeout(t), resolve({ code: -2, out: Buffer.concat(out), err: String(e.message) })));
    p.on("close", (code) => ((done = true), clearTimeout(t), resolve({ code: code ?? -1, out: Buffer.concat(out), err })));
    p.stdin.end(o.input);
  });
}

/** adb の場所: 環境変数 ADB → PATH → よくある場所 */
export function findAdb(): string | null {
  const cands = [process.env.ADB, path.join(homedir(), "Android/Sdk/platform-tools/adb"), path.join(process.env.ANDROID_HOME ?? "", "platform-tools/adb"), path.join(process.env.LOCALAPPDATA ?? "", "Android/Sdk/platform-tools/adb.exe"), "/opt/android-sdk/platform-tools/adb"].filter(Boolean) as string[];
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) for (const n of ["adb", "adb.exe"]) if (d && existsSync(path.join(d, n))) return path.join(d, n);
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}
const parseDevices = (s: string) =>
  s
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((a) => a.length >= 2 && a[0])
    .map((a) => ({ serial: a[0], state: a[1] }));
const NO_ADB = "adb(Android の USB 接続の道具)が見つかりません。\nLinux: sudo apt install adb ／ Mac: brew install android-platform-tools ／ Windows: 「Android SDK Platform-Tools」を入れてください。";
const NO_PHONE = "スマホが見つかりません。\n1. USB ケーブルでつなぐ\n2. 設定 → 開発者向けオプション → USBデバッグ をオン\n3. 画面に出る許可を押す\nそのあと、もう一度やってください。";

/** つながっているスマホ(1 台)。だめなら { error } */
async function ready(needApp = true): Promise<{ adb: string; A: (a: string[]) => string[]; serial: string } | { error: string }> {
  const adb = findAdb();
  if (!adb) return { error: NO_ADB };
  const list = parseDevices((await run(adb, ["devices"], { timeout: 10000 })).out.toString());
  const devs = list.filter((x) => x.state === "device");
  if (!devs.length) return { error: list.some((x) => x.state === "unauthorized") ? "スマホの画面に「USBデバッグを許可しますか？」と出ています。「許可」を押して、もう一度やってください。" : NO_PHONE };
  if (devs.length > 1) return { error: "スマホが 2 台以上つながっています。1 台だけにしてください。" };
  const serial = devs[0].serial, A = (a: string[]) => ["-s", serial, ...a];
  if (needApp && !/package:/.test((await run(adb, A(["shell", "pm", "path", PKG]))).out.toString())) return { error: "スマホに BRESUTO のアプリが入っていません。「スマホにアプリを入れる…」で入れてください。" };
  return { adb, A, serial };
}

/** 今つながっているスマホ(adb が無ければ空)。自動の取り込みのきっかけに使う */
export async function listDevices(): Promise<{ serial: string; state: string }[]> {
  const adb = findAdb();
  if (!adb) return [];
  return parseDevices((await run(adb, ["devices"], { timeout: 8000 })).out.toString());
}

/** スマホ用アプリの APK: 配布版は resources、作業フォルダは downloads(android/build-apk.sh が置く)と gradle の出力の新しい方 */
export function apkPath(appDir: string): string | null {
  const res = (process as { resourcesPath?: string }).resourcesPath;
  const packaged = res && path.join(res, "BRESUTO-memo.apk");
  if (packaged && existsSync(packaged)) return packaged;
  const c = [path.join(appDir, "downloads/BRESUTO-memo.apk"), path.join(appDir, "android/app/build/outputs/apk/fast/app-fast.apk")]
    .filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return c[0] ?? null;
}

/** スマホにアプリを入れる(USB) */
export async function install(apk: string | null, say: (s: string) => void = () => {}): Promise<{ ok: boolean; message: string }> {
  if (!apk) return { ok: false, message: "スマホ用アプリのファイルが見つかりません(downloads/BRESUTO-memo.apk)。sh android/build-apk.sh で作れます。" };
  const r = await ready(false);
  if ("error" in r) return { ok: false, message: r.error };
  say("スマホに入れています…");
  const i = await run(r.adb, r.A(["install", "-r", "-d", apk]), { timeout: 180000 });
  if (i.code !== 0 || !/Success/.test(i.out.toString())) return { ok: false, message: "入れられませんでした:\n" + (i.out.toString() + i.err).trim().split("\n").slice(-4).join("\n") };
  say("アプリを最適化しています…(数十秒)");
  await run(r.adb, r.A(["shell", "cmd", "package", "compile", "-m", "speed", "-f", PKG]), { timeout: 240000 });
  await run(r.adb, r.A(["shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1"]));
  return { ok: true, message: "スマホにアプリを入れました(BRESUTO)。" };
}

const okName = (f: string) => /^[A-Za-z0-9][\w.-]*$/.test(f) && !/\.(tmp|part)$/.test(f);
/** 受信箱のファイルを全部読む(1 つでも読めなければ中止) */
export async function pullInbox(): Promise<{ ok: true; files: { name: string; data: Buffer }[] } | { ok: false; message: string }> {
  const r = await ready();
  if ("error" in r) return { ok: false, message: r.error };
  const ls = await run(r.adb, r.A(["shell", `ls -1 ${EXT}files/inbox 2>/dev/null`]));
  const files: { name: string; data: Buffer }[] = [];
  for (const name of ls.out.toString().split("\n").map((l) => l.trim()).filter(okName)) {
    const g = await run(r.adb, r.A(["exec-out", "cat", `${EXT}files/inbox/${name}`]));
    if (g.code !== 0) return { ok: false, message: "スマホのファイルを読めませんでした(取り込みを中止します): " + name };
    files.push({ name, data: g.out });
  }
  return { ok: true, files };
}

/** スマホへ、小さな JSON を返す(取り込み済みの名前・種類・済んだタスク)。一時ファイルに書いてから置き換える */
async function put(name: "imported.json" | "kinds.json" | "tasks_done.json", text: string): Promise<boolean> {
  const r = await ready();
  if ("error" in r) return false;
  const d = `${EXT}files/${name}`;
  const w = await run(r.adb, r.A(["shell", `sh -c 'cat > ${d}.tmp && mv ${d}.tmp ${d}'`]), { input: text });
  if (w.code === 0) return true;
  // 大きいときは push で
  const tmp = path.join(tmpdir(), `bresuto-${process.pid}-${name}`);
  try {
    await fs.writeFile(tmp, text);
    return (await run(r.adb, r.A(["push", tmp, d]))).code === 0;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
export const markInbox = (names: string[]) => put("imported.json", JSON.stringify({ version: 3, names }));
export const sendKinds = (kinds: string[]) => put("kinds.json", JSON.stringify({ version: 4, kinds }));
export const sendTasksDone = (ids: string[]) => put("tasks_done.json", JSON.stringify({ version: 1, ids }));
