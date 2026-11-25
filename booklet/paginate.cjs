// electron booklet/paginate.cjs → out/measure.html のブロックの高さを測り、ページの切れ目を booklet/pages.json に書く
// 決まり: 見出しは次と一緒に・カードの頭は見出しと最初の 1 行まで一緒に・スートが変わったら新しいページ
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 1000, webPreferences: { offscreen: true } });
  await win.loadFile(path.resolve(__dirname, "out/measure.html"));
  await new Promise((r) => setTimeout(r, 1500));
  const r = await win.webContents.executeJavaScript(`(() => {
    const H = document.querySelector(".probe .fbody").getBoundingClientRect().height - 2;
    const els = [...document.querySelectorAll(".mcol > .b")];
    const top = els.map((e) => e.getBoundingClientRect().top);
    const end = els[els.length - 1].getBoundingClientRect().bottom;
    const h = top.map((t, i) => (i + 1 < top.length ? top[i + 1] : end) - t);
    const B = window.__blocks;
    const pages = [];
    let cur = [], used = 0, suit = null;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.sep && !cur.length) continue; // ページの頭の区切り線は出さない
      let need = h[i];
      if (b.kwn && i + 1 < B.length) need += h[i + 1];
      if (b.start) need += (h[i + 1] || 0) + (h[i + 2] || 0);
      const newSuit = b.start && suit !== null && b.suit !== suit;
      if (cur.length && (used + need > H || newSuit)) { pages.push(cur); cur = []; used = 0; if (b.sep) continue; }
      cur.push(i); used += h[i]; suit = b.suit;
    }
    if (cur.length) pages.push(cur);
    return { pages, sig: window.__sig, H };
  })()`);
  writeFileSync(path.resolve(__dirname, "pages.json"), JSON.stringify({ sig: r.sig, pages: r.pages }));
  console.log("各論 " + r.pages.length + " ページ(1 ページの高さ " + Math.round(r.H) + "px)");
  app.exit(0);
});
