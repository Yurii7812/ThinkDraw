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


// ---------- 2026-11-28 修正16 ----------
const posOf = (t: string) =>
  page.evaluate((title) => {
    const a = (window as any).__app;
    const n = [...a.vault.nodes.values()].find((x: any) => x.title === title);
    for (const g of [...a.vault.nodes.values()]) {
      const m = (g.members ?? []).find((m: any) => m.id === n.id);
      if (m) return { x: m.x, y: m.y, g: g.id };
    }
    return null;
  }, t);

test("修正16: 範囲選択してグループに落としても、並び(互いの位置)はそのまま", async () => {
  await page.evaluate(() => {
    const a = (window as any).__app;
    const v = a.vault, g = a.canvas.group;
    v.create({ type: "group", title: "箱", group: g, x: 700, y: 500 });
    v.create({ type: "text", title: "左上", group: g, x: 200, y: 200 });
    v.create({ type: "text", title: "右下", group: g, x: 380, y: 330 });
    a.canvas.renderNow();
  });
  await page.locator(".node", { hasText: "左上" }).click({ modifiers: ["Control"] });
  await page.locator(".node", { hasText: "右下" }).click({ modifiers: ["Control"] });
  const from = (await page.locator(".node", { hasText: "左上" }).boundingBox())!;
  const to = (await page.locator(".node.t-group", { hasText: "箱" }).boundingBox())!;
  await page.mouse.move(from.x + 5, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(to.x + 10, to.y + 10, { steps: 8 });
  await page.mouse.up();
  await settle();
  const a = (await posOf("左上"))!, b = (await posOf("右下"))!;
  expect(a.g).toBe(b.g);
  expect(b.x - a.x).toBe(180);
  expect(b.y - a.y).toBe(130);
});

test("修正16: コピーの形は貼り付けと同じ網の箇条書き(Ctrl+Q で貼ると同じ図に戻る)", async () => {
  await page.evaluate(() => {
    const a = (window as any).__app;
    const v = a.vault, g = a.canvas.group;
    const p = v.create({ type: "text", title: "親", group: g, x: 200, y: 200 });
    const c = v.create({ type: "text", title: "子", group: g, x: 400, y: 200 });
    v.addLink(p.id, c.id);
    v.setLinkLabel(p.id, c.id, "理由");
    a.canvas.renderNow();
  });
  await page.locator(".node", { hasText: "親" }).click({ modifiers: ["Control"] });
  await page.locator(".node", { hasText: /^子$/ }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("親\n  (理由)子");
});

test("修正16: Tab で書いた文字は、書いて伸びたあとも囲い(枠)に入らない(左右どちらに置かれても)", async () => {
  // 書き始める場所(画面の 600,350)の左右すぐ近くに、縦に長い囲い。上下は空いているので、Tab の文字は上か下に置かれ、書くと横に伸びる
  await page.evaluate(() => {
    const a = (window as any).__app;
    const v = a.vault, g = a.canvas.group;
    const w = a.canvas.toWorld(600, 350);
    v.create({ type: "frame", title: "右の枠", group: g, x: Math.round(w.x + 70), y: Math.round(w.y - 300), size: { w: 400, h: 600 } });
    v.create({ type: "frame", title: "左の枠", group: g, x: Math.round(w.x - 470), y: Math.round(w.y - 300), size: { w: 400, h: 600 } });
    a.canvas.renderNow();
  });
  await page.mouse.click(600, 350);
  await page.keyboard.type("元");
  await page.keyboard.press("Tab");
  await page.keyboard.type("とても長い文章をここに書いて、まわりの囲いにかかるくらいまで伸ばしてみる");
  await page.keyboard.press("Escape");
  await settle();
  const r = await page.evaluate(() => {
    const a = (window as any).__app;
    const rect = (f: (t: string) => boolean) => a.canvas.rectOf([...a.vault.nodes.values()].find((x: any) => f(x.title)).id);
    return { t: rect((t) => t.startsWith("とても長い")), r: rect((t) => t === "右の枠"), l: rect((t) => t === "左の枠") };
  });
  const hit = (a: any, b: any) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  expect(hit(r.t, r.r)).toBe(false);
  expect(hit(r.t, r.l)).toBe(false);
});
