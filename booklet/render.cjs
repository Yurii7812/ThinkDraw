// electron booklet/render.cjs read:<版> | print:<版>:<巻> → assets/booklet/ に PDF を書く(1 回の起動で 1 つ。2 つ目の読み込みが失敗するため)
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");
app.disableHardwareAcceleration();
const out = path.resolve(__dirname, "out");
const dest = path.resolve(__dirname, "../assets/booklet");
async function pdf(html, name, w, h) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(out, html));
  await new Promise((r) => setTimeout(r, 1500));
  const buf = await win.webContents.printToPDF({ pageSize: { width: w / 25.4, height: h / 25.4 }, printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true });
  writeFileSync(path.join(dest, name), buf);
  win.destroy();
}
app.whenReady().then(async () => {
  const [kind, ed, n] = process.argv[process.argv.length - 1].split(":");
  if (kind === "print") await pdf(`print-${ed}-${n}.html`, `tarot-${ed}-print-${n}.pdf`, 210, 297);
  else await pdf(`book-${ed}.html`, `tarot-${ed}-A6.pdf`, 105, 148);
  app.quit();
});
