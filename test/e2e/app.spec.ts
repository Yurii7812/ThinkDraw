// 画面の試験: 本物の Electron を起動する。vault と設定は一時ディレクトリ(利用者のフォルダには触らない)
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

let app: ElectronApplication;
let page: Page;
let vault = "";
let userData = "";
const shots = process.env.THINKDRAW_SHOTS;

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
  app = await electron.launch({ args: ["."], env: { ...process.env, THINKDRAW_VAULT: vault, THINKDRAW_USERDATA: userData } });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForSelector(".canvas");
});
test.afterEach(async () => {
  await app.close();
  rmSync(vault, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

test("書いて Enter・Tab・Esc で、ノードと線ができる", async () => {
  await settle();
  expect(mdFiles()["root.md"]).toContain("title: ホーム");
  await page.mouse.click(300, 250);
  await page.keyboard.type("考え");
  await page.keyboard.press("Enter");
  await page.keyboard.type("次の考え");
  await page.keyboard.press("Tab");
  await page.keyboard.type("子");
  await page.keyboard.press("Escape");
  await settle();
  await shot("01-write");
  expect(titles().sort()).toEqual(["ホーム", "子", "次の考え", "考え"].sort());
  const files = mdFiles();
  const id = (t: string) => Object.entries(files).find(([, s]) => s.includes(`title: ${t}\n`))![0].replace(".md", "");
  expect(files[id("次の考え") + ".md"]).toContain(`to: ${id("子")}`);
  // 空にすると消える
  await page.locator(".node", { hasText: "子" }).click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await settle();
  expect(titles()).not.toContain("子");
  // 元に戻す
  await page.keyboard.press("Control+z");
  await settle();
  expect(titles()).toContain("子");
});

test("束ねる・開く・戻る、循環の拒否、検索", async () => {
  for (const [x, y, t] of [[300, 200, "りんご"], [300, 300, "みかん"]] as const) {
    await page.mouse.click(x, y);
    await page.keyboard.type(t);
    await page.keyboard.press("Escape");
  }
  await page.locator(".canvas").click({ position: { x: 900, y: 600 }, modifiers: ["Control"] });
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+g");
  await page.keyboard.type("果物");
  await page.keyboard.press("Escape");
  await settle();
  expect(titles()).toContain("果物");
  await page.locator(".node.t-group").dblclick();
  await expect(page.locator(".group-title")).toHaveText("果物");
  await expect(page.locator(".node")).toHaveCount(2);
  await shot("02-in-group");
  await page.locator(".i-back").click();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  // 検索で中のノードへ
  await page.keyboard.press("Control+k");
  await page.keyboard.type("みかん");
  await page.keyboard.press("Enter");
  await expect(page.locator(".group-title")).toHaveText("果物");
  // グラフ
  await page.keyboard.press("Control+e");
  await expect(page.locator(".graph-panel")).toBeVisible();
  await expect(page.locator(".g-node")).toHaveCount(2);
  await shot("03-graph");
  await page.locator(".seg-b[data-mode=nodes]").click();
  await expect(page.locator(".g-node")).toHaveCount(2);
});

test("本文のポップアップ: 書く・リンク・バックリンク・大画面", async () => {
  await page.mouse.click(300, 200);
  await page.keyboard.type("相手");
  await page.keyboard.press("Escape");
  await page.mouse.click(300, 400, { button: "right" });
  await page.getByText("ノートを作る").click();
  await page.keyboard.type("メモ");
  await page.keyboard.press("Enter");
  await page.keyboard.type("ここを見る");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("相手");
  await page.keyboard.press("Enter");
  await page.locator(".b-expand").click();
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await shot("04-popup");
  await page.keyboard.press("Escape");
  await settle();
  const files = mdFiles();
  const target = Object.entries(files).find(([, s]) => s.includes("title: 相手\n"))![0];
  const note = Object.values(files).find((s) => s.includes("title: メモ\n"))!;
  expect(note).toContain("type: note");
  expect(note).toContain(`[ここを見る](${target})`);
  // 相手のバックリンクにメモが出る
  await page.locator(".node", { hasText: "相手" }).click({ button: "right" });
  await page.getByText("本文を開く").click();
  await expect(page.locator(".pop-foot")).toContainText("メモ");
});

test("タロット: スプレッドを画面の中心に置く", async () => {
  await page.locator(".tbtn.draw").click();
  await page.locator(".spread-row", { hasText: "ケルト十字" }).click();
  await page.locator(".modal .btn.primary").click();
  await expect(page.locator(".node.t-card")).toHaveCount(10);
  await expect(page.locator(".spreadframe")).toHaveCount(1);
  await expect(page.locator(".poslabel").first()).toBeVisible();
  // 画像が読めている
  await expect.poll(() => page.locator(".node.t-card img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  const card = page.locator(".node.t-card").first();
  await card.hover();
  await page.waitForTimeout(100);
  await card.hover({ position: { x: 20, y: 30 } });
  await expect(page.locator(".cardtip")).toBeVisible();
  await shot("05-tarot");
  await settle();
  const cards = Object.values(mdFiles()).filter((s) => s.includes("type: card"));
  expect(cards.length).toBe(10);
  expect(cards[0]).toContain("deck: tarot");
  expect(cards[0]).toContain("この位置での読み");
});

test("右ドラッグで動かす・重ねるとグループ・状態の復元", async () => {
  for (const [x, y, t] of [[300, 200, "あ"], [600, 400, "い"]] as const) {
    await page.mouse.click(x, y);
    await page.keyboard.type(t);
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".node:not(.editing)")).toHaveCount(2);
  const a = page.locator(".node", { hasText: "あ" });
  const b = page.locator(".node", { hasText: "い" });
  const bb = (await b.boundingBox())!;
  const ab = (await a.boundingBox())!;
  await page.mouse.move(ab.x + 5, ab.y + 5);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(ab.x + 100, ab.y + 50, { steps: 5 });
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".node.t-group")).toHaveCount(1);
  await settle();
  // 左ドラッグで線: 空きへ引くと、つながった新しいノード
  await page.locator(".node.t-group").dblclick();
  const n = page.locator(".node", { hasText: "あ" });
  const nb = (await n.boundingBox())!;
  await page.mouse.move(nb.x + 5, nb.y + 5);
  await page.mouse.down();
  await page.mouse.move(nb.x + 200, nb.y + 120, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.type("つながり");
  await page.keyboard.press("Escape");
  await expect(page.locator(".edge")).toHaveCount(1);
  await settle();
  await app.close();
  // 再び起動すると、最後のグループを開く
  app = await electron.launch({ args: ["."], env: { ...process.env, THINKDRAW_VAULT: vault, THINKDRAW_USERDATA: userData } });
  page = await app.firstWindow();
  await page.waitForSelector(".canvas");
  await expect(page.locator(".group-title")).not.toHaveText("ホーム");
  await expect(page.locator(".node")).toHaveCount(3);
});

test("外部のエディタの変更を取り込む・ダーク・設定の画面", async () => {
  await page.mouse.click(300, 200);
  await page.keyboard.type("外から直す");
  await page.keyboard.press("Escape");
  await settle();
  const [name, src] = Object.entries(mdFiles()).find(([, s]) => s.includes("外から直す"))!;
  writeFileSync(path.join(vault, name), src.replace("title: 外から直す", "title: 直された"));
  await expect(page.locator(".node", { hasText: "直された" })).toBeVisible();
  await page.locator(".i-theme").click();
  await page.locator(".tbtn.draw").click();
  await page.locator(".spread-row", { hasText: "3枚（過去・現在・未来）" }).click();
  await page.locator(".modal .btn.primary").click();
  await page.keyboard.press("Control+e");
  await shot("06-dark");
  await page.keyboard.press("Control+/");
  await expect(page.locator(".shortcuts")).toBeVisible();
  await shot("07-settings");
});
