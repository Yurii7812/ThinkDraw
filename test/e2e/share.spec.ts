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


// ---------- 共有ボード(2026-11-28): 2 つの BRESUTO をつなぐ ----------
async function launchSecond(): Promise<{ app: ElectronApplication; page: Page; vault: string; done: () => Promise<void> }> {
  const base = process.env.TMPDIR || tmpdir();
  const v = mkdtempSync(path.join(base, "td-vault2-"));
  const u = mkdtempSync(path.join(base, "td-user2-"));
  writeFileSync(path.join(u, "config.json"), JSON.stringify({ me: { pid: "guestpid01", name: "ゲスト", color: "#30a46c" } }));
  const a = await electron.launch({ args: HEADLESS_ARGS, env: { ...headlessEnv(), BRESUTO_VAULT: v, BRESUTO_USERDATA: u, BRESUTO_TEST: "1" } });
  const p = await a.firstWindow();
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.waitForSelector(".canvas");
  return { app: a, page: p, vault: v, done: async () => (await a.close(), rmSync(v, { recursive: true, force: true }), rmSync(u, { recursive: true, force: true })) };
}
const filesOf = (dir: string) => readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => readFileSync(path.join(dir, n), "utf8"));

test("共有ボード: 始める・入る・同時に書く・他人の文字は直せない・Ctrl+Q は自分だけ元へ・終えると全員のホームに入る", async () => {
  await page.evaluate(() => {
    const a = (window as any).__app;
    a.config.me = { pid: "hostpid001", name: "わたし", color: "#0090ff" };
  });
  // 自分のボードに 1 つ(あとで共有ボードへ Ctrl+Q)
  await write(200, 300, "自分の案");
  // 始める
  await page.locator(".tbtn.share-btn").click();
  await page.locator(".ctxmenu .item", { hasText: "新しい共有ボードを始める" }).click();
  await page.locator(".modal.ask .ask-input").fill("会議");
  await page.locator(".modal.ask .ask-input").press("Enter");
  await expect(page.locator(".modal.share-modal")).toBeVisible({ timeout: 15000 });
  await page.locator(".modal.share-modal .btn.primary").click();
  await expect(page.locator(".shared-pane")).toBeVisible();
  const info = await page.evaluate(() => (window as any).bresuto.shareInfo());
  const invite = info.local.replace("ws://", "http://").replace("/ws", "") + "/#" + info.code;
  // 入る
  const g = await launchSecond();
  try {
    await g.page.locator(".tbtn.share-btn").click();
    await g.page.locator(".ctxmenu .item", { hasText: "共有ボードに入る" }).click();
    await g.page.locator(".modal.ask .ask-input").fill(invite);
    await g.page.locator(".modal.ask .ask-input").press("Enter");
    await expect(g.page.locator(".shared-pane .shared-title")).toContainText("会議");
    await expect(page.locator(".shared-person")).toHaveCount(2);
    // わたしが共有ボードに書く → ゲストに見える(書いた人の点つき)
    const box = (await page.locator(".shared-canvas").boundingBox())!;
    await page.mouse.click(box.x + 150, box.y + 150);
    await page.keyboard.type("みんなの案");
    await page.keyboard.press("Escape");
    await expect(g.page.locator(".shared-canvas .node", { hasText: "みんなの案" })).toHaveCount(1);
    await expect(g.page.locator(".shared-canvas .node .by-dot")).toHaveCount(1);
    // ゲストは、わたしの文字を直せない(動かすのはできる)
    await g.page.locator(".shared-canvas .node", { hasText: "みんなの案" }).click();
    await expect(g.page.locator("textarea.draft")).toHaveCount(0);
    // ゲストが書いた物は、わたしにも見える
    const gb = (await g.page.locator(".shared-canvas").boundingBox())!;
    await g.page.mouse.click(gb.x + 150, gb.y + 300);
    await g.page.keyboard.type("ゲストの案");
    await g.page.keyboard.press("Escape");
    await expect(page.locator(".shared-canvas .node", { hasText: "ゲストの案" })).toHaveCount(1);
    // ゲストのマウスが、わたしの画面に名前つきで出る
    await g.page.mouse.move(gb.x + 300, gb.y + 200);
    await g.page.mouse.move(gb.x + 320, gb.y + 220);
    await expect(page.locator(".peer-cursor", { hasText: "ゲスト" })).toHaveCount(1);
    // 自分のボードの物を Ctrl+C → 共有ボードで Ctrl+Q: ゲストにはふつうの物・わたしには元へ飛ぶボタン
    await page.locator(".left-pane .node", { hasText: "自分の案" }).click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(200);
    await page.mouse.move(box.x + 300, box.y + 400);
    await page.locator(".shared-canvas").click({ position: { x: 300, y: 400 } });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+q");
    await expect(page.locator(".shared-canvas .node", { hasText: "自分の案" })).toHaveCount(1);
    await expect(page.locator(".shared-canvas .node", { hasText: "自分の案" }).locator(".origin-jump")).toHaveCount(1);
    await expect(g.page.locator(".shared-canvas .node", { hasText: "自分の案" })).toHaveCount(1);
    await expect(g.page.locator(".shared-canvas .node", { hasText: "自分の案" }).locator(".origin-jump")).toHaveCount(0);
    await shot("50-shared");
    // 終える → 2 人とも、自分のホームに「…-共有-会議」が入る
    await page.locator(".tbtn.share-btn").click();
    await page.locator(".ctxmenu .item", { hasText: "共有を終える" }).click();
    await expect(page.locator(".shared-pane")).toHaveCount(0, { timeout: 10000 });
    await expect(g.page.locator(".shared-pane")).toHaveCount(0, { timeout: 10000 });
    await settle();
    await g.page.waitForTimeout(700);
    for (const files of [mdFiles() && Object.values(mdFiles()), filesOf(g.vault)]) {
      expect(files.some((s) => /title: \d{4}-\d\d-\d\d-共有-会議/.test(s))).toBe(true);
      expect(files.some((s) => s.includes("title: みんなの案"))).toBe(true);
      expect(files.some((s) => s.includes("title: ゲストの案"))).toBe(true);
    }
    // わたしの保存では、持ち込んだ物は元へ飛べる(origin)。ゲストの保存には無い
    expect(Object.values(mdFiles()).some((s) => s.includes("title: 自分の案") && /origin: [a-z0-9]{10}/.test(s))).toBe(true);
    expect(filesOf(g.vault).some((s) => s.includes("origin:"))).toBe(false);
  } finally {
    await g.done();
  }
});

test("共有ボード: 招待の URL をブラウザで開くだけで入れる(名前と色を聞く・同時に書く・持ち帰る)", async () => {
  await page.evaluate(() => {
    (window as any).__app.config.me = { pid: "hostpid001", name: "わたし", color: "#0090ff" };
  });
  await page.locator(".tbtn.share-btn").click();
  await page.locator(".ctxmenu .item", { hasText: "新しい共有ボードを始める" }).click();
  await page.locator(".modal.ask .ask-input").fill("ブラウザ会");
  await page.locator(".modal.ask .ask-input").press("Enter");
  await page.locator(".modal.share-modal .btn.primary").click();
  const info = await page.evaluate(() => (window as any).bresuto.shareInfo());
  const url = info.local.replace("ws://", "http://").replace("/ws", "") + "/#" + info.code;
  // 「ブラウザ」: アプリの中に、ふつうの窓を開いて URL を読む(アプリの窓口は無い)
  const [web] = await Promise.all([
    app.waitForEvent("window"),
    app.evaluate(({ BrowserWindow }, u) => {
      const w = new BrowserWindow({ width: 1100, height: 760, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
      void w.loadURL(u);
    }, url),
  ]);
  await web.waitForSelector(".web-join");
  await web.locator(".web-join .ask-input").fill("友だち");
  await web.locator(".web-join .web-color").nth(3).click();
  await web.locator(".web-join .btn.primary").click();
  await expect(web.locator(".shared-title")).toContainText("ブラウザ会");
  await expect(page.locator(".shared-person", { hasText: "友だち" })).toHaveCount(1);
  // ブラウザで書く → アプリに届く
  await web.locator(".shared-canvas").click({ position: { x: 300, y: 200 } });
  await web.keyboard.type("ブラウザの案");
  await web.keyboard.press("Escape");
  await expect(page.locator(".shared-canvas .node", { hasText: "ブラウザの案" })).toHaveCount(1);
  // アプリで書く → ブラウザに届く
  const box = (await page.locator(".shared-canvas").boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 350);
  await page.keyboard.type("アプリの案");
  await page.keyboard.press("Escape");
  await expect(web.locator(".shared-canvas .node", { hasText: "アプリの案" })).toHaveCount(1);
  await web.screenshot({ path: shots ? path.join(shots, "51-web.png") : path.join(process.env.TMPDIR || tmpdir(), "51-web.png") });
  // 終える → ブラウザには「持ち帰る」
  await page.locator(".tbtn.share-btn").click();
  await page.locator(".ctxmenu .item", { hasText: "共有を終える" }).click();
  await expect(web.locator(".modal", { hasText: "共有が終わりました" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".shared-pane")).toHaveCount(0, { timeout: 10000 });
  await settle();
  expect(Object.values(mdFiles()).some((s) => s.includes("title: ブラウザの案"))).toBe(true);
});
