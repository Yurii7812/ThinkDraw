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
  await page.locator(".tbtn.draw").click();
  await expect(page.locator(".drawmenu")).toBeVisible();
  await page.locator(".dm-q").fill("仕事はどうなる?");
  await page.locator(".dm-tile", { hasText: "ケルト十字" }).click();
  await expect(page.locator(".node.t-card")).toHaveCount(10);
  await expect(page.locator(".node.t-text", { hasText: "仕事はどうなる?" })).toHaveCount(1);
  await expect(page.locator(".spreadframe")).toHaveCount(0);
  await expect.poll(() => page.locator(".node.t-card img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await page.locator(".node.t-card").first().click();
  await expect(page.locator(".side-panel .d-reading")).toBeVisible();
  // 2026-11-24: 絵の中のもの全部と象徴・いろいろな意味・たくさんの問い(右の欄はスクロールしてよい)
  // 2026-11-24 見本 B: 読み|絵|問い の切り替え。読みには出た向きの意味と、意味の言葉 30 語
  await expect(page.locator(".side-panel .d-tabs button")).toHaveCount(3);
  await expect(page.locator(".side-panel .d-meanings").first()).toBeVisible();
  expect(await page.locator(".side-panel .d-word").count()).toBe(30);
  await shot("05-tarot");
  await page.locator(".side-panel .d-tabs button", { hasText: "問い" }).click();
  expect(await page.locator(".side-panel .d-q").count()).toBeGreaterThanOrEqual(8);
  await page.locator(".side-panel .d-tabs button", { hasText: "絵" }).click();
  expect(await page.locator(".side-panel .d-item").count()).toBeGreaterThanOrEqual(6);
  const item = page.locator(".side-panel .d-item").first();
  const word = (await item.locator(".d-item-n").textContent())!;
  await item.click();
  await expect(page.locator("textarea.draft")).toHaveValue(word); // 「: 」は付けない(2026-11-24 利用者)
  await page.keyboard.type("崖");
  await page.keyboard.press("Escape");
  await settle();
  const cards = Object.values(mdFiles()).filter((s) => s.includes("type: card"));
  expect(cards.length).toBe(10);
  expect(Object.values(mdFiles()).some((s) => s.includes(word + "崖"))).toBe(true);
});

test("易と発想カード", async () => {
  await page.locator(".tbtn.draw").click();
  await page.locator(".dm-tabs button", { hasText: "易" }).click();
  await page.locator(".dm-tile", { hasText: "卦を立てる" }).click();
  await expect(page.locator(".node.deck-iching").first()).toBeVisible();
  await page.locator(".node.deck-iching").first().click();
  await expect(page.locator(".side-panel")).toContainText("易の読み方");
  await page.locator(".tbtn.draw").click();
  await page.locator(".dm-tabs button", { hasText: "発想" }).click();
  await expect(page.locator(".drawmenu.narrow")).toBeVisible(); // 発想は細いメニュー(1 行ずつ)
  await page.locator(".dm-row", { hasText: "SCAMPER" }).click();
  await expect(page.locator(".node.deck-prompt")).toHaveCount(7);
  // 札(文字と同じ大きさ)。選ぶと下に問いが出て、右の欄は開かない
  const chip = page.locator(".node.pchip", { hasText: "置き換える" });
  expect((await chip.boundingBox())!.height).toBeLessThan(40);
  await page.keyboard.press("Escape");
  await chip.click();
  await expect(chip.locator(".pchip-q")).toBeVisible();
  await expect(chip.locator(".pchip-q")).toContainText("別のものに替えたら");
  await expect(page.locator(".main.side-open")).toHaveCount(0);
  await shot("06-iching-prompt");
  // デッキのボタンは、押すと一覧が出る(引いたものがいきなり出ない)
  await page.locator(".tbtn.draw").click();
  await expect(page.locator(".drawmenu")).toBeVisible();
  await expect(page.locator(".node.deck-prompt")).toHaveCount(7);
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
  await page.locator(".picker-row", { hasText: "遠い話" }).last().click(); // グループの中身 → ノード の順なので、ノードは下
  await expect(page.locator(".node.ref", { hasText: "遠い話" })).toHaveCount(1);
  await expect(page.locator(".edge")).toHaveCount(1);
  await settle();
  expect(mdFiles()["root.md"]).toContain(`refs:\n  - { id: ${idOf("遠い話")}`);
  // 右クリックの「元の場所へ」で、元のグループへ
  await page.locator(".node.ref").click({ button: "right" });
  await page.locator(".ctxmenu .mb-btn", { hasText: "引用元へ" }).click();
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
  await page.locator(".tbtn.draw").click();
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
  await page.locator(".tbtn.draw").click();
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

test("Ctrl+D: 今日のグループ(記録 › 年 › 月 › 日)を開く。日記のノートは開かない。2 回目も同じグループ", async () => {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  await page.keyboard.press("Control+d");
  await expect(page.locator(".group-title")).toHaveText(ymd);
  await expect(page.locator(".popup")).toHaveCount(0);
  await page.locator(".tbtn.group-up").click();
  await expect(page.locator(".group-title")).toHaveText(ymd.slice(0, 7));
  await page.keyboard.press("Control+d");
  await expect(page.locator(".group-title")).toHaveText(ymd);
  await settle();
  expect(Object.values(mdFiles()).filter((t) => t.includes(`title: ${ymd}\n`))).toHaveLength(1);
  expect(titles().join("\n")).not.toContain("日記");
  expect(titles().map((t) => (t ?? "").replace(/"/g, ""))).toEqual(expect.arrayContaining([String(d.getFullYear()), ymd.slice(0, 7), ymd]));
});

test("Esc で選択が外れる/R で名前を変える/Ctrl+C → 別のグループで Ctrl+V は引用", async () => {
  await write(300, 200, "りんご");
  await write(300, 300, "みかん");
  // クリックで選ぶ → Esc で外れる
  await page.locator(".node", { hasText: "りんご" }).click({ modifiers: ["Control"] });
  await expect(page.locator(".node.selected")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".node.selected")).toHaveCount(0);
  // 右クリック → R で書き直し(名前を変える)
  await page.locator(".node", { hasText: "みかん" }).click({ button: "right" });
  await expect(page.locator(".ctxmenu")).toBeVisible();
  await page.keyboard.press("r");
  await expect(page.locator("textarea.draft")).toHaveCount(1);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("オレンジ");
  await page.keyboard.press("Escape");
  await expect(page.locator(".node", { hasText: "オレンジ" })).toHaveCount(1);
  // 2 つ選んでコピー → 空きに「入れ物」を作って開き、貼る
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Escape");
  await page.mouse.click(700, 500, { button: "right" });
  await page.getByText("ここにグループを作る").click();
  await page.keyboard.type("別の場所");
  await page.keyboard.press("Escape");
  await page.locator(".node.t-group", { hasText: "別の場所" }).click();
  await page.keyboard.press("Enter"); // 選んで Enter で開く
  await expect(page.locator(".group-title")).toHaveText("別の場所");
  await page.keyboard.press("Control+v");
  await expect(page.locator(".node.ref")).toHaveCount(2);
  await settle();
  const g = mdFiles()[idOf("別の場所") + ".md"];
  expect(g).toContain("refs:");
  expect(g).toContain(idOf("りんご"));
  expect(g).toContain(idOf("オレンジ"));
});

test("右上の「添付」から チェックリスト・表をノードとして置く。キャンバスには中身が全部見える(2026-11-25)", async () => {
  await page.locator(".tbtn.attach-btn").click();
  await page.locator(".ctxmenu .mb-btn", { hasText: "チェック" }).click();
  await expect(page.locator(".popup")).toBeVisible();
  await page.keyboard.type("牛乳");
  await page.keyboard.press("Enter");
  await page.keyboard.type("パン");
  await expect(page.locator(".ProseMirror li.task")).toHaveCount(2);
  await page.locator(".ProseMirror li.task .task-box").first().click();
  await expect(page.locator(".ProseMirror li.task.done")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.locator(".popup").waitFor({ state: "detached" }).catch(() => {});
  await page.locator(".tbtn.attach-btn").click();
  await page.locator(".ctxmenu .mb-btn", { hasText: "表" }).click();
  await expect(page.locator(".ProseMirror table")).toHaveCount(1);
  await page.keyboard.type("名前");
  await page.keyboard.press("Tab");
  await page.keyboard.type("値");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.type("x");
  await expect(page.locator(".ProseMirror table")).toContainText("名前値");
  await page.locator(".b-tableops").click();
  await page.getByText("右に列を足す").click();
  await expect(page.locator(".ProseMirror tr").first().locator("th")).toHaveCount(4);
  await settle();
  const md = Object.values(mdFiles()).find((t) => t.includes("title: チェックリスト"))!;
  expect(md).toContain("[x] 牛乳");
  expect(md).toContain("[ ] パン");
  const tb = Object.values(mdFiles()).find((t) => t.includes("title: 表\n"))!;
  expect(tb).toContain("| 名前 |");
  expect(tb).toContain("| --- |");
  await page.keyboard.press("Escape");
  await page.locator(".popup").waitFor({ state: "detached" }).catch(() => {});
  await expect(page.locator(".node.t-note .excerpt")).toHaveCount(0);
  const cv = page.locator(".node.t-note", { hasText: "チェックリスト" });
  await expect(cv).toContainText("牛乳");
  await expect(cv).toContainText("パン");
  await expect(cv.locator("li.task.done")).toHaveCount(1);
  // キャンバスの上でも、チェックの箱を押せる(本文に書かれる)
  await cv.locator(".task-box").nth(1).click();
  await expect(cv.locator("li.task.done")).toHaveCount(2);
  await settle();
  expect(Object.values(mdFiles()).find((t) => t.includes("title: チェックリスト"))!).toContain("[x] パン");
  const tbl = page.locator(".node.t-note", { hasText: "名前" });
  await expect(tbl.locator("th")).toHaveCount(4);
  await expect(tbl).toContainText("値");
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
  await page.locator(".picker-row", { hasText: "元の話" }).last().click(); // グループの中身 → ノード の順なので、ノードは下
  const ref = page.locator(".node.ref", { hasText: "元の話" });
  await expect(ref).toHaveCount(1);
  await ref.click({ button: "right" });
  await page.locator(".ctxmenu .mb-btn", { hasText: "外す" }).click();
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

test("2026-11-24 統合仕様 10〜15: 日付グループの題・Ctrl+D は題付きを使う・@ マーカー・同じ日同じ種類のノートを何枚でも・Ctrl+J は全画面", async () => {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  await page.keyboard.press("Control+d");
  await expect(page.locator(".group-title")).toHaveText(ymd);
  // 上の鉛筆で題(日付はそのまま)
  await page.locator(".title-edit").click();
  await expect(page.locator(".title-date")).toHaveText(ymd + "-");
  await page.keyboard.type("設計を考えた日");
  await page.keyboard.press("Enter");
  await expect(page.locator(".group-title")).toHaveText(`${ymd}-設計を考えた日`);
  await write(400, 300, "その日の考え");
  // Ctrl+D は題付きのグループをそのまま使う(日付だけのものを重ねて作らない)
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+d");
  await expect(page.locator(".group-title")).toHaveText(`${ymd}-設計を考えた日`);
  await settle();
  expect(titles().filter((t) => t?.startsWith(ymd)).length).toBe(1);
  expect(titles().join("\n")).not.toContain("日記"); // 日記は作らない
  // Ctrl+J: アプリの中身の所全体
  await page.keyboard.press("Control+j");
  const box = (await page.locator(".records").boundingBox())!;
  expect(box.width).toBeGreaterThan(1200);
  await expect(page.locator(`.rec-cell.sel.today.has[data-date='${ymd}']`)).toHaveCount(1);
  await expect(page.locator(".rec-day-name")).toHaveValue("設計を考えた日");
  // ボードの縮小(見るだけ)
  await expect(page.locator(".rec-preview .preview-canvas .node", { hasText: "その日の考え" })).toHaveCount(1);
  // @ マーカー(ノートは作らない)
  await page.locator(".rec-chip.add").click();
  await page.keyboard.type("読書");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rec-chip[data-marker='読書']")).toHaveCount(1);
  await page.locator(".rec-chip.add").click();
  await page.keyboard.type("@読書");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rec-chip[data-marker='読書']")).toHaveCount(1); // 同じものは 1 つだけ
  await settle();
  expect(Object.values(mdFiles()).some((t) => t.includes(`title: ${ymd}-設計を考えた日`) && /markers: \["?読書"?\]/.test(t))).toBe(true);
  expect(Object.values(mdFiles()).filter((t) => t.includes("type: note")).length).toBe(0);
  // マーカーで絞る: 今日は残る
  await page.locator(".rec-mk[data-marker='読書']").click();
  await expect(page.locator(`.rec-cell.has[data-date='${ymd}']`)).toHaveCount(1);
  // 題をここで直すと、グループの名前に入る
  await page.locator(".rec-sw", { hasText: "この日" }).click(); // しるしを選ぶと一覧になるので、この日へ
  await page.locator("input.rec-day-name").fill("ThinkDraw-設計");
  await page.locator("input.rec-day-name").press("Enter");
  await page.locator(".rec-mk[data-marker='']").click(); // 絞り込みをやめる(次に開いたときも この日 から)
  await settle();
  expect(titles()).toContain(`${ymd}-ThinkDraw-設計`);
  // 同じ日・同じ種類のノートを 2 枚
  for (let k = 0; k < 2; k++) {
    if (!(await page.locator(".records").count())) await page.keyboard.press("Control+j");
    await page.locator(".rec-new").click();
    await page.locator(".modal.ask .ask-input").fill("夢");
    await page.locator(".modal.ask .ask-input").press("Enter");
    await expect(page.locator(".popup.expanded")).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await settle();
  expect(titles().filter((t) => t === `${ymd}-夢`).length).toBe(2);
  await page.keyboard.press("Control+j");
  await expect(page.locator(".rec-item", { hasText: "夢" })).toHaveCount(2);
  await expect(page.locator(".rec-item .rec-time").first()).toHaveText(/^\d\d:\d\d$/);
  await shot("11-records");
  // ← で前の日・→ で戻る
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".rec-cell.sel.today")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".rec-cell.sel.today")).toHaveCount(1);
  // 押すとそのノート
  await page.locator(".rec-item", { hasText: "夢" }).first().click();
  await expect(page.locator(".records")).toHaveCount(0);
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await page.keyboard.press("Escape");
  // ボードを開く・Esc で閉じる
  await page.keyboard.press("Control+j");
  await page.locator(".rec-open-day").click();
  await expect(page.locator(".group-title")).toHaveText(`${ymd}-ThinkDraw-設計`);
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

test("島(まわり・全体): 今のグループはそのまま、ほかのグループも同じ見た目の島で。範囲の切り替え・島の中の線・ドラッグで引用", async () => {
  await write(300, 200, "中の考え");
  await page.locator(".node", { hasText: "中の考え" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("宗教");
  await page.keyboard.press("Escape");
  await write(300, 500, "外の考え");
  await write(600, 500, "外の続き");
  await page.evaluate(() => {
    const v = (window as any).__app.vault;
    const id = (t: string) => [...v.nodes.values()].find((n: any) => n.title === t).id;
    v.addLink(id("中の考え"), id("外の考え"));
    v.addLink(id("外の考え"), id("外の続き"));
  });
  await page.locator(".node.t-group", { hasText: "宗教" }).dblclick();
  await expect(page.locator(".group-title")).toHaveText("宗教");
  // この画面のまま「まわり」: ホームの島が出る(中の物と、その中の線もそのまま)
  await page.locator(".tbtn.surround-btn").click();
  const home = page.locator(".canvas:not(.whole-canvas) .island", { hasText: "ホーム" });
  await expect(home).toHaveCount(1);
  await expect(home.locator(".node.outer", { hasText: "外の考え" })).toHaveCount(1);
  await expect(home.locator(".node.outer.t-group", { hasText: "宗教" })).toHaveCount(1);
  await expect(page.locator(".canvas:not(.whole-canvas) .node:not(.outer)", { hasText: "中の考え" })).toHaveCount(1); // 今の島はそのまま
  await expect(page.locator(".canvas:not(.whole-canvas) .outer-edge.k-link")).toHaveCount(2); // 島をまたぐ線 + ホームの島の中の線
  await expect(page.locator(".canvas:not(.whole-canvas) line.outer-edge.k-member")).toHaveCount(1); // ホームの中の「宗教」→ 今の島
  await shot("14-islands");
  // 範囲「このグループ」で島は消える
  await page.locator(".canvas:not(.whole-canvas) .scope-ctl .sc-opt", { hasText: "このグループ" }).click();
  await expect(page.locator(".canvas:not(.whole-canvas) .island")).toHaveCount(0);
  await page.locator(".canvas:not(.whole-canvas) .scope-ctl .sc-opt", { hasText: "全部" }).click();
  await expect(page.locator(".canvas:not(.whole-canvas) .island")).toHaveCount(1);
  // 全体(分割の右側): 見るだけ。右の島の物を左へドラッグで引用
  await page.locator(".tbtn.whole-btn").click();
  await expect(page.locator(".whole-canvas")).toBeVisible();
  const wouter = page.locator(".whole-canvas .node.outer", { hasText: "外の続き" });
  await expect(wouter).toHaveCount(1);
  await shot("14b-whole");
  const src = (await wouter.boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + 6);
  await page.mouse.down();
  await page.mouse.move(src.x - 40, src.y + 10, { steps: 4 });
  await page.mouse.move(200, 650, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".left-pane .node.ref", { hasText: "外の続き" })).toHaveCount(1);
  // 島をダブルクリックすると、そのグループに入って編集
  await page.locator(".whole-canvas .island", { hasText: "ホーム" }).dblclick({ position: { x: 8, y: 8 } });
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  await page.locator(".whole-close").click();
  await expect(page.locator(".whole-canvas")).toHaveCount(0);
});

test("右上の「添付」からファイルをノードとして置く", async () => {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".tbtn.attach-btn").click();
  await page.locator(".ctxmenu .mb-btn", { hasText: "ファイル" }).click();
  await (await chooser).setFiles({ name: "見本.html", mimeType: "text/html", buffer: Buffer.from("<p>hi</p>") });
  await expect(page.locator(".node.file", { hasText: "見本.html" })).toHaveCount(1);
  await settle();
  expect(readdirSync(path.join(vault, "assets")).some((f) => f.endsWith("-見本.html"))).toBe(true);
});

test("分割: 右クリックの「反対側の画面に引用する」", async () => {
  await write(300, 200, "向こうの物");
  await page.locator(".node", { hasText: "向こうの物" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("向こう");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+\\");
  await page.keyboard.type("向こう");
  await page.keyboard.press("Enter");
  await page.locator(".peek .node", { hasText: "向こうの物" }).click({ button: "right" });
  await page.locator(".ctxmenu .item", { hasText: "別のグループへ" }).click();
  await page.locator(".ctxmenu .item", { hasText: "反対側の画面に引用する" }).click();
  await expect(page.locator(".left-pane .node.ref", { hasText: "向こうの物" })).toHaveCount(1);
});

test("右クリック: 一番上に絵付きのボタン(書き直す・つなぐ・束ねる・囲む・タブで開く・消す)、その下に色、グループの操作は見出しの下", async () => {
  await write(300, 200, "ひとつ");
  await page.locator(".node", { hasText: "ひとつ" }).click({ button: "right" });
  // 2026-11-24 見本 X: 絵のボタン 1 段(書き直す・リンク・束ねる・引用で・囲む・削除)。ほかは「別のグループへ ›」「その他 ›」
  await expect(page.locator(".ctxmenu .menubar .mb-btn")).toHaveCount(6);
  const mb = (await page.locator(".ctxmenu").boundingBox())!;
  expect(mb.y + mb.height).toBeLessThanOrEqual(800); // 画面からはみ出さない
  await shot("16-menu");
  await page.locator(".ctxmenu .swatches").first().locator(".sw.c1").click();
  await expect(page.locator(".node.t-text.c1", { hasText: "ひとつ" })).toHaveCount(1);
  await expect(page.locator(".selbar")).toHaveCount(0); // 上に出るバーはやめた
});

test("ボードにも添付: 空きの右クリックの「添付 › ファイル」・画像は絵で出る", async () => {
  await page.mouse.click(400, 300, { button: "right" });
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".ctxmenu .mb-btn", { hasText: "ファイル" }).click();
  // 1x1 の PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await (await chooser).setFiles([
    { name: "絵.png", mimeType: "image/png", buffer: png },
    { name: "資料.html", mimeType: "text/html", buffer: Buffer.from("<p>x</p>") },
  ]);
  await expect(page.locator(".node.file")).toHaveCount(2);
  await expect(page.locator(".node.file img.file-img")).toHaveCount(1);
  await settle();
  const files = Object.values(mdFiles());
  expect(files.some((t) => /title: 資料\.html\n/.test(t) && /file: "?assets\/\d{8}-[0-9a-f]{6}-資料\.html/.test(t))).toBe(true);
});

test("2026-11-24: グループは 1 回クリックで中へ・引用で新しいグループ(元はそのまま)・移す", async () => {
  await write(300, 200, "りんご");
  await write(300, 300, "みかん");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+Shift+g");
  await page.keyboard.type("果物の引用");
  await page.keyboard.press("Escape");
  await settle();
  // 元の 2 つはホームにそのまま
  await expect(page.locator(".node.t-text", { hasText: "りんご" })).toHaveCount(1);
  await expect(page.locator(".node.t-text", { hasText: "みかん" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.locator(".node.t-group", { hasText: "果物の引用" }).click();
  await expect(page.locator(".group-title")).toHaveText("果物の引用");
  await expect(page.locator(".node.ref")).toHaveCount(2);
  await shot("24-quotegroup");
  await page.locator(".i-back").click();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  // 別のグループを作って、右クリックの「ほかのグループへ移す…」で検索して移す
  await page.mouse.click(700, 500, { button: "right" });
  await page.locator(".ctxmenu .item", { hasText: "グループを作る" }).click();
  await page.keyboard.type("箱");
  await page.keyboard.press("Enter");
  await settle();
  await page.locator(".node.t-group", { hasText: "果物の引用" }).click({ button: "right" });
  await page.locator(".ctxmenu .item", { hasText: "別のグループへ" }).click();
  await page.locator(".ctxmenu .item", { hasText: "ほかのグループへ移す" }).click();
  await page.keyboard.type("箱");
  await expect(page.locator(".picker-sec").first()).toHaveText("グループの名前");
  await page.keyboard.press("Enter");
  await expect(page.locator(".node.t-group", { hasText: "果物の引用" })).toHaveCount(0);
});

test("2026-11-24: 検索は グループの名前 → 中身 → ノード の順", async () => {
  await write(300, 200, "青いりんご");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+g");
  await page.keyboard.type("果物");
  await page.keyboard.press("Escape");
  await settle();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("りんご");
  await expect(page.locator(".picker-sec")).toHaveText(["中身に当たったグループ", "ノード"]);
  await expect(page.locator(".picker-row .pr-inside")).toHaveText("中: 青いりんご");
  await shot("24-search");
  await page.keyboard.press("Escape");
});

test("2026-11-24: 枠で囲む・枠から線・枠を動かすと中も動く・線の文字をダブルクリックで書く", async () => {
  await write(300, 200, "あ");
  await write(300, 280, "い");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  await expect(page.locator(".node.t-frame")).toHaveCount(1);
  await settle();
  expect(Object.values(mdFiles()).some((s) => /type: frame/.test(s) && /size: \{ w: \d+, h: \d+ \}/.test(s))).toBe(true);
  // 選んだ枠から Tab で、つながった文字
  await page.keyboard.press("Tab");
  await page.keyboard.type("枠から");
  await page.keyboard.press("Escape");
  await expect(page.locator(".node.t-text", { hasText: "枠から" })).toHaveCount(1);
  await expect(page.locator(".edge")).toHaveCount(1);
  // 線をダブルクリックして文字
  const mid = await page.evaluate(() => {
    const p = document.querySelector(".edge .vis") as SVGPathElement;
    const m = p.getPointAtLength(p.getTotalLength() / 2);
    const pt = p.getScreenCTM()!;
    return { x: pt.a * m.x + pt.c * m.y + pt.e, y: pt.b * m.x + pt.d * m.y + pt.f };
  });
  await page.mouse.dblclick(mid.x, mid.y);
  await page.keyboard.type("なぜ");
  await page.keyboard.press("Enter");
  await expect(page.locator(".edgelabel")).toHaveText("なぜ");
  await settle();
  expect(Object.values(mdFiles()).some((s) => /label: "?なぜ"?/.test(s))).toBe(true);
  // (線の文字の後で)枠を右ドラッグで動かすと、中の「あ」も動く
  const before = await page.locator(".node.t-text", { hasText: "あ" }).boundingBox();
  const fb = (await page.locator(".node.t-frame .e-t").boundingBox())!;
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(fb.x + fb.width / 2 + 60, fb.y + fb.height / 2 + 40, { steps: 5 });
  await page.mouse.up({ button: "right" });
  const after = await page.locator(".node.t-text", { hasText: "あ" }).boundingBox();
  expect(Math.round(after!.x - before!.x)).toBe(60);
  await shot("24-frame");
});

test("2026-11-24: タブ。1 枚のときは出さない・Ctrl+T・切り替え・ほかを全部閉じる・検索から Ctrl+Enter・中ボタン", async () => {
  await expect(page.locator(".tabbar")).toBeHidden();
  await expect(page.locator(".tbtn.beside")).toHaveCount(0); // 左右に分けるボタンはなくした
  await write(300, 200, "中身");
  await page.locator(".node", { hasText: "中身" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("箱A");
  await page.keyboard.press("Escape");
  await settle();
  // 検索して Ctrl+Enter で新しいタブ
  await page.keyboard.press("Control+k");
  await page.keyboard.type("箱A");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".tabbar .tab")).toHaveCount(2);
  await expect(page.locator(".tab.active")).toContainText("箱A");
  await expect(page.locator(".group-title")).toHaveText("箱A");
  // Ctrl+Tab で前のタブ(ホーム)へ
  await page.keyboard.press("Control+Tab");
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  // グループを中ボタンで: 後ろのタブに開く(今の画面はそのまま)
  await page.locator(".node.t-group", { hasText: "箱A" }).click({ button: "middle" });
  await expect(page.locator(".tabbar .tab")).toHaveCount(3);
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  // Ctrl+T で今のグループのタブ
  await page.keyboard.press("Control+t");
  await expect(page.locator(".tabbar .tab")).toHaveCount(4);
  await page.waitForTimeout(600);
  await shot("25-tabs");
  // 右クリック → ほかのタブを全部閉じる
  await page.locator(".tab.active").click({ button: "right" });
  await page.locator(".ctxmenu .item", { hasText: "ほかのタブを全部閉じる" }).click();
  await expect(page.locator(".tabbar")).toBeHidden();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  // 開き直しても覚えている
  await page.keyboard.press("Control+t");
  await page.locator(".node.t-group", { hasText: "箱A" }).click();
  await expect(page.locator(".tab.active")).toContainText("箱A");
  await page.keyboard.press("Control+w");
  await expect(page.locator(".tabbar")).toBeHidden();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
});

test("2026-11-24: 大画面のノートは本文が真ん中の幅", async () => {
  await page.mouse.click(400, 300, { button: "right" });
  await page.locator(".ctxmenu .item", { hasText: "ノート" }).first().click();
  await expect(page.locator(".popup.expanded")).toBeVisible();
  const pm = (await page.locator(".popup.expanded .ProseMirror").boundingBox())!;
  expect(pm.width).toBeLessThanOrEqual(722);
  expect(Math.abs(pm.x + pm.width / 2 - 640)).toBeLessThan(30);
  await page.keyboard.type("真ん中に書く");
  await shot("26-note-center");
});

test("2026-11-24: 引用は読むだけ。1 回クリックで選ぶだけ・ダブルクリックで引用元へ", async () => {
  await write(300, 200, "元の文");
  await page.locator(".node", { hasText: "元の文" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("元の箱");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.mouse.click(300, 500); // 空きを押して何もしない
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+l");
  await page.keyboard.type("元の文");
  await page.locator(".picker-row", { hasText: "元の文" }).last().click();
  const ref = page.locator(".node.ref", { hasText: "元の文" });
  await expect(ref).toHaveCount(1);
  await page.keyboard.press("Escape");
  await ref.click();
  await expect(page.locator("textarea.draft")).toHaveCount(0); // 書き直しにならない
  await expect(page.locator(".node.ref.selected")).toHaveCount(1);
  await ref.dblclick();
  await expect(page.locator(".group-title")).toHaveText("元の箱");
  await expect(page.locator(".node.selected", { hasText: "元の文" })).toHaveCount(1);
});

test("2026-11-24: 自分の種類を作って、並べる・直す", async () => {
  await page.locator(".tbtn.draw").click();
  await page.locator(".dm-tabs button", { hasText: "発想" }).click();
  await page.locator(".dm-add").click();
  await page.locator(".modal.custom-set input").fill("朝の問い");
  await page.locator(".modal.custom-set textarea").fill("感謝: 今日ありがたいことは?\n体: 今どう感じる?");
  await page.locator(".modal.custom-set .btn.primary").click();
  await expect(page.locator(".modal.custom-set")).toHaveCount(0);
  await page.locator(".tbtn.draw").click();
  await page.locator(".dm-tabs button", { hasText: "発想" }).click();
  await page.locator(".dm-row", { hasText: "朝の問い" }).click();
  await expect(page.locator(".node.pchip")).toHaveCount(2);
  await page.keyboard.press("Escape");
  const chip = page.locator(".node.pchip", { hasText: "感謝" });
  await chip.click();
  await expect(chip.locator(".pchip-q")).toContainText("今日ありがたいことは?");
  expect(readFileSync(path.join(vault, ".thinkdraw", "prompt-sets.json"), "utf8")).toContain("朝の問い");
  await shot("27-custom");
});

test("2026-11-24: 引用の右上の ↗ で元の場所へ・戻るボタンで戻る・ふつうのクリックは選ぶだけ", async () => {
  await write(300, 200, "元の文");
  await page.locator(".node", { hasText: "元の文" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("元の箱");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+l");
  await page.keyboard.type("元の文");
  await page.locator(".picker-row", { hasText: "元の文" }).last().click();
  const ref = page.locator(".node.ref", { hasText: "元の文" });
  await expect(ref).toHaveCount(1);
  await page.keyboard.press("Escape");
  await ref.click();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  await expect(page.locator(".node.ref.selected")).toHaveCount(1);
  await ref.locator(".jump-btn").click();
  await expect(page.locator(".group-title")).toHaveText("元の箱");
  await expect(page.locator(".return-btn")).toHaveCount(1);
  await page.locator(".return-btn").click();
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  await expect(page.locator(".node.ref.selected", { hasText: "元の文" })).toHaveCount(1);
  await expect(page.locator(".return-btn")).toHaveCount(0);
});

test("2026-11-24: 同じボードに Ctrl+C → Ctrl+V でボードの中の引用・↗ でその場所へ・Ctrl+[ で戻る", async () => {
  await write(200, 150, "ここの元");
  await write(700, 600, "遠く");
  await page.locator(".node", { hasText: "ここの元" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Escape");
  await page.locator(".node", { hasText: "遠く" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+v");
  const alias = page.locator(".node.alias", { hasText: "ここの元" });
  await expect(alias).toHaveCount(1);
  await settle();
  expect(Object.values(mdFiles()).some((s) => s.includes("type: alias") && s.includes(`target: ${idOf("ここの元")}`))).toBe(true);
  // ふつうのクリックは選ぶだけ(書き直しにならない)
  await alias.click();
  await expect(page.locator("textarea.draft")).toHaveCount(0);
  await expect(page.locator(".node.alias.selected")).toHaveCount(1);
  await alias.locator(".jump-btn").click();
  await expect(page.locator(".node.selected:not(.alias)", { hasText: "ここの元" })).toHaveCount(1);
  await expect(page.locator(".return-btn")).toHaveCount(1);
  await page.keyboard.press("Control+[");
  await expect(page.locator(".node.alias.selected")).toHaveCount(1);
  await expect(page.locator(".return-btn")).toHaveCount(0);
  await shot("28-alias");
});

test("2026-11-24: Ctrl+X で切り取って、別のグループで Ctrl+V すると移る", async () => {
  await write(300, 200, "移す物");
  await write(300, 400, "箱の中");
  await page.locator(".node", { hasText: "箱の中" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("行き先");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator(".node", { hasText: "移す物" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+x");
  await expect(page.locator(".node.cut", { hasText: "移す物" })).toHaveCount(1);
  await page.locator(".node.t-group", { hasText: "行き先" }).click();
  await expect(page.locator(".group-title")).toHaveText("行き先");
  await page.keyboard.press("Control+v");
  await expect(page.locator(".node:not(.ref)", { hasText: "移す物" })).toHaveCount(1);
  await settle();
  const files = mdFiles();
  expect(files[idOf("行き先") + ".md"]).toContain(`id: ${idOf("移す物")}`);
  expect(files["root.md"]).not.toContain(`id: ${idOf("移す物")}`);
});

test("2026-11-24: Ctrl+F でボードの中を探す・書いている文字から Ctrl+L で同じボードの物とつなぐ・線の文字は Esc でも残る", async () => {
  await write(200, 150, "りんご");
  await write(600, 500, "みかん");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("みかん");
  await expect(page.locator(".find-count")).toHaveText("1/1");
  await expect(page.locator(".node.selected", { hasText: "みかん" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".find-box")).toHaveCount(0);
  // 文字を押すと書き直しになる。そのまま Ctrl+L
  await page.locator(".node", { hasText: "りんご" }).click();
  await expect(page.locator("textarea.draft")).toHaveCount(1);
  await page.keyboard.press("Control+l");
  await page.keyboard.type("みかん");
  await page.locator(".picker-row", { hasText: "みかん" }).last().click();
  await expect(page.locator(".edge")).toHaveCount(1);
  await expect(page.locator(".node.ref")).toHaveCount(0);
  // 線の文字: Esc で決まる
  const mid = await page.evaluate(() => {
    const p = document.querySelector(".edge .vis") as SVGPathElement;
    const m = p.getPointAtLength(p.getTotalLength() / 2);
    const pt = p.getScreenCTM()!;
    return { x: pt.a * m.x + pt.c * m.y + pt.e, y: pt.b * m.x + pt.d * m.y + pt.f };
  });
  await page.mouse.dblclick(mid.x, mid.y);
  await page.keyboard.type("好き");
  await page.keyboard.press("Escape");
  await expect(page.locator(".edgelabel")).toHaveText("好き");
});

test("2026-11-24: タロットの右の欄は、78 枚の正逆どれでも、読み・絵・問いがスクロールせずに全部見える", async () => {
  const dir = path.join(__dirname, "../../src/decks/tarot/deep");
  const ids = readdirSync(dir)
    .filter((f) => /^(major|wands|cups|swords|pents)\d\.json$/.test(f))
    .flatMap((f) => Object.keys(JSON.parse(readFileSync(path.join(dir, f), "utf8"))));
  expect(ids.length).toBe(78);
  const over = await page.evaluate(async (ids) => {
    type A = { vault: { create(o: unknown): { id: string } }; canvas: { renderNow(): void; setSelection(i: string[]): void } };
    const app = (window as unknown as { __app: A }).__app;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const made: string[] = [];
    ids.forEach((id, k) => {
      for (const reversed of [false, true]) made.push(app.vault.create({ type: "card", card: { deck: "tarot", id, reversed }, group: "root", x: (k % 13) * 120, y: Math.floor(k / 13) * 400 + (reversed ? 200 : 0) }).id);
    });
    app.canvas.renderNow();
    const bad: string[] = [];
    for (const nid of made) {
      app.canvas.setSelection([nid]);
      await sleep(90);
      for (const t of ["read", "pic", "ask"]) {
        (document.querySelector(`.side-panel .d-tabs button[data-t=${t}]`) as HTMLElement).click();
        const d = document.querySelector(".side-panel .detail")!;
        const o = d.scrollHeight - d.clientHeight;
        if (o > 0) bad.push(`${document.querySelector(".side-panel .d-title")!.textContent} ${t} +${o}`);
      }
    }
    return bad;
  }, ids);
  expect(over).toEqual([]);
  await shot("29-tarot-fit");
});

test("2026-11-24: Tab で書く文字は、ほかの文字にかぶらない", async () => {
  await write(500, 300, "まんなか");
  for (const t of ["一つ目のとても長い言葉です", "二つ目のとても長い言葉です", "三つ目のとても長い言葉です", "四つ目のとても長い言葉です", "五つ目のとても長い言葉です"]) {
    await page.keyboard.press("Escape"); // 選択を外してから選び直す
    await page.locator(".node", { hasText: "まんなか" }).click({ modifiers: ["Control"] });
    await page.keyboard.press("Tab");
    await page.keyboard.type(t);
    // 書いている間もかぶらない
    const over = await page.evaluate(() => {
      const ta = document.querySelector("textarea.draft")!.getBoundingClientRect();
      return [...document.querySelectorAll(".node:not(.editing)")].some((n) => {
        const r = n.getBoundingClientRect();
        return r.left < ta.right && ta.left < r.right && r.top < ta.bottom && ta.top < r.bottom;
      });
    });
    expect(over, t).toBe(false);
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".edge")).toHaveCount(5);
  await shot("30-tab-place");
});

/** 線の真ん中(画面の座標) */
async function edgeMid(i = 0) {
  return page.evaluate((i) => {
    const p = document.querySelectorAll(".edge:not(.outer) .hit")[i] as SVGPathElement;
    const m = p.getPointAtLength(p.getTotalLength() / 2);
    const pt = p.getScreenCTM()!;
    return { x: pt.a * m.x + pt.c * m.y + pt.e, y: pt.b * m.x + pt.d * m.y + pt.f };
  }, i);
}
async function linkTo(from: string, to: string) {
  await page.keyboard.press("Escape");
  await page.locator(".node", { hasText: from }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+l");
  await page.keyboard.type(to);
  await page.locator(".picker-row", { hasText: to }).last().click();
}

test("2026-11-24 統合仕様 3〜6: 線を選ぶ・R で反転・メニュー(反転・削除→色→種類)・部分・全体の括弧・色・文字(灰色の背景・ドラッグ)・まとめて消して 1 回で戻す・交差の弧", async () => {
  await write(300, 300, "全体");
  await write(700, 300, "部分");
  await linkTo("全体", "部分");
  await expect(page.locator("g.edge")).toHaveCount(1);
  // 押すと選ぶ・R で反転
  let m = await edgeMid();
  await page.mouse.click(m.x, m.y);
  await expect(page.locator("g.edge.selected")).toHaveCount(1);
  await page.keyboard.press("r");
  await settle();
  expect(mdFiles()[idOf("部分") + ".md"]).toContain(`to: ${idOf("全体")}`);
  await page.keyboard.press("r"); // 戻す
  // 右クリック: 反転・削除 → 色 → 線の種類(見本つき 5 種類)
  m = await edgeMid();
  await page.mouse.click(m.x, m.y, { button: "right" });
  const menu = page.locator(".ctxmenu");
  await expect(menu.locator(".menubar .mb-btn")).toHaveText([/反転/, /削除/]);
  const order = await menu.evaluate((el) => [...el.children].map((c) => c.className.split(" ")[0]));
  expect(order.indexOf("menubar")).toBeLessThan(order.indexOf("swatches"));
  expect(order.indexOf("swatches")).toBeLessThan(order.indexOf("menuhead"));
  await expect(menu.locator(".item.has-preview")).toHaveCount(5);
  await expect(menu.locator(".item", { hasText: "文字" })).toHaveCount(0); // 「文字を編集」は無い
  await menu.locator(".item", { hasText: "部分・全体" }).click();
  await expect(page.locator("g.edge.k-part .end-stroke")).toHaveCount(1);
  await page.mouse.click(m.x, m.y, { button: "right" });
  await page.locator(".ctxmenu > .swatches .sw.c3").click();
  await expect(page.locator("g.edge.c3")).toHaveCount(1);
  await settle();
  expect(mdFiles()[idOf("全体") + ".md"]).toMatch(/kind: part.*color: 3/);
  // 文字: 文章と同じ大きさ・灰色の背景。Esc で決まる。ドラッグで線に沿って動く
  m = await edgeMid();
  await page.mouse.dblclick(m.x, m.y);
  await page.keyboard.type("一部");
  await page.keyboard.press("Escape");
  await expect(page.locator(".edgelabel")).toHaveText("一部");
  await expect(page.locator(".elabel-bg")).toHaveCount(1);
  expect(await page.locator(".edgelabel").evaluate((t) => getComputedStyle(t).fontSize)).toBe(await page.locator(".node.t-text").first().evaluate((t) => getComputedStyle(t).fontSize));
  const lb = (await page.locator(".elabel-bg").boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width / 2 + 100, lb.y + lb.height / 2, { steps: 5 });
  await page.mouse.up();
  await settle();
  expect(mdFiles()[idOf("全体") + ".md"]).toMatch(/at: 0\.[6-8]/);
  // 交差: 縦の線をまたぐと、横の線が弧で乗り越える
  await write(500, 150, "上");
  await write(500, 480, "下");
  await linkTo("上", "下");
  await expect(page.locator("g.edge")).toHaveCount(2);
  const ds = await page.locator("g.edge .vis").evaluateAll((ps) => ps.map((p) => p.getAttribute("d")!));
  expect(ds.filter((d) => d.includes(" A")).length).toBe(1);
  await shot("31-edges");
  // Ctrl+クリックで 2 本選んで Delete、Ctrl+Z 1 回で 2 本とも戻る
  await page.keyboard.press("Escape");
  await settle();
  const ends = await page.locator("g.edge").evaluateAll((gs) => gs.map((g) => g.getAttribute("data-from")));
  const hz = ends.indexOf(idOf("全体")), vt = ends.indexOf(idOf("上"));
  const m0 = await edgeMid(hz), m1 = await edgeMid(vt);
  await page.mouse.click(m0.x - 60, m0.y);
  await page.keyboard.down("Control");
  await page.mouse.click(m1.x, m1.y + 50);
  await page.keyboard.up("Control");
  await expect(page.locator("g.edge.selected")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(page.locator("g.edge")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator("g.edge")).toHaveCount(2);
});

test("2026-11-24 統合仕様 1・2・7: Ctrl+←/→ の履歴(ボードの中で飛んだのも)・Ctrl+C は Markdown で外にも貼れる・外でコピーしたら引用にしない・引用したグループは押すとその中", async () => {
  await write(300, 200, "箱の中身");
  await page.locator(".node", { hasText: "箱の中身" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.type("箱");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.locator(".node.t-group", { hasText: "箱" }).click();
  await expect(page.locator(".group-title")).toHaveText("箱");
  await page.keyboard.press("Control+ArrowLeft");
  await expect(page.locator(".group-title")).toHaveText("ホーム");
  await page.keyboard.press("Control+ArrowRight");
  await expect(page.locator(".group-title")).toHaveText("箱");
  await page.keyboard.press("Control+ArrowLeft");
  // Ctrl+C: システムのコピーは Markdown
  await write(300, 450, "外へ貼る文");
  await write(700, 600, "遠く");
  await page.keyboard.press("Escape");
  await page.locator(".node", { hasText: "外へ貼る文" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+c");
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe("外へ貼る文");
  // ThinkDraw の中で貼ると引用(同じボードなのでボードの中の引用)
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+v");
  await expect(page.locator(".node.alias")).toHaveCount(1);
  // 外で別の物をコピーしたら、引用にはしない
  await app.evaluate(({ clipboard }) => clipboard.writeText("よそのアプリの文"));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(300);
  await expect(page.locator(".node.alias")).toHaveCount(1);
  // ボードの中で飛んで、Ctrl+← で飛ぶ前の場所(選んでいた引用)へ
  await page.locator(".node.alias").click();
  await page.locator(".node.alias .jump-btn").click();
  await expect(page.locator(".node.selected:not(.alias)", { hasText: "外へ貼る文" })).toHaveCount(1);
  await page.keyboard.press("Control+ArrowLeft");
  await expect(page.locator(".node.alias.selected")).toHaveCount(1);
  // 引用したグループ: ↗ は無く、押すとそのグループ自身の中(親ではない)
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+l");
  await page.keyboard.type("箱");
  await page.locator(".picker-row", { hasText: "箱" }).first().click();
  await page.keyboard.press("Escape");
  await page.locator(".node.t-group", { hasText: "箱" }).first().click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+Shift+g"); // 引用で新しいグループ(箱の引用が入る)
  await page.keyboard.type("まとめ");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.locator(".node.t-group", { hasText: "まとめ" }).click();
  const q = page.locator(".node.ref.t-group", { hasText: "箱" });
  await expect(q).toHaveCount(1);
  await expect(q.locator(".jump-btn")).toHaveCount(0);
  await q.click();
  await expect(page.locator(".group-title")).toHaveText("箱");
});

test("2026-11-24 統合仕様 8〜10・15: 画像の大きさ(置いた場所ごと・名前は出さない)・ペンの帯・上の鉛筆でグループ名・起動時に最大化", async () => {
  // 起動時に最大化を呼んでいる(xvfb には窓の管理が無いので、最大化した状態そのものは実機で確かめる)
  expect(await app.evaluate(() => (globalThis as { __thinkdrawMaximizeCalled?: boolean }).__thinkdrawMaximizeCalled)).toBe(true);
  // 画像
  await page.mouse.click(400, 300, { button: "right" });
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".ctxmenu .mb-btn", { hasText: "ファイル" }).click();
  const svgImg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#c44"/></svg>');
  await (await chooser).setFiles([{ name: "赤.svg", mimeType: "image/svg+xml", buffer: svgImg }]);
  const img = page.locator(".node.image");
  await expect(img).toHaveCount(1);
  await expect(img.locator(".label")).toHaveCount(0);
  await expect.poll(() => img.locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await page.keyboard.press("Escape");
  await img.click();
  await expect(img.locator(".img-h.se")).toBeVisible();
  const b0 = (await img.boundingBox())!;
  const h = (await img.locator(".img-h.se").boundingBox())!;
  await page.mouse.move(h.x + 5, h.y + 5);
  await page.mouse.down();
  await page.mouse.move(h.x + 85, h.y + 5, { steps: 5 });
  await page.mouse.up();
  const b1 = (await img.boundingBox())!;
  expect(b1.width).toBeGreaterThan(b0.width + 60);
  expect(Math.abs(b1.height / b1.width - b0.height / b0.width)).toBeLessThan(0.05); // 比はそのまま
  await settle();
  expect(mdFiles()["root.md"]).toMatch(/w: \d+/);
  // ペンの帯: 絵のボタン・太さの見本・丸い色。細かな太さは「…」のときだけ
  await page.locator(".tbtn.i-pen").click();
  await expect(page.locator(".penbar")).toBeVisible();
  await expect(page.locator(".penbar .pb-tool svg")).toHaveCount(3);
  await expect(page.locator(".penbar .pb-size")).toHaveCount(3);
  await expect(page.locator(".penbar input[type=range]")).toHaveCount(0);
  await page.locator(".penbar .pb-more").click();
  await expect(page.locator(".penbar input[type=range]")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator(".penbar")).toBeHidden();
  // 上の鉛筆でグループ名(Esc はやめる・Enter で決める)
  await write(300, 600, "名前を変える箱");
  await page.locator(".node", { hasText: "名前を変える箱" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.locator(".node.t-group").click();
  await page.locator(".title-edit").click();
  await page.keyboard.type("やめる名前");
  await page.keyboard.press("Escape");
  await expect(page.locator(".group-title")).not.toHaveText("やめる名前");
  await page.locator(".title-edit").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("新しい名前");
  await page.keyboard.press("Enter");
  await expect(page.locator(".group-title")).toHaveText("新しい名前");
  await page.locator(".group-title").click(); // 名前を押すと上のグループ(前と同じ)
  await expect(page.locator(".ctxmenu .item", { hasText: "ホーム" })).toHaveCount(1);
});

test("2026-11-24 修正8: 括弧はノードの手前で欠けない・線は文字とラベルの所を通らない(ラベルは線より手前の層)・Shift+ドラッグで線だけ範囲選択", async () => {
  await write(250, 200, "全体のノード");
  await write(700, 520, "部分のノード");
  await linkTo("全体のノード", "部分のノード");
  await expect(page.locator("g.edge")).toHaveCount(1);
  const m = await edgeMid();
  await page.mouse.click(m.x, m.y, { button: "right" });
  await page.locator(".ctxmenu .item", { hasText: "部分・全体" }).click();
  await expect(page.locator("g.edge.k-part .end-stroke")).toHaveCount(1);
  // 括弧の四隅が、部分のノードの箱の外(余白つき)にある
  const clear = async () =>
    page.evaluate(() => {
      const br = (document.querySelector("g.edge.k-part .end-stroke") as SVGPathElement).getBoundingClientRect();
      const nodes = [...document.querySelectorAll(".node")].filter((n) => n.textContent?.includes("部分のノード"));
      const nr = nodes[0].getBoundingClientRect();
      const overlap = br.left < nr.right && nr.left < br.right && br.top < nr.bottom && nr.top < br.bottom;
      return !overlap;
    });
  expect(await clear()).toBe(true);
  // 水平・垂直・近い所でも
  for (const [dx, dy] of [[350, 0], [0, 220], [150, 70]]) {
    const n = page.locator(".node", { hasText: "部分のノード" });
    const b = (await n.boundingBox())!;
    const a = (await page.locator(".node", { hasText: "全体のノード" }).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(a.x + a.width / 2 + dx, a.y + a.height / 2 + dy, { steps: 6 });
    await page.mouse.up({ button: "right" });
    await expect(page.locator("g.edge.k-part")).toHaveCount(1);
    expect(await clear(), `${dx},${dy}`).toBe(true);
  }
  // 線は文字の所を描かない(マスク)、ラベルは線より手前の層
  await expect(page.locator("mask#edge-mask rect[fill=black]")).not.toHaveCount(0);
  const order = await page.evaluate(() => [...document.querySelector(".edges")!.children].map((c) => c.getAttribute("class") ?? c.tagName));
  expect(order.indexOf("edge-lines")).toBeLessThan(order.indexOf("edge-labels"));
  // Shift+ドラッグ: 線だけを範囲で選ぶ(両端のノードは範囲の外でも)。右クリックで色をまとめて・Delete で線だけ消す
  await write(250, 650, "左下");
  await write(800, 650, "右下");
  await linkTo("左下", "右下");
  await expect(page.locator("g.edge")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.keyboard.down("Shift");
  await page.mouse.move(480, 600);
  await page.mouse.down();
  await page.mouse.move(560, 700, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator("g.edge.selected")).toHaveCount(1);
  await expect(page.locator(".node.selected")).toHaveCount(0);
  await page.keyboard.down("Shift");
  await page.keyboard.down("Control");
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(1000, 760, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await page.keyboard.up("Shift");
  await expect(page.locator("g.edge.selected")).toHaveCount(2);
  const sel = await edgeMid(0);
  await page.mouse.click(sel.x, sel.y, { button: "right" });
  await expect(page.locator(".ctxmenu .menuhead", { hasText: "2 本の線" })).toBeVisible();
  await page.locator(".ctxmenu > .swatches .sw.c5").click();
  await expect(page.locator("g.edge.c5")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(page.locator("g.edge")).toHaveCount(0);
  await expect(page.locator(".node", { hasText: "左下" })).toHaveCount(1); // ノードは残る
  await page.keyboard.press("Control+z");
  await expect(page.locator("g.edge")).toHaveCount(2);
  await shot("32-fix8");
});

test("2026-11-24: 線は文字の枠に沿ってよける・線だけを囲むと(ふつうのドラッグでも)線を選ぶ・右クリックは見本 X", async () => {
  await write(300, 150, "上の端");
  await write(300, 560, "下の端");
  await write(300, 360, "まんなかの文字");
  await linkTo("上の端", "下の端");
  await expect(page.locator("g.edge")).toHaveCount(1);
  await page.waitForTimeout(200);
  // 線のどの点も、まんなかの文字の箱に入らない
  const inside = await page.evaluate(() => {
    const p = document.querySelector("g.edge .vis") as SVGPathElement;
    const ctm = p.getScreenCTM()!;
    const n = [...document.querySelectorAll(".node")].find((e) => e.textContent?.includes("まんなかの文字"))!.getBoundingClientRect();
    const L = p.getTotalLength();
    for (let i = 0; i <= 200; i++) {
      const m = p.getPointAtLength((L * i) / 200);
      const x = ctm.a * m.x + ctm.c * m.y + ctm.e, y = ctm.b * m.x + ctm.d * m.y + ctm.f;
      if (x > n.left && x < n.right && y > n.top && y < n.bottom) return true;
    }
    return false;
  });
  expect(inside).toBe(false);
  await shot("33-route");
  // ふつうのドラッグで線だけを囲む
  await page.keyboard.press("Escape");
  const m = await edgeMid();
  await page.mouse.move(m.x - 120, m.y - 60);
  await page.mouse.down();
  await page.mouse.move(m.x - 60, m.y - 20, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".node.selected")).toHaveCount(0);
  const b0 = await page.evaluate(() => (document.querySelector("g.edge .vis") as SVGPathElement).getBoundingClientRect().toJSON());
  await page.mouse.move(b0.x - 20, b0.y + 40);
  await page.mouse.down();
  await page.mouse.move(b0.x + b0.width + 20, b0.y + 80, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("g.edge.selected")).toHaveCount(1);
  // 右クリック(見本 X): 絵のボタン 1 段・文字/背景の色・別のグループへ ›・その他 ›
  await page.keyboard.press("Escape");
  await page.locator(".node", { hasText: "まんなかの文字" }).click({ button: "right" });
  await expect(page.locator(".ctxmenu .menubar .mb-btn")).toHaveText([/書き直す/, /リンク/, /束ねる/, /引用で/, /囲む/, /削除/]);
  await expect(page.locator(".ctxmenu > .subwrap")).toHaveCount(2);
  const mb = (await page.locator(".ctxmenu").boundingBox())!;
  expect(mb.height).toBeLessThan(260);
  await page.locator(".ctxmenu .item", { hasText: "別のグループへ" }).click();
  await expect(page.locator(".ctxmenu .submenu .item", { hasText: "ほかのグループへ移す" })).toBeVisible();
  await shot("34-menu-x");
});

test("2026-11-24: @ を打つと候補(これまでのしるし・記録の種類)・@ はしるしの見た目・Ctrl+J でしるしごとの記録", async () => {
  await page.keyboard.press("Control+d");
  await write(300, 200, "プラトンを読んだ @読書");
  await expect(page.locator(".node .tag", { hasText: "@読書" })).toHaveCount(1);
  // @ を打つと、これまでのしるしが候補に出る。Enter で入る
  await page.mouse.click(300, 400);
  await page.keyboard.type("アリストテレス @");
  await expect(page.locator(".tag-pop .tag-opt", { hasText: "@読書" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("textarea.draft")).toHaveValue("アリストテレス @読書 ");
  await page.keyboard.press("Escape");
  await expect(page.locator(".node .tag", { hasText: "@読書" })).toHaveCount(2);
  // 打ちかけで絞る・Esc は候補だけ閉じる
  await page.mouse.click(300, 550);
  await page.keyboard.type("空を飛ぶ @読");
  await expect(page.locator(".tag-pop .tag-opt")).toHaveText(["@読書"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".tag-pop")).toHaveCount(0);
  await expect(page.locator("textarea.draft")).toHaveCount(1);
  await page.keyboard.press("Escape");
  // Ctrl+J: 左に @読書(2 件)。押すと @読書 の記録の一覧。その日のチップにも出る
  await page.keyboard.press("Control+j");
  await expect(page.locator(".rec-chip.written[data-marker='読書']")).toHaveCount(1);
  const row = page.locator(".rec-mk[data-marker='読書']");
  await expect(row).toContainText("2");
  await row.click();
  await expect(page.locator(".rec-sw.on")).toHaveText("@読書 の記録");
  await expect(page.locator(".rec-taglist .rec-item")).toHaveCount(2);
  await shot("35-taglist");
  await page.locator(".rec-taglist .rec-item", { hasText: "アリストテレス" }).click();
  await expect(page.locator(".records")).toHaveCount(0);
  await expect(page.locator(".node.selected", { hasText: "アリストテレス" })).toHaveCount(1);
});

test("2026-11-24: グループをよける線は、上・横・下で同じくらい離れる", async () => {
  await write(300, 120, "上の端A");
  await write(320, 560, "下の端A");
  await write(300, 340, "まんなかの箱");
  await page.locator(".node", { hasText: "まんなかの箱" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await linkTo("上の端A", "下の端A");
  await expect(page.locator("g.edge")).toHaveCount(1);
  await page.waitForTimeout(200);
  const gaps = await page.evaluate(() => {
    const p = document.querySelector("g.edge .vis") as SVGPathElement;
    const ctm = p.getScreenCTM()!;
    const n = document.querySelector(".node.t-group")!;
    const r = n.getBoundingClientRect();
    const bottom = r.bottom + 3; // 下に重ねた影
    let top = Infinity, side = Infinity, bot = Infinity;
    const L = p.getTotalLength();
    for (let i = 0; i <= 400; i++) {
      const m = p.getPointAtLength((L * i) / 400);
      const x = ctm.a * m.x + ctm.c * m.y + ctm.e, y = ctm.b * m.x + ctm.d * m.y + ctm.f;
      if (x > r.left && x < r.right && y < r.top) top = Math.min(top, r.top - y);
      if (x > r.left && x < r.right && y > bottom) bot = Math.min(bot, y - bottom);
      if (y > r.top && y < bottom) side = Math.min(side, x < r.left ? r.left - x : x - r.right);
    }
    return { top, side, bot };
  });
  const used = [gaps.top, gaps.side, gaps.bot].filter((g) => isFinite(g));
  expect(used.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...used) - Math.min(...used)).toBeLessThanOrEqual(2);
  // 箱につながる線と、箱を回る線: 回る線はつながる線の端より外を通り、またぐ所は弧で乗り越える(つながって見えない)
  await write(60, 345, "横から");
  const grp = (await page.locator(".node.t-group").boundingBox())!;
  await page.locator(".node", { hasText: "横から" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+l");
  await page.keyboard.type("まんなかの箱");
  await page.locator(".picker-row", { hasText: "まんなかの箱" }).first().click();
  await expect(page.locator("g.edge")).toHaveCount(2);
  await page.waitForTimeout(200);
  // 回る線は、つながる線の無い側(右)を通る
  const xs = await page.evaluate(() => {
    const ps = [...document.querySelectorAll("g.edge .vis")] as SVGPathElement[];
    const p = ps.find((q) => (q.getAttribute("d") ?? "").includes("Q"))!;
    const ctm = p.getScreenCTM()!;
    const out: number[] = [];
    const L = p.getTotalLength();
    for (let i = 0; i <= 100; i++) {
      const m = p.getPointAtLength((L * i) / 100);
      out.push(ctm.a * m.x + ctm.c * m.y + ctm.e);
    }
    return out;
  });
  expect(Math.max(...xs)).toBeGreaterThan(grp.x + grp.width);
  expect(Math.min(...xs)).toBeGreaterThan(grp.x - 2);
  await shot("36-around");
});

test("2026-11-24: 線の右クリックの「線の設定…」で、種類ごとのいつもの色を決める(色を付けていない線はその色・付けた線はそのまま)", async () => {
  await write(250, 200, "甲");
  await write(650, 200, "乙");
  await write(250, 500, "丙");
  await write(650, 500, "丁");
  await linkTo("甲", "乙");
  await linkTo("丙", "丁");
  await expect(page.locator("g.edge")).toHaveCount(2);
  // 下の線にだけ色を付ける
  const ends = await page.locator("g.edge").evaluateAll((gs) => gs.map((g) => g.getAttribute("data-from")));
  await settle();
  const lower = ends.indexOf(idOf("丙"));
  let m = await edgeMid(lower);
  await page.mouse.click(m.x, m.y, { button: "right" });
  await page.locator(".ctxmenu > .swatches .sw.c2").click();
  // 上の線の右クリック → 「通常の線」のいつもの色 › 色 5
  const upper = 1 - lower;
  m = await edgeMid(upper);
  await page.mouse.click(m.x, m.y, { button: "right" });
  await page.locator(".ctxmenu .item", { hasText: "線の設定" }).click();
  // 種類ごとに 1 行(見本の線・名前・色)
  await expect(page.locator(".modal.line-settings .ls-row")).toHaveCount(5);
  await page.locator(".modal.line-settings .ls-row[data-kind='line'] .sw.c5").click();
  await expect(page.locator(".modal.line-settings .ls-row[data-kind='line'] .sw.c5.active")).toHaveCount(1);
  await shot("37-line-settings");
  await page.keyboard.press("Escape");
  await expect(page.locator(`g.edge[data-from='${idOf("甲")}'].c5`)).toHaveCount(1);
  await expect(page.locator(`g.edge[data-from='${idOf("丙")}'].c2`)).toHaveCount(1);
  // 新しく引いた線も、いつもの色
  await write(450, 650, "戊");
  await linkTo("丁", "戊");
  await expect(page.locator(`g.edge[data-from='${idOf("丁")}'].c5`)).toHaveCount(1);
  // 線のファイルには色を書かない(いつもの色はアプリの設定)
  await settle();
  expect(mdFiles()[idOf("甲") + ".md"]).not.toContain("color:");
});

test("2026-11-25 修正9: 線を選んで数字キーでその種類に", async () => {
  await write(250, 200, "甲");
  await write(650, 200, "乙");
  await linkTo("甲", "乙");
  await expect(page.locator("g.edge")).toHaveCount(1);
  await settle();
  const m = await edgeMid(0);
  await page.mouse.click(m.x, m.y);
  await page.keyboard.press("3"); // 両矢印
  await settle();
  expect(mdFiles()[idOf("甲") + ".md"]).toContain("kind: double");
  await page.keyboard.press("5"); // 部分・全体
  await settle();
  expect(mdFiles()[idOf("甲") + ".md"]).toContain("kind: part");
  await page.keyboard.press("2");
  await settle();
  expect(mdFiles()[idOf("甲") + ".md"]).toContain("kind: arrow");
});

test("2026-11-25 修正9: Ctrl+J は、その日のボードが無くても作って開ける・まだ済んでいないチェックが出る(済んだものは出ない)", async () => {
  await page.keyboard.press("Control+j");
  await expect(page.locator(".records")).toBeVisible();
  // 遠い日を選ぶ → ボードは無い
  await page.locator(".rec-cell[data-date$='-15']").click();
  await expect(page.locator(".rec-open-day")).toBeEnabled();
  await expect(page.locator(".rec-open-day")).toContainText("作って");
  await page.locator(".rec-open-day").click();
  await expect(page.locator(".records")).toHaveCount(0);
  // その日のボードにチェックリストを置く
  await page.locator(".tbtn.attach-btn").click();
  await page.locator(".ctxmenu .mb-btn", { hasText: "チェック" }).click();
  await page.keyboard.type("牛乳");
  await page.keyboard.press("Enter");
  await page.keyboard.type("パン");
  await page.locator(".ProseMirror li.task .task-box").first().click(); // 牛乳は済み
  await page.keyboard.press("Escape");
  await page.locator(".popup").waitFor({ state: "detached" }).catch(() => {});
  await settle();
  await page.keyboard.press("Control+j");
  await page.locator(".rec-cell[data-date$='-15']").click();
  await expect(page.locator(".rec-task")).toHaveCount(1);
  await expect(page.locator(".rec-task")).toContainText("パン");
  await expect(page.locator(".rec-tasks")).not.toContainText("牛乳");
  await shot("38-records-tasks");
  // ここで済みにすると消える
  await page.locator(".rec-task .rec-task-box").click();
  await expect(page.locator(".rec-task")).toHaveCount(0);
});

test("2026-11-25 修正9: 形を右クリックで、空のカードを並べる → 押して S1・WP・愚者 などを入れる", async () => {
  await page.locator(".tbtn.draw").click();
  await page.locator(".drawmenu .dm-tabs button", { hasText: "タロット" }).click();
  await page.locator(".dm-tile", { hasText: "過去・現在・未来" }).first().click({ button: "right" });
  await expect(page.locator(".node.t-card")).toHaveCount(3);
  await expect(page.locator(".face.cardblank")).toHaveCount(3);
  await shot("39-blank-cards");
  // 空のカードを押すと入力画面
  await page.locator(".node.t-card").nth(0).click();
  await page.locator(".modal.manual .manual-card").fill("WP");
  await page.keyboard.press("Enter");
  await expect(page.locator(".face.cardblank")).toHaveCount(2);
  await page.locator(".face.cardblank").first().click();
  await page.locator(".modal.manual .manual-card").fill("s1");
  await page.keyboard.press("Shift+Enter"); // 逆位置
  await page.locator(".face.cardblank").first().click();
  await page.locator(".modal.manual .manual-card").fill("デビル");
  await page.keyboard.press("Enter");
  await expect(page.locator(".face.cardblank")).toHaveCount(0);
  await settle();
  const cards = Object.values(mdFiles()).filter((t) => t.includes("type: card"));
  expect(cards.length).toBe(3);
  for (const id of ["w11", "s1", "m15"]) expect(cards.some((t) => t.includes(`id: ${id}`))).toBe(true);
  expect(cards.filter((t) => t.includes("reversed: true")).length).toBe(1);
  // 入れたあとも、右クリックで入れ替えられる
  await page.locator(".node.t-card").first().click({ button: "right" });
  await expect(page.locator(".ctxmenu .item", { hasText: "紙で出たカードにする" })).toBeVisible();
});
