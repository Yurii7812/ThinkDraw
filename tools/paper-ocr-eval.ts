// 紙PKM の OCR の精度を測る(実物のスキャンと正解の一覧で)。
// 使い方: node tools/paper-ocr-eval.mjs <vault の作業用フォルダ> <正解の一覧.tsv(ファイル名\tID)> <画像...>
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PaperStore, DEFAULT_CROP } from "../src/main/paperio";
import { DEFAULT_OCR, makeEngines } from "../src/main/ocr";

const [vault, truthFile, ...files] = process.argv.slice(2);
const truth = new Map((await fs.readFile(truthFile!, "utf8")).trim().split("\n").map((l) => l.split("\t") as [string, string]));
// OCR_MODELS="qwen2.5vl:7b×8,gemma3:4b×4" で差し替えられる
const models = process.env.OCR_MODELS ? process.env.OCR_MODELS.split(",").map((x) => { const [model, b] = x.split("×"); return { model: model!, batch: Number(b) || 1 }; }) : DEFAULT_OCR.models;
const model = models.map((m) => `${m.model}×${m.batch}`).join(" + ");
const store = new PaperStore(vault!);
const t0 = Date.now();
const st = await store.stage(files, makeEngines({ ...DEFAULT_OCR, models }), DEFAULT_CROP, (p) => p.phase === "ocr" && process.stderr.write(`${p.done}/${p.total} ${new Date().toISOString().slice(11, 19)}\n`));
const secs = (Date.now() - t0) / 1000;
let right = 0, autoRight = 0, autoWrong = 0, review = 0, reviewHasRight = 0;
for (const [i, pg] of st.pages.entries()) {
  const want = truth.get(path.basename(files[i]!))!;
  const ok = pg.fz === want;
  if (ok) right++;
  if (pg.status === "auto") ok ? autoRight++ : autoWrong++;
  else {
    review++;
    if (pg.fz === want || pg.ocr?.candidates.includes(want)) reviewHasRight++;
  }
  console.log([path.basename(files[i]!), want, pg.fz ?? "-", pg.status, (pg.ocr?.reads ?? []).join("|"), pg.ocr?.reason].join("\t"));
}
console.log(`\nmodel=${model} pages=${st.pages.length} time=${secs.toFixed(0)}s (${(secs / st.pages.length).toFixed(1)}s/page) ocrError=${st.ocrError}`);
console.log(`1位が正解 ${right}/${st.pages.length} ・自動確定 ${autoRight + autoWrong}(うち誤り ${autoWrong})・要確認 ${review}(候補に正解あり ${reviewHasRight})`);
