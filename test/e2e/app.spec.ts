// 画面の試験: 本物の Electron を起動する。vault と設定は一時ディレクトリ(利用者のフォルダには触らない)
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

let app: ElectronApplication;
let page: Page;
let vault = "";
let userData = "";
let exportDir = "";
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
  exportDir = mkdtempSync(path.join(base, "td-export-"));
  app = await electron.launch({ args: ["."], env: { ...process.env, THINKDRAW_VAULT: vault, THINKDRAW_USERDATA: userData, THINKDRAW_TEST: "1", THINKDRAW_EXPORT_DIR: exportDir } });
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

test("書いて Enter・Tab・Esc で、ノードと線ができる(まわりに散らばる)", async () => {
  await settle();
  expect(mdFiles()["root.md"]).toContain("title: ホーム");
  await page.mouse.click(400, 300);
  await page.keyboard.type("考え");
  await page.keyboard.press("Tab");
  await page.keyboard.type("子1");
  // 書いている最中でも、つなぎ元との仮の線が見える
  await expect(page.locator("path.draftline")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("子2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("子3");
  await page.keyboard.press("Escape");
  await settle();
  await shot("01-write");
  expect(titles().sort()).toEqual(["ホーム", "子1", "子2", "子3", "考え"].sort());
  const files = mdFiles();
  for (const c of ["子1", "子2", "子3"]) expect(files[idOf("考え") + ".md"]).toContain(`to: ${idOf(c)}`);
  // 重ならない
  const boxes = await page.locator(".node").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.x, r.y, r.width, r.height]));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [ax, ay, aw, ah] = boxes[i], [bx, by, bw, bh] = boxes[j];
      expect(ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah).toBe(false);
    }
  // 文字は 1 回クリックですぐ書き直せる。右の欄は開かない。空にすると消える
  await page.locator(".node", { hasText: "子3" }).click();
  await expect(page.locator("textarea.draft")).toHaveCount(1);
  await expect(page.locator(".main.side-open")).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await settle();
  expect(titles()).not.toContain("子3");
  await page.keyboard.press("Control+z");
  await settle();
  expect(titles()).toContain("子3");
});

test("束ねる・開く・戻る、検索、グラフ", async () => {
  await write(300, 200, "りんご");
  await write(300, 300, "みかん");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+g");
  await page.keyboard.type("果物");
  await page.keyboard.press("Escape");
  await settle();
  expect(titles()).toContain("果物");
  await page.locator(".node.t-group").dblclick();
  await expect(page.locator(".group-title")).toHaveText("果物");
  await expect(page.locator(".node")).toHaveCount(2);
  await page.locator(".i-back").click();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("みかん");
  await page.keyboard.press("Enter");
  await expect(page.locator(".group-title")).toHaveText("果物");
  if (!(await page.locator(".side-panel").isVisible())) await page.keyboard.press("Control+e");
  await page.locator(".side-tabs .seg-b[data-tab=graph]").click();
  await page.locator(".seg-b[data-mode=groups]").click();
  await expect(page.locator(".g-node")).toHaveCount(2);
  await page.locator(".seg-b[data-mode=local]").click();
  // 今のグループ・その親・選んでいるノード(検索で選ばれた「みかん」)
  await expect(page.locator(".g-node")).toHaveCount(3);
  await shot("03-graph");
});

test("ノートは大画面で開く・Ctrl+L で検索してリンク・バックリンク", async () => {
  await write(300, 200, "相手");
  await page.mouse.click(300, 400, { button: "right" });
  await page.getByText("ノートを作る").click();
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await page.keyboard.type("メモ");
  await page.keyboard.press("Enter");
  await page.keyboard.type("前置き ");
  await page.keyboard.press("Control+l");
  await page.keyboard.type("相手");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" を見る");
  await shot("04-popup");
  await page.keyboard.press("Escape");
  await settle();
  const note = Object.values(mdFiles()).find((s) => s.includes("title: メモ\n"))!;
  expect(note).toContain("type: note");
  expect(note).toContain(`前置き [相手](${idOf("相手")}.md) を見る`);
  await page.locator(".node.t-text", { hasText: "相手" }).click({ button: "right" });
  await page.getByText("ノートを書く").click();
  await expect(page.locator(".pop-foot")).toContainText("メモ");
});

test("タロット: 引くメニューから置き、右の欄に解説、押すとつながった文字", async () => {
  await page.locator(".draw-caret").click();
  await expect(page.locator(".drawmenu")).toBeVisible();
  await page.locator(".dm-q").fill("仕事はどうなる?");
  await page.locator(".dm-tile", { hasText: "ケルト十字" }).click();
  await expect(page.locator(".node.t-card")).toHaveCount(10);
  await expect(page.locator(".node.t-text", { hasText: "仕事はどうなる?" })).toHaveCount(1);
  await expect(page.locator(".spreadframe")).toHaveCount(1);
  await expect.poll(() => page.locator(".node.t-card img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await page.locator(".node.t-card").first().click();
  await expect(page.locator(".side-panel .d-reading")).toBeVisible();
  // 右の欄が、スクロールしなくても見える(1280×800)
  const over = await page.locator(".side-panel .detail").evaluate((e) => e.scrollHeight - e.clientHeight);
  expect(over).toBeLessThanOrEqual(0);
  await shot("05-tarot");
  const chip = page.locator(".side-panel .d-sec .chip").first();
  const word = (await chip.textContent())!;
  await chip.click();
  await expect(page.locator("textarea.draft")).toHaveValue(word);
  await page.keyboard.press("Escape");
  await settle();
  const cards = Object.values(mdFiles()).filter((s) => s.includes("type: card"));
  expect(cards.length).toBe(10);
  expect(titles()).toContain(word);
});

test("易と発想カード", async () => {
  await page.locator(".draw-caret").click();
  await page.locator(".dm-tabs button", { hasText: "易" }).click();
  await page.locator(".dm-tile", { hasText: "卦を立てる" }).click();
  await expect(page.locator(".node.deck-iching").first()).toBeVisible();
  await page.locator(".node.deck-iching").first().click();
  await expect(page.locator(".side-panel")).toContainText("易の読み方");
  await page.locator(".draw-caret").click();
  await page.locator(".dm-tabs button", { hasText: "発想カード" }).click();
  await page.locator(".dm-tile", { hasText: "SCAMPER" }).click();
  await expect(page.locator(".node.deck-prompt")).toHaveCount(7);
  await shot("06-iching-prompt");
  // 「引く」ボタンは最後の引き方をもう一度
  await page.locator(".tbtn.draw").click();
  await expect(page.locator(".node.deck-prompt")).toHaveCount(14);
});

test("ペン: 描く・選んで消す・元に戻す", async () => {
  await page.locator(".i-pen").click();
  await expect(page.locator(".penbar")).toBeVisible();
  await page.locator(".penbar .sw.c1").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(300 + i * 20, 300 + (i % 2) * 15);
  await page.mouse.up();
  await expect(page.locator("path.stroke")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".penbar")).toBeHidden();
  await settle();
  expect(mdFiles()["root.md"]).toMatch(/strokes:\n  - \{ id: \w+, c: 1, w: \d+, p: "-?\d+,-?\d+ /);
  // 範囲選択で選んで消す
  await page.mouse.move(250, 250);
  await page.mouse.down();
  await page.mouse.move(600, 380, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("path.stroke.selected")).toHaveCount(1);
  await page.keyboard.press("Delete");
  await expect(page.locator("path.stroke")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator("path.stroke")).toHaveCount(1);
  await shot("07-pen");
});

test("引用: Ctrl+L でほかのグループの物を引用して線でつなぐ(点線の枠)", async () => {
  await write(300, 200, "遠い話");
  await page.locator(".node", { hasText: "遠い話" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("別の箱");
  await page.keyboard.press("Escape");
  await write(300, 400, "こちら");
  await page.locator(".node", { hasText: "こちら" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+l");
  await page.keyboard.type("遠い話");
  await page.keyboard.press("Enter");
  await expect(page.locator(".node.ref", { hasText: "遠い話" })).toHaveCount(1);
  await expect(page.locator(".edge")).toHaveCount(1);
  await settle();
  expect(mdFiles()["root.md"]).toContain(`refs:\n  - { id: ${idOf("遠い話")}`);
  // 所属先は元のグループのまま
  await page.keyboard.press("Control+e");
  await page.mouse.click(900, 650);
  await page.locator(".node.ref").click({ modifiers: ["Control"] });
  await page.locator(".side-tabs .seg-b[data-tab=rel]").click();
  await expect(page.locator(".side-panel .rel-item").first()).toContainText("別の箱");
  await expect(page.locator(".side-panel .rel-item").nth(1)).toContainText("ホーム");
  await shot("08b-rel");
  // 所属先を押すと、そのグループへ上がれる
  await page.locator(".side-panel .rel-item").first().click();
  await expect(page.locator(".group-title")).toHaveText("別の箱");
  // 関係の欄も、上がった先のグループに切り替わる(続けて上がれる)
  await expect(page.locator(".side-panel .rel-head")).toContainText("別の箱");
  await expect(page.locator(".side-panel .rel-item").first()).toContainText("ホーム");
  // 上へ ▾ メニューからホームへ
  await page.locator(".group-up").click();
  await shot("08c-up");
  await page.locator(".ctxmenu .item", { hasText: "ホーム" }).first().click();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  // 地図タブ: 木に「別の箱」が出る
  await page.locator(".side-tabs .seg-b[data-tab=map]").click();
  await expect(page.locator(".side-panel .tr", { hasText: "別の箱" }).first()).toBeVisible();
  await shot("08-ref");
});

test("右ドラッグで動かす・重ねるとグループ・状態の復元", async () => {
  await write(300, 200, "あ");
  await write(600, 400, "い");
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
  app = await electron.launch({ args: ["."], env: { ...process.env, THINKDRAW_VAULT: vault, THINKDRAW_USERDATA: userData, THINKDRAW_TEST: "1" } });
  page = await app.firstWindow();
  await page.waitForSelector(".canvas");
  await expect(page.locator(".group-title")).not.toHaveText("ホーム");
  await expect(page.locator(".node")).toHaveCount(3);
});

test("外部のエディタの変更を取り込む・ダーク・設定の画面", async () => {
  await write(300, 200, "外から直す");
  await settle();
  const [name, src] = Object.entries(mdFiles()).find(([, s]) => s.includes("外から直す"))!;
  writeFileSync(path.join(vault, name), src.replace("title: 外から直す", "title: 直された"));
  await expect(page.locator(".node", { hasText: "直された" })).toBeVisible();
  await page.locator(".i-theme").click();
  await page.locator(".draw-caret").click();
  await page.locator(".dm-tile", { hasText: "過去・現在・未来" }).click();
  await page.locator(".node.t-card").first().click();
  await shot("09-dark");
  await page.keyboard.press("Control+/");
  await expect(page.locator(".shortcuts")).toBeVisible();
});

test("右の欄: 文字では開かない・カードを選ぶと自動で開く・空きをクリックで閉じる・手で開いた分は残る", async () => {
  await write(300, 200, "ふつうの文字");
  await page.locator(".node", { hasText: "ふつうの文字" }).click();
  await expect(page.locator("textarea.draft")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".main.side-open")).toHaveCount(0);
  await page.locator(".draw-caret").click();
  await page.locator(".dm-tile", { hasText: "過去・現在・未来" }).click();
  await page.locator(".node.t-card").first().click();
  await expect(page.locator(".main.side-open")).toHaveCount(1);
  await page.mouse.click(60, 700);
  await page.keyboard.press("Escape");
  await expect(page.locator(".main.side-open")).toHaveCount(0);
  // 手で開いた分は、カードを選んでも外しても閉じない
  await page.keyboard.press("Control+e");
  await expect(page.locator(".main.side-open")).toHaveCount(1);
  await page.locator(".node.t-card").first().click();
  await page.mouse.click(60, 700);
  await page.keyboard.press("Escape");
  await expect(page.locator(".main.side-open")).toHaveCount(1);
});

test("書き出し: Markdown・画像・HTML(試験では指定の場所へ書く)", async () => {
  await write(300, 200, "書き出す文字");
  await page.locator(".tbtn.export").click();
  await page.getByText("Markdown(.md)").click();
  await page.locator(".tbtn.export").click();
  await page.getByText("画像(.png)").click();
  await page.locator(".tbtn.export").click();
  await page.getByText("HTML(.html)").click();
  await expect.poll(() => readdirSync(exportDir).sort()).toEqual(["ホーム.html", "ホーム.md", "ホーム.png"]);
  expect(readFileSync(path.join(exportDir, "ホーム.md"), "utf8")).toContain("- 書き出す文字");
  expect(readFileSync(path.join(exportDir, "ホーム.html"), "utf8")).toContain("書き出す文字");
  const png = readFileSync(path.join(exportDir, "ホーム.png"));
  expect(png.subarray(1, 4).toString()).toBe("PNG");
});
