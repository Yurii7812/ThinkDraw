// 画面の試験: 本物の Electron を起動する。vault と設定は一時ディレクトリ(利用者のフォルダには触らない)
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// 利用者の画面に窓を出さない: Wayland を外し、xvfb の見えない画面(X11)だけで起動する。
// xvfb-run の外では動かさない(npm run test:e2e を使う)
const HEADLESS_ARGS = ["--ozone-platform=x11", "."];
function headlessEnv(): Record<string, string> {
  if (!process.env.BRESUTO_HEADLESS) throw new Error("画面の試験は npm run test:e2e で(xvfb の中で)動かしてください");
  const env = { ...process.env } as Record<string, string>;
  delete env.WAYLAND_DISPLAY;
  delete env.ELECTRON_OZONE_PLATFORM_HINT;
  env.XDG_SESSION_TYPE = "x11";
  return env;
}
let app: ElectronApplication;
let page: Page;
let vault = "";
let userData = "";
let exportDir = "";
const shots = process.env.BRESUTO_SHOTS;

function mdFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(vault)) if (n.endsWith(".md")) out[n] = readFileSync(path.join(vault, n), "utf8");
  return out;
}
const titles = () => Object.values(mdFiles()).map((s) => s.match(/^title: (.*)$/m)?.[1]);
async function settle() {
  await page.waitForTimeout(700); // 自動保存(300ms)を待つ
}
async function shot(name: string) {
  if (shots) await page.screenshot({ path: path.join(shots, name + ".png") });
}

test.beforeEach(async () => {
  const base = process.env.TMPDIR || tmpdir();
  vault = mkdtempSync(path.join(base, "td-vault-"));
  userData = mkdtempSync(path.join(base, "td-user-"));
  exportDir = mkdtempSync(path.join(base, "td-export-"));
  app = await electron.launch({ args: HEADLESS_ARGS, env: { ...headlessEnv(), BRESUTO_VAULT: vault, BRESUTO_USERDATA: userData, BRESUTO_TEST: "1", BRESUTO_EXPORT_DIR: exportDir } });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForSelector(".canvas");
});
test.afterEach(async () => {
  await app.close();
  rmSync(vault, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
  rmSync(exportDir, { recursive: true, force: true });
});

async function write(x: number, y: number, t: string) {
  await page.mouse.click(x, y);
  await page.keyboard.type(t);
  await page.keyboard.press("Escape");
  await expect(page.locator(".node:not(.editing)", { hasText: t })).toHaveCount(1);
}
const idOf = (t: string) => Object.entries(mdFiles()).find(([, s]) => s.includes(`title: ${t}\n`))![0].replace(".md", "");


// ---------- スマホ用アプリの画面(2026-11-28)。ブラウザでも動く形(保存先は localStorage)で、タスクを試す ----------
test("スマホの画面: タスクを書く(期限・繰り返し)・済みにすると繰り返しは次の期限・済みでない物は残る", async () => {
  const url = "file://" + path.resolve("android/app/src/main/assets/phone/index.html");
  const [ph] = await Promise.all([
    app.waitForEvent("window"),
    app.evaluate(({ BrowserWindow }, u) => {
      const w = new BrowserWindow({ width: 400, height: 800, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
      void w.loadURL(u);
    }, url),
  ]);
  await ph.waitForSelector(".tabs");
  await ph.locator('.tabs button[data-t="task"]').click();
  await expect(ph.locator("#ttl")).toHaveText("タスク");
  // 期限なし
  await ph.locator("#task-in").fill("牛乳を買う");
  await ph.locator("#task-send").click();
  // 期限あり・毎週
  await ph.locator("#task-due").fill("2026-12-01");
  await ph.locator("#task-rep").selectOption("weekly");
  await ph.locator("#task-in").fill("ゴミ出し");
  await ph.locator("#task-send").click();
  await expect(ph.locator(".task")).toHaveCount(2);
  await expect(ph.locator(".task", { hasText: "ゴミ出し" }).locator(".meta")).toContainText("2026-12-01");
  // 繰り返しを済みに → 次の期限
  await ph.locator(".task", { hasText: "ゴミ出し" }).locator("input[type=checkbox]").click();
  await expect(ph.locator(".task", { hasText: "ゴミ出し" }).locator(".meta")).toContainText("2026-12-08");
  // ふつうのを済みに → 「済み」へ
  await ph.locator(".task", { hasText: "牛乳" }).locator("input[type=checkbox]").click();
  await expect(ph.locator(".task")).toHaveCount(1);
  await ph.locator('[data-tf="done"]').click();
  await expect(ph.locator(".task.done", { hasText: "牛乳" })).toHaveCount(1);
  // 受信箱に書いたもの(PC が取り込む形)
  const files = await ph.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("yn:files") || "{}")));
  expect(files.filter((n: string) => n.startsWith("task-")).length).toBe(2);
  expect(files.filter((n: string) => n.startsWith("taskdone-")).length).toBe(2);
  await ph.screenshot({ path: path.join(shots || process.env.TMPDIR || tmpdir(), "60-phone-task.png") });
  // タブは メモ帳・日記・ノート・紙・タスク・写真(録音は無い)
  await expect(ph.locator(".tabs button")).toHaveText([/メモ帳/, /日記/, /ノート/, /紙/, /タスク/, /写真/]);
});
