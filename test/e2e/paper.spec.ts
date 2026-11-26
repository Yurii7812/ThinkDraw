// 紙PKM の画面の試験。OCR は「使わない」設定にする(試験の結果を ollama に左右させない。OCR の精度は tools/paper-ocr-eval で実物を測る)
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

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
let input = "";
let files: string[] = [];

function sheet(name: string, id: string): string {
  const f = path.join(input, name);
  execFileSync("magick", ["-size", "620x877", "xc:white", "-fill", "#2040c0", "-pointsize", "34", "-annotate", "+20+44", id, "-pointsize", "20", "-annotate", "+60+200", `page ${id}`, f]);
  return f;
}

async function launch() {
  app = await electron.launch({
    args: ["--ozone-platform=x11", "."],
    env: { ...headlessEnv(), BRESUTO_VAULT: vault, BRESUTO_USERDATA: userData, BRESUTO_TEST: "1", BRESUTO_PICK_FILES: JSON.stringify(files) },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForSelector(".canvas");
}

test.beforeEach(async () => {
  const base = process.env.TMPDIR || tmpdir();
  vault = mkdtempSync(path.join(base, "td-vault-"));
  userData = mkdtempSync(path.join(base, "td-user-"));
  input = mkdtempSync(path.join(base, "td-scan-"));
  writeFileSync(path.join(userData, "config.json"), JSON.stringify({ ocr: { engine: "none" } }));
  const a = sheet("a.jpg", "1a"), b = sheet("b.jpg", "1a-1");
  const pdf = path.join(input, "scan.pdf");
  execFileSync("magick", [a, b, pdf]);
  files = [pdf, sheet("c.jpg", "0-1")];
  await launch();
});
test.afterEach(async () => {
  await app.close();
  for (const d of [vault, userData, input]) rmSync(d, { recursive: true, force: true });
});

test("紙PKM: 取り込み → IDを入れる → 系列ごとに Folgezettel の順 → キャンバスに置く → 再起動しても残る", async () => {
  await page.locator(".tbtn.paper-btn").click();
  await expect(page.locator(".paper .pp-empty")).toContainText("まだ紙のノートがありません");
  // 0 は、ページが無くても入口として出る
  await expect(page.locator(".pp-series")).toHaveCount(1);
  await expect(page.locator(".pp-series").first()).toContainText("全体索引");

  await page.locator(".pp-import").click();
  await expect(page.locator(".pp-srow")).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator(".pp-shead")).toContainText("OCR を使えませんでした");
  const ins = page.locator(".pp-srow .pp-in");
  await ins.nth(0).fill("1a");
  await ins.nth(1).fill("1a?-1");
  await expect(page.locator(".pp-commit")).toBeDisabled();
  await expect(page.locator(".pp-invalid")).toContainText("1 枚");
  await ins.nth(1).fill("1A-1");
  await ins.nth(2).fill("0-1");
  await expect(page.locator(".pp-commit")).toBeEnabled();
  await page.locator(".pp-commit").click();
  await expect(page.locator("#toast")).toContainText("3 ページを取り込みました");

  // 系列 0・1。1 は 索引(1a-1)→ 1a の順
  await expect(page.locator(".pp-series")).toHaveCount(2);
  await page.locator('.pp-series[data-series="1"]').click();
  await expect(page.locator(".pp-row .pp-fz")).toHaveText(["1a-1", "1a"]);
  await page.locator('.pp-row[data-fz="1a-1"]').click();
  await expect(page.locator(".pp-viewer .pp-img")).toBeVisible();
  await expect(page.locator(".pp-vid")).toHaveText("1a-1");
  // → で次のページ(全体の順)
  await page.locator(".pp-next").click();
  await expect(page.locator(".pp-vid")).toHaveText("1a");
  await page.locator(".pp-prev").click();
  await page.locator(".pp-prev").click();
  await expect(page.locator(".pp-vid")).toHaveText("0-1");
  await expect(page.locator('.pp-series[data-series="0"]')).toHaveClass(/active/);

  // ID を直す(内部IDは同じ)
  await page.locator(".pp-next").click();
  await page.locator(".pp-next").click();
  const pidBefore = await page.locator(".pp-row.active").getAttribute("data-pid");
  await page.locator(".pp-edit").click();
  await page.locator(".ask-input").fill("1a2");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pp-vid")).toHaveText("1a2");
  expect(await page.locator(".pp-row.active").getAttribute("data-pid")).toBe(pidBefore);
  await expect(page.locator(".pp-row .pp-fz")).toHaveText(["1a-1", "1a2"]);

  // キャンバスに置く
  await page.locator(".pp-place").click();
  await expect(page.locator(".paper")).toHaveCount(0);
  await expect(page.locator(".node.paper-node")).toHaveText(/紙 1a2/);
  await expect(page.locator(".node.paper-node img.paper-img")).toHaveCount(1);
  await page.waitForTimeout(700);
  const md = readdirSync(vault).filter((f) => f.endsWith(".md")).map((f) => readFileSync(path.join(vault, f), "utf8")).find((s) => s.includes("paper: "))!;
  expect(md).toContain(`paper: ${pidBefore}`);

  // 再起動しても残る
  await app.close();
  await launch();
  await expect(page.locator(".node.paper-node")).toHaveText(/紙 1a2/);
  // ノードを開くと、紙PKM のそのページ
  await page.locator(".node.paper-node").dblclick();
  await expect(page.locator(".pp-vid")).toHaveText("1a2");
  await expect(page.locator(".pp-used .chip")).toHaveCount(1);
  const ix = JSON.parse(readFileSync(path.join(vault, "paper", "index.json"), "utf8"));
  expect(ix.pages).toHaveLength(3);
  // Esc で閉じる
  await page.keyboard.press("Escape");
  await expect(page.locator(".paper")).toHaveCount(0);
});

test("紙PKM: 同じファイルをもう一度取り込むと、重複として既定で外れる", async () => {
  await page.keyboard.press("Control+p");
  await page.locator(".pp-import").click();
  await expect(page.locator(".pp-srow")).toHaveCount(3, { timeout: 30000 });
  const ins = page.locator(".pp-srow .pp-in");
  for (const [i, v] of ["1a", "1a-1", "0-1"].entries()) await ins.nth(i).fill(v);
  await page.locator(".pp-commit").click();
  await expect(page.locator("#toast")).toContainText("3 ページ");
  await page.locator(".pp-import").click();
  await expect(page.locator(".pp-srow")).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator(".pp-srow .pp-warn", { hasText: "同じ画像をすでに取り込んでいます" })).toHaveCount(3);
  await expect(page.locator(".pp-inc:checked")).toHaveCount(0);
  await expect(page.locator(".pp-commit")).toBeDisabled();
  await page.locator(".pp-cancel").click();
  await expect.poll(() => readdirSync(path.join(vault, "paper", ".staging"))).toEqual([]);
  await expect(page.locator(".pp-series")).toHaveCount(2);
});
