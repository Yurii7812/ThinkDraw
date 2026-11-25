// electron booklet/render.cjs [read|print] → assets/booklet/ に PDF を書く(読む用 1 冊・印刷用 巻ごと)
const { app, BrowserWindow } = require("electron");
const { writeFileSync, readFileSync } = require("node:fs");
const path = require("node:path");
app.disableHardwareAcceleration();
const out = path.resolve(__dirname, "out");
const dest = path.resolve(__dirname, "../assets/booklet"); // アプリに同梱する PDF
async function pdf(html, name, w, h) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(out, html));
  await new Promise((r) => setTimeout(r, 1500));
  const buf = await win.webContents.printToPDF({ pageSize: { width: w / 25.4, height: h / 25.4 }, printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true });
  writeFileSync(path.join(dest, name), buf);
  win.destroy();
}
app.whenReady().then(async () => {
  const which = process.argv[process.argv.length - 1];
  if (which.startsWith("print")) {
    // 1 回の起動で 1 巻だけ(2 つ目の読み込みが失敗するため)。print:N。引数なしの print は巻の数を出す
    const vols = JSON.parse(readFileSync(path.join(out, "volumes.json"), "utf8"));
    const n = Number(which.split(":")[1]);
    if (!n) console.log("VOLS " + vols.length);
    else await pdf(vols[n - 1].file, `tarot-booklet-print-${n}.pdf`, 210, 297);
  } else await pdf("book.html", "tarot-booklet-read-A6.pdf", 105, 148);
  app.quit();
});
