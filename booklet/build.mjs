// タロット小冊子(A6・カラー・64 ページ)の組版。
//   node booklet/build.mjs  → booklet/out/book.html(読む用: 1 ページずつ)・print.html(印刷用: A4 に A6 を 4 面)
// 文は ThinkDraw のために Claude が書いたもの(市販の冊子の文は写していない)。絵は同梱の 1909 年ライダー版。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "booklet/out");
mkdirSync(out, { recursive: true });
const cards = JSON.parse(readFileSync(resolve(root, "src/decks/tarot/cards.json"), "utf8"));
const spreads = JSON.parse(readFileSync(resolve(root, "src/decks/tarot/spreads.json"), "utf8"));
const img = (f) => "file://" + resolve(root, "assets/decks/tarot", f);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function cardCode(id) {
  const m = /^([mwcsp])(\d+)$/.exec(id);
  if (!m) return id.toUpperCase();
  const n = Number(m[2]);
  if (m[1] === "m") return "M" + n;
  return m[1].toUpperCase() + (n > 10 ? "PNQK"[n - 11] : n);
}

const SUIT = { m: ["大アルカナ", "#6b4fa0"], w: ["ワンド(火)", "#c0691b"], c: ["カップ(水)", "#2f6fdf"], s: ["ソード(風)", "#4a6178"], p: ["ペンタクル(地)", "#2e8540"] };
const suitOf = (id) => id[0];

// ---------- ページの部品 ----------
const pages = []; // 各要素: { html, cls }
const add = (html, cls = "") => pages.push({ html, cls });

// 表紙
add(`<div class="cover"><div class="c-top">THINK DRAW</div><img src="${img("00_Fool.jpg")}" class="c-img"><h1>タロット<br>小冊子</h1><p>ライダー版 78 枚<br>略号・スプレッド つき</p></div>`, "plain");

// 入門
const intro = [
  [
    "この冊子について",
    `<p>1909 年のライダー版(ウェイト版)の 78 枚を、<b>1 冊で持ち歩ける大きさ</b>にまとめた小さな手引きです。</p>
     <p>前半は<b>入門</b>と<b>スプレッド</b>(並べ方)、後半は<b>78 枚の一覧</b>です。どのカードにも<b>略号</b>(S1・WP・M0 など)を付けました。</p>
     <h3>使い方</h3>
     <ol><li>まず入門を一通り読む(5 分)</li><li>スプレッドから 1 つ選ぶ</li><li>カードを引いたら、略号で一覧を引く</li><li>最後は、絵を見て自分の言葉で</li></ol>
     <p class="note">カードの意味は「決まった答え」ではなく、考えるきっかけです。一覧の言葉は、絵を見るための手がかりと思ってください。</p>`,
  ],
  [
    "78 枚のつくり",
    `<p><b>大アルカナ 22 枚</b>(M0〜M21)は、人生の大きな節目やテーマ。愚者から世界まで、ひとつの旅の段階を描きます。</p>
     <p><b>小アルカナ 56 枚</b>は 4 つのスート×14 枚。毎日の出来事を表します。</p>
     <table class="suits"><tr><td class="w">ワンド</td><td>火・意志・行動・情熱。仕事や挑戦</td></tr>
     <tr><td class="c">カップ</td><td>水・感情・つながり。気持ちや人間関係</td></tr>
     <tr><td class="s">ソード</td><td>風・思考・言葉。判断や葛藤</td></tr>
     <tr><td class="p">ペンタクル</td><td>地・お金・体・暮らし。現実の積み重ね</td></tr></table>
     <p><b>数</b>: 1 始まり／2 選ぶ・つり合い／3 広がる／4 安定／5 ゆらぎ／6 調和／7 試される／8 動く・励む／9 実る／10 完成・重さ</p>
     <p><b>人物</b>: ペイジ=学ぶ人・知らせ／ナイト=動く人／クイーン=内で育てる人／キング=治める人</p>`,
  ],
  [
    "絵の読み方",
    `<ol class="steps"><li><b>まず絵を見る。</b>最初に目に入ったものを、ひと言にする。それがあなたの入口です。</li>
     <li><b>人は何をしている？</b>立つ・座る・歩く・眠る。向きや視線はどこへ？</li>
     <li><b>数字と色を見る。</b>数は流れの段階、色は気分を伝えます。</li>
     <li><b>キーワードを引く。</b>後ろの一覧で、略号から探します。</li>
     <li><b>問いにつなげる。</b>「今の自分のどこに当てはまる？」と問い返します。</li>
     <li><b>全体を 1 つの話にする。</b>複数枚なら、1 枚ずつ読んだあと、物語のようにつなげます。</li></ol>
     <p class="note">知らないものがあっても大丈夫。絵の中の知らないものに気づくのも、読みのうちです。</p>`,
  ],
  [
    "逆位置と問いの立て方",
    `<h3>逆位置(さかさま)</h3>
     <p>カードが上下逆に出たとき。<b>悪い意味ではありません。</b>次のように読めます。</p>
     <ul><li>力が弱まる・まだ育っていない</li><li>強すぎて、行きすぎている</li><li>外ではなく、内に向いている</li><li>流れが滞っている・見直しが必要</li></ul>
     <p>逆位置を使わず、すべて正位置で読んでもかまいません。</p>
     <h3>問いの立て方</h3>
     <p>「いつ〜になる?」より、<b>「どう向き合えばいい?」「何が見えていない?」</b>のような、自分で動かせる問いが向いています。</p>
     <p>はい／いいえで答えが出る問いは、1 枚引きで十分。複雑な問いは、スプレッドで流れを見ます。</p>
     <p class="note">同じ問いを、気に入る答えが出るまで引き直すのは避けましょう。最初の 1 回を、よく読みます。</p>`,
  ],
];
for (const [t, body] of intro) add(`<h2>${t}</h2>${body}`, "text");

// 略号のページ
{
  const majors = cards.filter((c) => c.major).map((c) => `<span class="mj"><b>${cardCode(c.id)}</b> ${esc(c.ja)}</span>`).join("");
  add(
    `<h2>略号</h2>
     <p>カードごとに短い名前(略号)を付けました。引いた札を、すぐ探せます。</p>
     <table class="codes"><tr><th>大アルカナ</th><td><b>M</b>+番号(0〜21)</td></tr>
     <tr><th>小アルカナ</th><td>スート+数。<b>W</b>ワンド・<b>C</b>カップ・<b>S</b>ソード・<b>P</b>ペンタクル</td></tr>
     <tr><th>人物</th><td><b>P</b>ペイジ・<b>N</b>ナイト・<b>Q</b>クイーン・<b>K</b>キング</td></tr></table>
     <p class="ex">例: <b>S1</b>=ソードのエース／<b>WP</b>=ワンドのペイジ／<b>PQ</b>=ペンタクルのクイーン(P はスートとしても人物としても使うので、最初がスート、次が人物)／<b>M15</b>=悪魔</p>
     <div class="majors">${majors}</div>
     <p class="note">ThinkDraw では、検索に略号を入れて(S1・WP・M0・デビル)カードを探せます。</p>`,
    "text",
  );
}

// スプレッドの使い方
add(
  `<h2>スプレッドの使い方</h2>
   <p><b>スプレッド</b>は、カードを並べる型です。位置ごとに「何を見るか」が決まっています。</p>
   <ol class="steps"><li><b>問いを決める。</b>紙に 1 行書くと、ぶれません。</li>
   <li><b>型を選ぶ。</b>次のページから 14 種類。迷ったら「3 枚(過去・現在・未来)」。</li>
   <li><b>混ぜて、1 枚ずつ引く。</b>混ぜ方は自由。番号の順に、位置へ置きます。</li>
   <li><b>全体を眺める。</b>先に、色・数・人物の多さなど、ぱっと見の印象を。</li>
   <li><b>番号の順に読む。</b>位置の意味(「過去」など)と、カードの絵を重ねます。</li>
   <li><b>最後に 1 文にまとめる。</b>「つまり私は〜」と書いて終わります。</li></ol>
   <p class="note">枚数の多い型ほど、読みが長くなります。最初は 1〜3 枚から。</p>`,
  "text",
);

// スプレッド
const SP = {
  one: ["今日の 1 枚・今いちばん必要な視点を知りたいとき", "絵をじっと見て、最初に気づいたものを言葉にします。迷ったら、これ 1 枚で十分です。"],
  three: ["物事の流れをつかみたいとき", "過去→現在→未来を、ひとつの短い物語につなげます。未来は「このまま進んだ先」と読みます。"],
  "three-sit": ["悩みの整理・次の一歩を考えたいとき", "「状況」と「課題」の差に注目。助言は、課題を越える 1 つの行動として読みます。"],
  "three-rel": ["相手との関係を見たいとき", "真ん中は、二人の間にあるもの。自分と相手のカードが似ているか、離れているかも見ます。"],
  "three-mbs": ["考えと行動と気持ちのずれを見たいとき", "3 枚の向きや数を比べ、いちばん離れている位置が、今の引っかかりです。"],
  diamond: ["障害を越える方法を探したいとき", "障害のカードを悪者にせず、「何を教えているか」を読みます。対策と結果をつなげます。"],
  five: ["問題を原因から解きたいとき", "「原因」と「隠れた要因」の違いが肝心。助言どおり動いた先を、結果で確かめます。"],
  choice: ["A か B かで迷っているとき", "良い・悪いではなく、各道で自分が「どう感じるか」を見ます。すぐの結果と、先の結果の差にも注目。"],
  hexagram: ["人との関係・相手の気持ちを知りたいとき", "自分と相手の気持ちを向かい合わせて読み、アドバイスと結論で着地させます。"],
  horseshoe: ["全体の流れを広く見たいとき", "左から右へ時間が進みます。助言と障害を結んで、結果を読むと筋が通ります。"],
  celtic: ["大きな悩みを、深く見たいとき", "中心の 2 枚(現在・障害)が核。次に意識と無意識、時間の流れ、右の柱の順に。時間をかけて 1 つの物語に。"],
  tree: ["自分の中の層を見たいとき", "上(目指すもの)から下(現実)へ、心が形になっていく順に読みます。下の方から読み返すのもおすすめ。"],
  year: ["1 年の見通しを立てたいとき", "各月は「テーマ」。予言ではなく、その月に意識すると良いことと読みます。"],
  horoscope: ["暮らしのあらゆる面を一度に見たいとき", "12 の位置は暮らしの領域。引いたカードの多いスートに、今の関心が出ます。"],
};
const ORDER = ["one", "three", "three-sit", "three-rel", "three-mbs", "diamond", "five", "choice", "hexagram", "horseshoe", "celtic", "tree", "year", "horoscope"];
function diagram(s) {
  const cw = s.cw, ch = cw * (600 / 360);
  const xs = s.pos.map((p) => p.x), ys = s.pos.map((p) => p.y);
  const x0 = Math.min(...xs) - cw / 2 - 10, x1 = Math.max(...xs) + cw / 2 + 10;
  const y0 = Math.min(...ys) - ch / 2 - 10, y1 = Math.max(...ys) + ch / 2 + 10;
  const W = x1 - x0, H = y1 - y0;
  const rects = s.pos.map((p, i) => `<g><rect x="${p.x - cw / 2}" y="${p.y - ch / 2}" width="${cw}" height="${ch}" rx="10" fill="#fff" stroke="#6b4fa0" stroke-width="${Math.max(4, cw / 25)}"/><text x="${p.x}" y="${p.y + cw * 0.22}" text-anchor="middle" font-size="${cw * 0.62}" font-weight="700" fill="#6b4fa0">${i + 1}</text></g>`).join("");
  return `<svg viewBox="${x0} ${y0} ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="dia">${rects}</svg>`;
}
for (const id of ORDER) {
  const s = spreads.find((x) => x.id === id);
  const [q, tip] = SP[id];
  const name = s.name.replace(/（.*）$/, "");
  const sub = (s.name.match(/（(.*)）$/) ?? [, ""])[1];
  const list = id === "year"
    ? `<li><b>1〜12</b> 各月<span>その月のテーマ(予言ではなく、その月に意識すること)</span></li>`
    : s.pos.map((p, i) => `<li><b>${i + 1}</b> ${esc(p.name)}<span>${esc(p.hint)}</span></li>`).join("");
  const two = s.pos.length > 7 ? " two" : "";
  add(`<h2>${esc(name)}<small>${esc(sub)}</small></h2><div class="dwrap">${diagram(s)}</div><ul class="plist${two}">${list}</ul><p class="q"><b>向く問い</b> ${esc(q)}</p><p class="tip"><b>読み方</b> ${esc(tip)}</p>`, "spread");
}

// 各論(1 ページに 2 枚)
function cell(c) {
  const [suit, col] = SUIT[suitOf(c.id)];
  return `<div class="cell"><img src="${img(c.file)}"><div class="ct"><div class="cn"><span class="code" style="background:${col}">${cardCode(c.id)}</span><b>${esc(c.ja)}</b></div><div class="en">${esc(c.en)}</div>
  <div class="dir"><i>正</i>${esc(c.kwUp)}</div><p>${esc(c.up)}</p><div class="dir rv"><i>逆</i>${esc(c.kwRv)}</div><p>${esc(c.rv)}</p></div></div>`;
}
const groups = ["m", "w", "c", "s", "p"];
for (const g of groups) {
  const list = cards.filter((c) => suitOf(c.id) === g);
  for (let i = 0; i < list.length; i += 2) {
    const [suit, col] = SUIT[g];
    add(`<div class="cardhead" style="border-color:${col};color:${col}">${suit}</div>${list.slice(i, i + 2).map(cell).join("")}`, "cards");
  }
}

// 終わり・メモ・奥付
add(
  `<h2>おわりに</h2>
   <p>カードは、未来を決めつけるものではなく、<b>今の自分の見方を映す鏡</b>です。</p>
   <p>体や心の不調、法律、お金の大きな決断は、占いだけで決めず、<b>専門の人にも相談</b>してください。</p>
   <p>同じカードも、日によって、人によって見え方が変わります。<b>外れる・当たる</b>より、<b>気づきがあったか</b>を大切に。</p>
   <p>次のページからは、引いたカードや気づきを書き留めるメモです。</p>`,
  "text",
);
add(`<h2>メモ</h2><div class="memo"></div>`, "text");
add(`<h2>メモ</h2><div class="memo"></div>`, "text");
add(
  `<div class="back"><p>タロット小冊子</p><p class="s">ライダー版(1909)の絵と、ThinkDraw のために書いた文<br>絵: A. E. Waite / Pamela Colman Smith(パブリックドメイン)</p></div>`,
  "plain",
);

while (pages.length % 8) pages.splice(pages.length - 1, 0, { html: `<h2>メモ</h2><div class="memo"></div>`, cls: "text" });
const N = pages.length;

const css = readFileSync(resolve(root, "booklet/book.css"), "utf8");
const pageHtml = (p, n) => `<section class="page ${p.cls}">${p.html}<div class="pn">${n > 1 && n < N ? n : ""}</div></section>`;

// 読む用: A6 を 1 ページずつ
writeFileSync(resolve(out, "book.html"), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>タロット小冊子</title><style>${css}
@page{size:105mm 148mm;margin:0}</style></head><body class="read">${pages.map((p, i) => pageHtml(p, i + 1)).join("")}</body></html>`);

// アプリの中で読む用(assets/booklet/reader.html。絵は相対パス。#z=倍率 で拡大縮小)
{
  const assetsDir = resolve(root, "assets/booklet");
  mkdirSync(assetsDir, { recursive: true });
  const body = pages.map((p, i) => pageHtml(p, i + 1)).join("").replaceAll("file://" + resolve(root, "assets/decks/tarot") + "/", "../decks/tarot/");
  writeFileSync(
    resolve(assetsDir, "reader.html"),
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>タロット小冊子</title><style>${css}
body.read{background:#5b5670;padding:16px 0}body.read .page{box-shadow:0 2px 10px rgba(0,0,0,.35);margin:0 auto 16px}</style></head><body class="read">${body}<script>const z=()=>parseFloat(location.hash.slice(3))||1.8;const ap=()=>{document.body.style.zoom=z()};ap();addEventListener("hashchange",ap)</script></body></html>`,
  );
}

// 印刷用: A4 の 1 面に A6 を 4 つ。切って 4 つの山にし、山の順に重ねて左を留める(1 山 = N/4 ページ)
const per = N / 4; // 1 山のページ数
const sheets = per / 2; // A4 の枚数(両面)
const html = [];
for (let k = 0; k < sheets; k++) {
  const front = [0, 1, 2, 3].map((q) => q * per + 2 * k); // 左上・右上・左下・右下(0 始まりのページ)
  const back = [0, 1, 2, 3].map((q) => q * per + 2 * k + 1);
  // 裏は左右が入れ替わる(長辺で返すため)
  const backPos = [back[1], back[0], back[3], back[2]];
  for (const arr of [front, backPos]) {
    html.push(`<div class="sheet">${arr.map((pi, pos) => `<div class="slot s${pos}">${pageHtml(pages[pi], pi + 1)}</div>`).join("")}<i class="cutv"></i><i class="cuth"></i></div>`);
  }
}
writeFileSync(resolve(out, "print.html"), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>タロット小冊子(印刷用)</title><style>${css}
@page{size:210mm 297mm;margin:0}</style></head><body class="print">${html.join("")}</body></html>`);
console.log(`ページ数 ${N}・A4 ${sheets} 枚(両面)`);
