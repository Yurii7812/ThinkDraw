// 画面の試験: 本物の Electron を起動する。vault と設定は一時ディレクトリ(利用者のフォルダには触らない)
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { flattenOutline, parseOutlineGraph } from "../../src/core/outline";

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


// ---------- 2026-11-27 修正15 ----------
async function newNote(x: number, y: number, title: string) {
  await page.mouse.click(x, y, { button: "right" });
  await page.getByText("ノートを作る").click();
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
}

test("修正15: Esc ではノートを閉じない・Ctrl+← でボードへ(タブは残る)・空行が残る・題は本文の列に大きく", async () => {
  await newNote(400, 300, "日記");
  await expect(page.locator(".popup.expanded .pop-body .inline-title")).toHaveValue("日記");
  await page.keyboard.type("a");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("b");
  await page.keyboard.press("Escape");
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await settle();
  const note = () => Object.values(mdFiles()).find((s) => s.includes("title: 日記\n"))!;
  expect(note()).toContain("a\n\n\n\nb");
  await page.keyboard.press("Control+ArrowLeft");
  await expect(page.locator(".popup.expanded")).toHaveCount(0);
  await expect(page.locator(".tabbar .tab")).toHaveCount(2);
  await shot("15-board-after-back");
  // 開き直しても空行はそのまま
  await page.locator(".tabbar .tab.note-tab").click();
  await expect(page.locator(".popup.expanded .ProseMirror > p")).toHaveCount(4);
  await shot("15-note");
});

test("修正15: 右クリックのファイル・チェック・表に絵がある。チェックは開かず、最後の項目は消えない(kind: check)", async () => {
  await page.mouse.click(400, 300, { button: "right" });
  for (const t of ["ファイル", "チェックリスト", "表("]) {
    const b = page.locator(`.ctxmenu .menubar button[title^="${t}"]`);
    await expect(b).toHaveCount(1);
    expect(await b.locator("svg path, svg rect").count()).toBeGreaterThan(0);
  }
  await page.locator('.ctxmenu .menubar button[title^="チェックリスト"]').click();
  await expect(page.locator(".popup.expanded")).toHaveCount(0);
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".node .task-box:visible")).toHaveCount(1);
  await page.mouse.click(900, 600);
  await settle();
  const f = Object.values(mdFiles()).find((s) => s.includes("type: note"))!;
  expect(f).toContain("kind: check");
  expect(f).toContain("[ ]");
  await expect(page.locator(".popup.expanded")).toHaveCount(0);
});

test("修正15: Ctrl+T は右端に開く・タブの上でホイール", async () => {
  await page.keyboard.press("Control+t");
  await page.keyboard.press("Control+t");
  await expect(page.locator(".tabbar .tab")).toHaveCount(3);
  await page.locator(".tabbar .tab").first().click();
  await page.keyboard.press("Control+t");
  await expect(page.locator(".tabbar .tab")).toHaveCount(4);
  await expect(page.locator(".tabbar .tab").nth(3)).toHaveClass(/active/);
  await page.locator(".tabbar .tab").first().click();
  await page.locator(".tabbar .tab").first().hover();
  await page.mouse.wheel(0, 100);
  await expect(page.locator(".tabbar .tab").nth(1)).toHaveClass(/active/);
  await page.mouse.wheel(0, -100);
  await expect(page.locator(".tabbar .tab").nth(0)).toHaveClass(/active/);
});

test("修正15: Alt+A でつながりを全部選ぶ・Shift+Alt+A は線を引いた向きの先だけ", async () => {
  await page.mouse.click(300, 300);
  await page.keyboard.type("親");
  await page.keyboard.press("Tab");
  await page.keyboard.type("子");
  await page.keyboard.press("Tab");
  await page.keyboard.type("孫");
  await page.keyboard.press("Escape");
  await write(900, 650, "離れ");
  await settle();
  await page.locator(".node", { hasText: "孫" }).click({ modifiers: ["Control"] });
  await page.keyboard.press("Alt+a");
  await expect(page.locator(".node.selected")).toHaveCount(3);
  await expect(page.locator(".node.selected", { hasText: "離れ" })).toHaveCount(0);
  // Shift+Alt+A: 子から先(孫)だけ
  await page.keyboard.press("Escape");
  await page.locator(".node", { hasText: "子" }).first().click({ modifiers: ["Control"] });
  await page.keyboard.press("Shift+Alt+A");
  await expect(page.locator(".node.selected")).toHaveCount(2);
  await expect(page.locator(".node.selected", { hasText: "親" })).toHaveCount(0);
});

test("修正15: 文を選んで Ctrl+Q でリンク・ノートのバックリンク(引用された所を押すと光る、Esc で消える)", async () => {
  await newNote(300, 300, "元");
  await page.keyboard.type("大事な一文です");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+ArrowLeft");
  await newNote(600, 300, "先");
  await page.keyboard.type("あれ");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+q");
  await settle();
  await settle();
  const src = idOf("元");
  const dst = Object.values(mdFiles()).find((s) => s.includes("title: 先\n"))!;
  if (!dst) console.log(JSON.stringify(mdFiles(), null, 1));
  expect(dst).toMatch(new RegExp(`\\[あれ\\]\\(${src}\\.md#q-[a-z0-9]{8}\\)`));
  // 元のノートを開いて、バックリンク
  await page.locator(".tabbar .tab", { hasText: "元" }).click();
  await page.locator(".tbtn.backlinks-btn").click();
  await expect(page.locator(".bl-passage")).toHaveCount(1);
  await expect(page.locator(".bl-node:not(.bl-passage) .bl-l", { hasText: /^先$/ })).toHaveCount(1);
  await expect(page.locator(".bl-node:not(.bl-passage) .bl-l", { hasText: /^ホーム$/ })).toHaveCount(1); // 所属先
  await shot("15-note-backlinks");
  await page.locator(".bl-passage").click();
  await expect(page.locator(".ProseMirror .flash")).toHaveCount(1);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ProseMirror .flash")).toHaveCount(0);
  await expect(page.locator(".popup.expanded")).toBeVisible();
  await page.locator(".tbtn.backlinks-btn").click();
  await expect(page.locator(".bl-layer")).toHaveCount(0);
});

test("修正15: ボードのバックリンク: ほかのボードのノートの本文からのリンクを、この画面のまま周りに出す", async () => {
  await write(300, 300, "的");
  // グループを作って、その中のノートから「的」へリンク
  await page.mouse.click(700, 300, { button: "right" });
  await page.getByText("ここにグループを作る").click();
  await page.keyboard.type("箱");
  await page.keyboard.press("Enter");
  await settle();
  await page.locator(".node.t-group", { hasText: "箱" }).click();
  await newNote(400, 300, "参照");
  await page.keyboard.press("Control+l");
  await page.keyboard.type("的");
  await page.keyboard.press("Enter");
  await settle();
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+Home");
  await expect(page.locator(".node", { hasText: "的" })).toHaveCount(1);
  await page.locator(".tbtn.backlinks-btn").click();
  await expect(page.locator(".island")).toHaveCount(1);
  await expect(page.locator(".island .node.outer", { hasText: "参照" })).toHaveCount(1);
  await expect(page.locator(".edges .outer-edge.k-body")).toHaveCount(1);
  await expect(page.locator(".scope-ctl")).toHaveCount(0);
  await shot("15-board-backlinks");
});

test("修正15(2): 書き出しは画面を写した絵(画面と同じ)。選んだ物だけも", async () => {
  await write(300, 200, "書き出す文字");
  await write(500, 400, "もう一つ");
  await page.locator(".tbtn.export").click();
  await page.getByText("画像(.png)").click();
  await expect.poll(() => readdirSync(exportDir)).toEqual(["ホーム.png"]);
  const png = readFileSync(path.join(exportDir, "ホーム.png"));
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  const w = png.readUInt32BE(16), hh = png.readUInt32BE(20);
  expect(w).toBeGreaterThan(400); // 2 倍の画質で、文字 2 つと余白が入る大きさ
  expect(hh).toBeGreaterThan(300);
  if (shots) writeFileSync(path.join(shots, "15-export.png"), png);
  // 写したあとは、画面は元のまま
  await expect(page.locator(".node", { hasText: "書き出す文字" })).toBeVisible();
});

test("修正15(2): 文字を書いて画面の外へ伸びても、そのあと範囲選択の位置がずれない", async () => {
  await page.mouse.click(1150, 300);
  await page.keyboard.type("とても長い文字をここに書いて画面の右の外まで伸ばしてみるとどうなるかを確かめるための文章です");
  await page.keyboard.press("Escape");
  // スクロールしても、すぐ画面の移動に置き換わる(scroll のできごとは少し遅れて来る)
  await expect.poll(() => page.locator(".canvas").first().evaluate((e) => e.scrollLeft)).toBe(0);
  // 何もない所で範囲選択: 箱がマウスの所に出る
  await page.mouse.move(200, 500);
  await page.mouse.down();
  await page.mouse.move(400, 650, { steps: 5 });
  const box = await page.locator(".rubber").boundingBox();
  await page.mouse.up();
  expect(Math.abs(box!.x - 200)).toBeLessThan(4);
});

test("修正15(2): コピーした字下げの文章を Ctrl+Q でマインドマップに・URL の文字は 1 回クリックで開く(書き直さない)", async () => {
  await page.evaluate(() => navigator.clipboard.writeText("a\n aa\n   aaa\n b\n\tc"));
  await page.mouse.move(400, 300);
  await page.locator(".canvas").first().click({ position: { x: 400, y: 300 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+q");
  await expect(page.locator(".node.t-text")).toHaveCount(5);
  await expect(page.locator(".edges .edge")).toHaveCount(4);
  await settle();
  const a = Object.values(mdFiles()).find((s) => /title: a\n/.test(s))!;
  expect(a).toMatch(/links:/);
  await shot("15-outline");
  // URL の文字
  await write(300, 650, "https://example.com/");
  const link = page.locator(".node a.node-url", { hasText: "https://example.com/" });
  await expect(link).toHaveAttribute("href", "https://example.com/");
  await link.click();
  await expect(page.locator("textarea.draft")).toHaveCount(0);
  await expect.poll(() => app.evaluate(() => (globalThis as { __bresutoOpened?: string[] }).__bresutoOpened ?? [])).toContain("https://example.com/");
});

test("修正15(3): 線はまっすぐ・選ぶと線が太く色付きでつながる文字に下線・Alt+D で線と重なる文字だけどかす・番号 (n) で網を貼る(線の言葉は子の行の頭のかっこ)", async () => {
  // 親と子をつなぎ、その線の上に別の文字を置く
  await page.evaluate(() => {
    const a = (window as any).__app;
    const v = a.vault, g = a.canvas.group;
    const p = v.create({ type: "text", title: "左の親", group: g, x: 200, y: 300 });
    const c = v.create({ type: "text", title: "右の子", group: g, x: 700, y: 300 });
    v.create({ type: "text", title: "じゃま", group: g, x: 430, y: 296 });
    v.create({ type: "text", title: "離れた物", group: g, x: 430, y: 600 });
    v.addLink(p.id, c.id);
    a.canvas.renderNow();
  });
  // まっすぐ(折れ線ではない)
  const d = await page.locator(".edge-lines .edge .vis").first().getAttribute("d");
  expect(d).toBeTruthy();
  expect(d!.match(/[LQA]/g)!.length).toBe(1);
  // ホバーだけでも強調し、離れると選択や強調が残らない。
  const parent = page.locator(".node", { hasText: "左の親" });
  await parent.hover();
  await expect(parent).toHaveClass(/hl-hover/);
  await expect(parent).not.toHaveClass(/selected/);
  await expect(page.locator(".edge-hot .h-vis")).toHaveCount(1);
  await page.mouse.move(12, 70);
  await expect(page.locator(".edge-hot .h-vis")).toHaveCount(0);
  // 選ぶと強調
  await parent.click({ modifiers: ["Control"] });
  await expect(page.locator(".edge.hl")).toHaveCount(1);
  await expect(page.locator(".edge-hot .h-vis")).toHaveCount(1); // 手前に描く写し
  await expect(page.locator(".node.hl-near", { hasText: "右の子" })).toHaveCount(1);
  await expect(page.locator(".node.hl-near", { hasText: "離れた物" })).toHaveCount(0);
  // 見え方(2026-11-28 利用者が選んだ): 子は点線の枠、線は青いだけで太さはそのまま
  expect(await page.locator(".node.hl-near", { hasText: "右の子" }).evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("dashed");
  expect(await page.locator(".edge-hot .h-vis").evaluate((e) => getComputedStyle(e).strokeWidth)).toBe("1.5px");
  await shot("15-emphasis");
  await page.keyboard.press("Escape");
  await expect(parent).not.toHaveClass(/selected/);
  await page.mouse.move(12, 70);
  await expect(page.locator(".edge.hl")).toHaveCount(0);
  // Alt+D: じゃまだけが動く
  const before = await page.evaluate(() => {
    const a = (window as any).__app;
    const pos = (t: string) => a.vault.itemPos(a.canvas.group, [...a.vault.nodes.values()].find((n: any) => n.title === t).id);
    return { j: pos("じゃま"), f: pos("離れた物"), p: pos("左の親") };
  });
  await page.keyboard.press("Alt+d");
  await settle();
  const after = await page.evaluate(() => {
    const a = (window as any).__app;
    const pos = (t: string) => a.vault.itemPos(a.canvas.group, [...a.vault.nodes.values()].find((n: any) => n.title === t).id);
    return { j: pos("じゃま"), f: pos("離れた物"), p: pos("左の親") };
  });
  expect(after.j).not.toEqual(before.j);
  expect(after.f).toEqual(before.f);
  expect(after.p).toEqual(before.p);
  expect(Math.hypot(after.j.x - before.j.x, after.j.y - before.j.y)).toBeLessThan(80); // 少しだけ
  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => {
    const a = (window as any).__app;
    return a.vault.itemPos(a.canvas.group, [...a.vault.nodes.values()].find((n: any) => n.title === "じゃま").id);
  })).toEqual(before.j);
  // 番号で網: (1) を 2 か所から
  await page.evaluate(() => navigator.clipboard.writeText("気候変動 (1)\n  海面上昇\n農業\n  (1)\n農業\n  (打撃)収入"));
  await page.mouse.move(400, 150);
  await page.keyboard.press("Control+q");
  await expect(page.locator(".node", { hasText: "気候変動" })).toHaveCount(1);
  await expect(page.locator(".node", { hasText: /^農業$/ })).toHaveCount(2); // 別々に書いた「農業」は別の物
  await expect(page.locator(".elabel", { hasText: "打撃" })).toHaveCount(1);
  await shot("15-network");
});

test("修正15(4): JSON Canvas・網の箇条書き・OPML に書き出せる。.canvas を落とすと同じ形で置ける", async () => {
  await page.evaluate(() => navigator.clipboard.writeText("親\n  子1\n  (理由)子2 (1)\n別\n  (1)"));
  await page.mouse.move(400, 300);
  await page.keyboard.press("Control+q");
  await expect(page.locator(".node.t-text")).toHaveCount(4);
  await page.keyboard.press("Escape");
  for (const label of ["JSON Canvas(.canvas)", "網の箇条書き(.md)", "OPML(.opml)"]) {
    await page.locator(".tbtn.export").click();
    await page.locator(".ctxmenu .item", { hasText: label }).first().click();
  }
  await expect.poll(() => readdirSync(exportDir).sort()).toEqual(["ホーム.canvas", "ホーム.md", "ホーム.opml"]);
  const outline = readFileSync(path.join(exportDir, "ホーム.md"), "utf8");
  const linked = parseOutlineGraph(outline);
  const flat = flattenOutline(linked.roots);
  const connections = [
    ...flat.filter(({ parent }) => parent >= 0).map(({ parent, node }) => [flat[parent].node.title, node.title, node.label ?? ""]),
    ...linked.links.map(({ from, to, label }) => [from.title, to.title, label ?? ""]),
  ];
  expect(connections).toHaveLength(3);
  expect(connections).toEqual(expect.arrayContaining([["親", "子1", ""], ["親", "子2", "理由"], ["別", "子2", ""]]));
  const cv = JSON.parse(readFileSync(path.join(exportDir, "ホーム.canvas"), "utf8"));
  expect(cv.nodes).toHaveLength(4);
  expect(cv.edges).toHaveLength(3);
  // .canvas を落とす: 4 つ増える
  const text = readFileSync(path.join(exportDir, "ホーム.canvas"), "utf8");
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.items.add(new File([t], "共有.canvas", { type: "application/json" }));
    const el = document.querySelector(".canvas")!;
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: 300, clientY: 600, bubbles: true, cancelable: true }));
  }, text);
  await expect(page.locator(".node.t-text")).toHaveCount(8);
  await expect(page.locator(".elabel", { hasText: "理由" })).toHaveCount(2);
});

test("修正17: グループ内を広げ、外側は周囲のノードの手前で止まる", async () => {
  const before = await page.evaluate(() => {
    const a = (window as any).__app;
    const v = a.vault, root = a.canvas.group;
    const group = v.create({ type: "group", title: "グループ", group: root, x: 180, y: 200 });
    const other = v.create({ type: "text", title: "別の文字", group: root, x: 440, y: 200 });
    const obstacle = v.create({ type: "text", title: "障害物", group: root, x: 506, y: 200 });
    const L = v.create({ type: "text", title: "左", group: group.id, x: 0, y: 0 });
    const R = v.create({ type: "text", title: "右", group: group.id, x: 200, y: 0 });
    a.canvas.renderNow();
    const r = a.canvas.rectOf(other.id);
    v.move(root, [{ id: obstacle.id, x: r.x + r.w + 8, y: r.y }]);
    a.canvas.renderNow();
    const get = (g: string, id: string) => v.itemPos(g, id).x;
    a.canvas.setSelection([group.id, other.id]);
    a.canvas.el.focus();
    return { root, group: group.id, other: other.id, obstacle: obstacle.id, children: [L.id, R.id], outer: [get(root, group.id), get(root, other.id), get(root, obstacle.id)] };
  });
  await page.keyboard.press("Alt+ArrowUp");
  const after = await page.evaluate(({ root, group, other, obstacle, children }) => {
    const a = (window as any).__app;
    const v = a.vault;
    const get = (g: string, id: string) => v.itemPos(g, id).x;
    return {
      outer: [get(root, group), get(root, other), get(root, obstacle)],
      inner: children.map((id: string) => get(group, id)),
      right: a.canvas.rectOf(other).x + a.canvas.rectOf(other).w,
    };
  }, before);
  expect(after.outer[0]).toBeLessThan(before.outer[0]);
  expect(after.outer[1]).toBeGreaterThan(before.outer[1]);
  expect(after.outer[2]).toBe(before.outer[2]);
  expect(after.right).toBeLessThanOrEqual(after.outer[2]);
  expect(after.inner[1] - after.inner[0]).toBeGreaterThan(200);
  await page.keyboard.press("Control+z");
  expect(await page.evaluate(({ root, group, other }) => {
    const v = (window as any).__app.vault;
    return [v.itemPos(root, group).x, v.itemPos(root, other).x];
  }, before)).toEqual(before.outer.slice(0, 2));
});

test("修正17: 設定から英語を選ぶと再起動後の画面に反映する", async () => {
  await page.keyboard.press("Control+/");
  await expect(page.locator(".modal.settings")).toBeVisible();
  await page.getByLabel("言語 / Language").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".share-btn")).toHaveAttribute("data-label", "Share");
  await page.keyboard.press("Control+/");
  await expect(page.locator(".modal.settings .modal-title").first()).toHaveText("Settings");
});
