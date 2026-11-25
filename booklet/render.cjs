// electron booklet/render.cjs → out/ に PDF を書く(読む用・印刷用)
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");
app.disableHardwareAcceleration();
const out = path.resolve(__dirname, "out");
async function pdf(html, name, w, h) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(out, html));
  await new Promise((r) => setTimeout(r, 1500));
  const buf = await win.webContents.printToPDF({ pageSize: { width: w / 25.4, height: h / 25.4 }, printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true });
  writeFileSync(path.join(out, name), buf);
  win.destroy();
}
app.whenReady().then(async () => {
  const which = process.argv[process.argv.length - 1];
  if (which === "print") await pdf("print.html", "tarot-booklet-print-A4.pdf", 210, 297);
  else await pdf("book.html", "tarot-booklet-read-A6.pdf", 105, 148);
  app.quit();
});
