// 画面の試験: 本物の Electron を起動する。vault と設定は一時ディレクトリ(利用者のフォルダには触らない)
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// 利用者の画面に窓を出さない: Wayland を外し、xvfb の見えない画面(X11)だけで起動する。
// xvfb-run の外では動かさない(npm run test:e2e を使う)
const HEADLESS_ARGS = ["--ozone-platform=x11", "."];
function headlessEnv(): Record<string, string> {
  if (!process.env.THINKDRAW_HEADLESS) throw new Error("画面の試験は npm run test:e2e で(xvfb の中で)動かしてください");
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
  app = await electron.launch({ args: HEADLESS_ARGS, env: { ...headlessEnv(), THINKDRAW_VAULT: vault, THINKDRAW_USERDATA: userData, THINKDRAW_TEST: "1", THINKDRAW_EXPORT_DIR: exportDir } });
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
  // ↑ で上のグループ(所属先が 1 つならすぐ)
  await page.locator(".tbtn.group-up").click();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  await expect(page.locator(".tbtn.group-up")).toBeDisabled();
  // 右の欄の切り替えボタンは無い
  await expect(page.locator(".i-graph")).toHaveCount(0);
  await shot("03-up");
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
});

test("タロット: 引くメニューから置き、右の欄に解説、押すとつながった文字", async () => {
  await page.locator(".draw-caret").click();
  await expect(page.locator(".drawmenu")).toBeVisible();
  await page.locator(".dm-q").fill("仕事はどうなる?");
  await page.locator(".dm-tile", { hasText: "ケルト十字" }).click();
  await expect(page.locator(".node.t-card")).toHaveCount(10);
  await expect(page.locator(".node.t-text", { hasText: "仕事はどうなる?" })).toHaveCount(1);
  await expect(page.locator(".spreadframe")).toHaveCount(0);
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
  // 選んだ色(色 1)で描かれている(前は墨の色になっていた)
  const [strokeColor, c1] = await page.evaluate(() => [
    getComputedStyle(document.querySelector("path.stroke")!).stroke,
    getComputedStyle(document.documentElement).getPropertyValue("--c1").trim(),
  ]);
  const hex = (rgb: string) => "#" + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join("");
  expect(hex(strokeColor)).toBe(c1.toLowerCase());
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
  // 右クリックの「元の場所へ」で、元のグループへ
  await page.locator(".node.ref").click({ button: "right" });
  await page.locator(".ctxmenu .item", { hasText: "所属しているグループへ" }).click();
  await expect(page.locator(".group-title")).toHaveText("別の箱");
  await page.locator(".tbtn.group-up").click();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
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
  app = await electron.launch({ args: HEADLESS_ARGS, env: { ...headlessEnv(), THINKDRAW_VAULT: vault, THINKDRAW_USERDATA: userData, THINKDRAW_TEST: "1" } });
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
  await expect(page.locator(".sc-grid")).toBeVisible();
});

test("右の欄: 文字では開かない・カードを選ぶと自動で開く・空きをクリックで閉じる", async () => {
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
  // Ctrl+E は何もしない(右の欄はカードのときだけ)
  await page.keyboard.press("Control+e");
  await expect(page.locator(".main.side-open")).toHaveCount(0);
});

test("Ctrl+D: 今日の日記(年 › 月 › 日 のグループの「日記」ノート)を大画面で開く。2 回目は同じものを開く", async () => {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  await page.keyboard.press("Control+d");
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await expect(page.locator(".group-title")).toHaveText(ymd);
  await page.keyboard.type("今日のこと");
  await page.keyboard.press("Escape");
  await page.locator(".tbtn.group-up").click();
  await expect(page.locator(".group-title")).toHaveText(ymd.slice(0, 7));
  await page.keyboard.press("Control+d");
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await page.keyboard.press("Escape");
  await settle();
  const diaries = Object.values(mdFiles()).filter((t) => t.includes(`title: ${ymd}-日記\n`));
  expect(diaries).toHaveLength(1);
  expect(diaries[0]).toContain("今日のこと");
  expect(titles().map((t) => (t ?? "").replace(/"/g, ""))).toEqual(expect.arrayContaining([String(d.getFullYear()), ymd.slice(0, 7), ymd]));
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

test("横に開く: 別のグループを見ながら、右から左へドラッグで引用する", async () => {
  await write(300, 200, "向こうの考え");
  await page.locator(".node", { hasText: "向こうの考え" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("別のブレスト");
  await page.keyboard.press("Escape");
  await write(200, 500, "こちら");
  await page.keyboard.press("Control+\\");
  await page.keyboard.type("別のブレスト");
  await page.keyboard.press("Enter");
  await expect(page.locator(".peek .peek-title")).toContainText("別のブレスト");
  const src = page.locator(".peek .node", { hasText: "向こうの考え" });
  await expect(src).toHaveCount(1);
  await shot("10-beside");
  // 左ドラッグで、左の「こちら」の上に落とすと、引用して線でつなぐ
  const sb = (await src.boundingBox())!;
  const tb = (await page.locator(".canvas:not(.peek-canvas) .node", { hasText: "こちら" }).boundingBox())!;
  await page.mouse.move(sb.x + 5, sb.y + 5);
  await page.mouse.down();
  await page.mouse.move(sb.x - 100, sb.y + 20, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".canvas:not(.peek-canvas) .node.ref", { hasText: "向こうの考え" })).toHaveCount(1);
  await expect(page.locator(".canvas:not(.peek-canvas) .edge")).toHaveCount(1);
  await settle();
  expect(mdFiles()["root.md"]).toContain(`refs:\n  - { id: ${idOf("向こうの考え")}`);
  // 元のグループからは動いていない
  await expect(page.locator(".peek .node", { hasText: "向こうの考え" })).toHaveCount(1);
  // 真ん中のバーで幅を変えられる
  const bar = (await page.locator(".split-bar").boundingBox())!;
  await page.mouse.move(bar.x + 3, bar.y + 200);
  await page.mouse.down();
  await page.mouse.move(bar.x - 200, bar.y + 200, { steps: 5 });
  await page.mouse.up();
  const lw = (await page.locator(".left-pane").boundingBox())!.width;
  expect(lw).toBeLessThan(bar.x - 100);
  await shot("10b-split");
  // × で閉じる
  await page.locator(".peek-close").click();
  await expect(page.locator(".peek")).toHaveCount(0);
});

test("右クリックで一覧: ↑ は上のグループ、← は戻れる先", async () => {
  await page.keyboard.press("Control+d"); // ホーム › 年 › 月 › 日
  await page.keyboard.press("Escape");
  const ymd = (await page.locator(".group-title").textContent())!;
  await page.locator(".tbtn.group-up").click({ button: "right" });
  const items = page.locator(".ctxmenu .item");
  await expect(items).toHaveCount(4); // 月・年・記録・ホーム
  await expect(items.nth(0)).toContainText(ymd.slice(0, 7));
  await expect(items.nth(2)).toContainText("記録");
  await expect(items.nth(3)).toContainText("ホーム");
  await items.nth(1).click();
  await expect(page.locator(".group-title")).toHaveText(ymd.slice(0, 4));
  await page.locator(".i-back").click({ button: "right" });
  await expect(page.locator(".ctxmenu .item").first()).toContainText(ymd);
  await page.locator(".ctxmenu .item").nth(1).click(); // 2 つ前(ホーム)まで一度に戻る
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  await page.locator(".i-fwd").click({ button: "right" });
  await expect(page.locator(".ctxmenu .item")).toHaveCount(2);
});

test("引用を Delete で消しても、元のノードは消えない(引用だけ外れる)", async () => {
  await write(300, 200, "元の話");
  await page.locator(".node", { hasText: "元の話" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("元の箱");
  await page.keyboard.press("Escape");
  await write(300, 450, "ここ");
  await page.locator(".node", { hasText: "ここ" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+l");
  await page.keyboard.type("元の話");
  await page.keyboard.press("Enter");
  const ref = page.locator(".node.ref", { hasText: "元の話" });
  await expect(ref).toHaveCount(1);
  await ref.click({ button: "right" });
  await page.locator(".ctxmenu .item", { hasText: /^削除/ }).click();
  await expect(ref).toHaveCount(0);
  await settle();
  expect(titles()).toContain("元の話");
  expect(mdFiles()["root.md"]).not.toContain("refs:");
  await page.locator(".node.t-group", { hasText: "元の箱" }).dblclick();
  await expect(page.locator(".node", { hasText: "元の話" })).toHaveCount(1);
});

test("空きの右クリックでグループを作る", async () => {
  await page.mouse.click(400, 300, { button: "right" });
  await page.locator(".ctxmenu .item", { hasText: "グループを作る" }).click();
  await page.keyboard.type("新しい箱");
  await page.keyboard.press("Enter");
  await expect(page.locator(".node.t-group", { hasText: "新しい箱" })).toHaveCount(1);
});

test("記録一覧: 左に種類・右に記録。新しい種類を足す・上位を決める・今日を書く・日の右クリックで作る", async () => {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  await page.keyboard.press("Control+d");
  await page.keyboard.type("今日あったこと");
  await page.keyboard.press("Escape");
  await settle();
  expect(titles()).toEqual(expect.arrayContaining(["記録", `${ymd}-日記`]));
  await page.keyboard.press("Control+j");
  await expect(page.locator(".records")).toBeVisible();
  await page.locator(".rec-k[data-kind='']").click(); // すべて
  await expect(page.locator(".rec-row")).toHaveCount(1);
  await expect(page.locator(".rec-row")).toContainText("今日あったこと");
  // 左の「＋ 新しい種類」で名前を書いて Enter
  await page.locator(".rec-add").click();
  await page.keyboard.type("夢日記");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rec-k.active")).toContainText("夢日記");
  // この種類の設定で、上位 = 日記
  await page.locator(".rec-settings").click();
  await page.locator(".modal.kinds label", { hasText: "日記" }).click();
  await page.locator(".modal.kinds .btn.primary").click();
  await expect(page.locator(".rec-head")).toContainText("上位: 日記");
  await page.locator(".rec-write").click(); // ＋ 今日の夢日記を書く
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await page.keyboard.press("Escape");
  await settle();
  expect(titles()).toContain(`${ymd}-夢日記`);
  expect(mdFiles()[idOf(`${ymd}-日記`) + ".md"]).toContain(`to: ${idOf(`${ymd}-夢日記`)}`); // 上位から線
  // 日のグループの空きを右クリック: 記録を作る/開く・新しい種類で作る
  await page.mouse.click(900, 650, { button: "right" });
  await expect(page.locator(".ctxmenu .item", { hasText: "日記を開く" }).first()).toBeVisible();
  await page.locator(".ctxmenu .item", { hasText: "新しい種類で作る" }).click();
  await page.keyboard.type("読書記録");
  await page.keyboard.press("Enter");
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await page.keyboard.press("Escape");
  await settle();
  expect(titles()).toContain(`${ymd}-読書記録`);
  // 一覧: 日記を選ぶと下位(夢日記)も出る
  await page.keyboard.press("Control+j");
  await page.locator(".rec-k[data-kind='日記']").click();
  await expect(page.locator(".rec-row")).toHaveCount(2);
  await page.locator(".rec-k[data-kind='読書記録']").click();
  await expect(page.locator(".rec-row")).toHaveCount(1);
  await page.locator(".rec-k[data-kind='夢日記']").click();
  await shot("11-records");
  await page.locator(".rec-row").click();
  await expect(page.locator(".records")).toHaveCount(0);
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+j");
  await page.keyboard.press("Escape");
  await expect(page.locator(".records")).toHaveCount(0);
});

test("本文はノートだけ: 文字・グループのメニューに「ノートを書く」は無い", async () => {
  await write(300, 200, "ただの文字");
  await page.locator(".node", { hasText: "ただの文字" }).click({ button: "right" });
  await expect(page.locator(".ctxmenu")).toBeVisible();
  await expect(page.locator(".ctxmenu .item", { hasText: "ノートを書く" })).toHaveCount(0);
  await expect(page.locator(".ctxmenu .item", { hasText: "本文" })).toHaveCount(0);
});

test("ショートカット一覧はカードの形", async () => {
  await page.keyboard.press("Control+/");
  await expect(page.locator(".sc-card")).toHaveCount(6);
  await expect(page.locator(".sc-card kbd").first()).toBeVisible();
  await shot("12-help");
});

test("書き出し: 選んでいるときは選んだ物だけ", async () => {
  await write(300, 200, "選ぶ文字");
  await write(300, 400, "選ばない文字");
  await page.locator(".node", { hasText: /^選ぶ文字$/ }).click({ modifiers: ["Control"] });
  await page.locator(".tbtn.export").click();
  await expect(page.locator(".ctxmenu .item", { hasText: "選んでいる 1 件" })).toBeVisible();
  await page.getByText("Markdown(.md)").first().click();
  await expect.poll(() => readdirSync(exportDir)).toEqual(["ホーム-選択.md"]);
  const md = readFileSync(path.join(exportDir, "ホーム-選択.md"), "utf8");
  expect(md).toContain("選ぶ文字");
  expect(md).not.toContain("選ばない文字");
});

test("ノートで Markdown のように打つ: # で見出し・- で箇条書き・> で引用", async () => {
  await page.mouse.click(300, 400, { button: "right" });
  await page.getByText("ノートを作る").click();
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await page.keyboard.type("書き方");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## 見出し");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- 項目1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("項目2");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("> 引用文");
  await expect(page.locator(".ProseMirror h2")).toHaveText("見出し");
  await expect(page.locator(".ProseMirror li")).toHaveCount(2);
  await expect(page.locator(".ProseMirror blockquote")).toHaveText("引用文");
  await page.keyboard.press("Escape");
  await settle();
  const note = Object.values(mdFiles()).find((t) => t.includes("title: 書き方\n"))!;
  expect(note).toContain("## 見出し");
  expect(note).toMatch(/[*-] 項目1\n+[*-] 項目2/);
  expect(note).toContain("> 引用文");
});

test("グループのノード: ▸ で下のグループの木を出して飛ぶ", async () => {
  await write(300, 200, "奥の文字");
  await page.locator(".node", { hasText: "奥の文字" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("下の箱");
  await page.keyboard.press("Escape");
  await expect(page.locator(".node.t-group.selected", { hasText: "下の箱" })).toHaveCount(1); // 束ねたグループは選ばれている
  await page.keyboard.press("Control+g");
  await page.keyboard.type("上の箱");
  await page.keyboard.press("Escape");
  const top = page.locator(".node.t-group", { hasText: "上の箱" });
  await expect(top.locator(".g-peek")).toHaveCount(0); // 中身の文字は出さない
  await top.locator(".gtree-btn").click();
  await expect(page.locator(".gtree")).toBeVisible();
  await shot("13-gtree");
  await page.locator(".gtree .gt-name", { hasText: "下の箱" }).click();
  await expect(page.locator(".gtree")).toHaveCount(0);
  await expect(page.locator(".group-title")).toHaveText("下の箱");
  await expect(page.locator(".node", { hasText: "奥の文字" })).toHaveCount(1);
});
