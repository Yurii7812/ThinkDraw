// electron booklet/fit.cjs → 各論のページがはみ出していないか測り、layout.json(normal → tight → split)を更新する。変えたら exit 3
const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
app.disableHardwareAcceleration();
const out = path.resolve(__dirname, "out");
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(out, "book.html"));
  await new Promise((r) => setTimeout(r, 1500));
  const over = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll(".page.card1")].filter((p) => p.scrollHeight > p.clientHeight + 1).map((p) => [p.dataset.id, (p.classList.contains("splita") || p.classList.contains("splitb")) ? "split" : p.classList.contains("tight") ? "tight" : "normal"])`,
  );
  const f = path.resolve(__dirname, "layout.json");
  let layout = {};
  try { layout = JSON.parse(readFileSync(f, "utf8")); } catch {}
  let changed = 0;
  const bad = [];
  for (const [id, mode] of over) {
    const base = id.replace(/[bc]$/, "");
    if (mode === "normal") { layout[base] = "tight"; changed++; }
    else if (mode === "tight") { layout[base] = "split"; changed++; }
    else if (mode === "split" && layout[base] !== "split3") { layout[base] = "split3"; changed++; }
    else bad.push(id);
  }
  writeFileSync(f, JSON.stringify(layout, null, 1));
  console.log(`はみ出し ${over.length} 件(変更 ${changed}・split でも収まらない ${bad.length}: ${bad.join(",")})`);
  app.exit(changed ? 3 : 0);
});
