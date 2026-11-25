// タロット解説書(A6)の組版。2 つの版を作る:
//   full    … 正位置と逆位置(144 ページちょうど)
//   upright … 正位置だけ
// node booklet/build.mjs → booklet/out/(測る用・読む用・印刷用の HTML)と assets/booklet/(アプリで読む HTML・巻の一覧)
// 文は Claude が書いたもの(市販の冊子の文は写していない)。絵は 1909 年のライダー版(パブリックドメイン)。
// 色はカードの絵だけ。文字と図は黒と灰色(2026-11-25 利用者「シンプルな色使いに。カラーはカードだけ」)。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "booklet/out");
const assets = resolve(root, "assets/booklet");
mkdirSync(out, { recursive: true });
mkdirSync(assets, { recursive: true });
const cards = JSON.parse(readFileSync(resolve(root, "src/decks/tarot/cards.json"), "utf8"));
const spreads = JSON.parse(readFileSync(resolve(root, "src/decks/tarot/spreads.json"), "utf8"));
const depict = JSON.parse(readFileSync(resolve(root, "src/decks/tarot/depict.json"), "utf8"));
const deep = {};
const kw = {};
for (const f of readdirSync(resolve(root, "src/decks/tarot/deep")).filter((f) => f.endsWith(".json"))) {
  Object.assign(f.startsWith("kw-") ? kw : deep, JSON.parse(readFileSync(resolve(root, "src/decks/tarot/deep", f), "utf8")));
}
const css = readFileSync(resolve(root, "booklet/book.css"), "utf8");
const IMG = "file://" + resolve(root, "assets/decks/tarot") + "/";
const img = (f) => IMG + f;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function cardCode(id) {
  const m = /^([mwcsp])(\d+)$/.exec(id);
  if (!m) return id.toUpperCase();
  const n = Number(m[2]);
  if (m[1] === "m") return "M" + n;
  return m[1].toUpperCase() + (n > 10 ? "PNQK"[n - 11] : n);
}
const SUIT = { m: "大アルカナ", w: "ワンド(火)", c: "カップ(水)", s: "ソード(風)", p: "ペンタクル(地)" };
const suitOf = (id) => id[0];

const TARGET_FULL = 144; // 正逆の版は 144 ページちょうど(利用者)
const MAXV = 48; // 印刷の 1 巻(A4 6 枚)。切って重ねた束が、ふつうのホッチキスで留められる厚さ

// ================= 前半(入門・スプレッド) =================
function frontPages(ed) {
  const P = [];
  const add = (html, cls = "text") => P.push({ html, cls });
  add(
    `<div class="cover"><h1>ウェイト版<br>タロット解説書</h1><img src="${img("00_Fool.jpg")}" class="c-img"><p>ライダー版 78 枚・スプレッド 14 種<br>${ed === "upright" ? "正位置だけの版" : "正位置・逆位置"}・略号つき</p></div>`,
    "plain",
  );
  add(`<h2>この本について</h2>
    <p>1909 年に出版されたライダー版(ウェイト版)タロット 78 枚の解説書です。</p>
    <p>前半は<b>入門</b>と<b>スプレッド</b>(並べ方)、後半は<b>78 枚の解説</b>です。1 枚ごとに、<b>絵の説明</b>・${ed === "upright" ? "<b>意味</b>" : "<b>正位置と逆位置の意味</b>"}・<b>意味の言葉</b>・<b>絵の中のもの</b>・<b>自分への問い</b>を載せました。</p>
    <p>どのカードにも<b>略号</b>(S1・WP・M0 など)を付けています。メモやブレインストーミングで、カードを短く書き留めるのに使えます。</p>
    <h3>使い方</h3>
    <ol><li>入門を一通り読む</li><li>スプレッドを 1 つ選んで、カードを引く</li><li>略号か名前で、後ろの解説を引く</li><li>最後は、絵を見て自分の言葉で</li></ol>
    <p class="note">カードの意味は「決まった答え」ではなく、考えるきっかけです。解説の言葉は、絵を見るための手がかりと思ってください。</p>`);
  add(`<h2>78 枚のつくり</h2>
    <p><b>大アルカナ 22 枚</b>(M0〜M21)は、人生の大きな節目やテーマ。愚者から世界まで、ひとつの旅の段階を描きます。</p>
    <p><b>小アルカナ 56 枚</b>は 4 つのスート×14 枚。毎日の出来事を表します。</p>
    <table class="suits"><tr><th>スート</th><th>元素</th><th>表すもの</th></tr>
    <tr><td>ワンド</td><td>火</td><td>意志・行動・情熱。仕事や挑戦</td></tr>
    <tr><td>カップ</td><td>水</td><td>感情・つながり。気持ちや人間関係</td></tr>
    <tr><td>ソード</td><td>風</td><td>思考・言葉。判断や葛藤</td></tr>
    <tr><td>ペンタクル</td><td>地</td><td>お金・体・暮らし。現実の積み重ね</td></tr></table>
    <p><b>数</b>: 1 始まり／2 選ぶ・つり合い／3 広がる／4 安定／5 ゆらぎ／6 調和／7 試される／8 動く・励む／9 実る／10 完成・重さ</p>
    <p><b>人物</b>: ペイジ=学ぶ人・知らせ／ナイト=動く人／クイーン=内で育てる人／キング=治める人</p>`);
  add(`<h2>絵の読み方</h2>
    <ol class="steps"><li><b>まず絵を見る。</b>最初に目に入ったものを、ひと言にする。それがあなたの入口です。</li>
    <li><b>人は何をしている？</b>立つ・座る・歩く・眠る。向きや視線はどこへ？</li>
    <li><b>数字と色を見る。</b>数は流れの段階、色は気分を伝えます。</li>
    <li><b>解説を引く。</b>略号か名前で、後ろの解説を探します。</li>
    <li><b>問いにつなげる。</b>「今の自分のどこに当てはまる？」と問い返します。</li>
    <li><b>全体を 1 つの話にする。</b>複数枚なら、1 枚ずつ読んだあと、物語のようにつなげます。</li></ol>
    <p class="note">知らないものがあっても大丈夫。絵の中の知らないものに気づくのも、読みのうちです。</p>`);
  add(`<h2>逆位置を使うか、使わないか</h2>
    <p>カードが上下逆に出たときを<b>逆位置</b>と呼びます。占い方は 2 つあり、<b>どちらを使ってもかまいません。好きな方を使いましょう。</b></p>
    <h3>正位置だけで読む</h3>
    <p>上下は気にせず、すべて正位置として読みます。絵をそのまま見て読むので、<b>意味が直感的</b>で、覚えることも少なくて済みます。初めての人にもおすすめです。</p>
    <h3>逆位置も使う</h3>
    <p>${ed === "upright" ? "この版には逆位置の意味を載せていません。使いたいときは、" : ""}次のように読めます。<b>悪い意味ではありません。</b></p>
    <ul><li>力が弱まる・まだ育っていない</li><li>強すぎて、行きすぎている</li><li>外ではなく、内に向いている</li><li>流れが滞っている・見直しが必要</li></ul>
    <p class="note">どちらにするかは、引く前に決めておきます。途中で変えないのがコツです。</p>`);
  add(`<h2>問いの立て方</h2>
    <p>「いつ〜になる？」より、<b>「どう向き合えばいい？」「何が見えていない？」</b>のような、自分で動かせる問いが向いています。</p>
    <p>はい／いいえで答えが出る問いは、1 枚引きで十分。複雑な問いは、スプレッドで流れを見ます。</p>
    <h3>混ぜ方(一例)</h3>
    <ol><li>カードを裏向きに広げ、両手で円を描くように混ぜる</li><li>1 つにまとめ、好きなだけ切る(カット)</li><li>上から順に、または好きな所から、スプレッドの番号の順に置く</li></ol>
    <p class="note">同じ問いを、気に入る答えが出るまで引き直すのは避けましょう。最初の 1 回を、よく読みます。</p>`);
  {
    const majors = cards.filter((c) => c.major).map((c) => `<span class="mj"><b>${cardCode(c.id)}</b> ${esc(c.ja)}</span>`).join("");
    add(`<h2>略号</h2>
      <p>カードごとに短い名前(略号)を付けました。メモやブレインストーミングに書くとき、引いた札をすぐ探すときに使えます。</p>
      <table class="codes"><tr><th>大アルカナ</th><td><b>M</b>+番号(0〜21)</td></tr>
      <tr><th>小アルカナ</th><td>スート+数。<b>W</b>ワンド・<b>C</b>カップ・<b>S</b>ソード・<b>P</b>ペンタクル</td></tr>
      <tr><th>人物</th><td><b>P</b>ペイジ・<b>N</b>ナイト・<b>Q</b>クイーン・<b>K</b>キング</td></tr></table>
      <p class="ex">例: <b>S1</b>=ソードのエース／<b>WP</b>=ワンドのペイジ／<b>PQ</b>=ペンタクルのクイーン(最初がスート、次が数か人物)／<b>M15</b>=悪魔</p>
      <div class="majors">${majors}</div>`);
  }
  add(`<h2>スプレッドの使い方</h2>
    <p><b>スプレッド</b>は、カードを並べる型です。位置ごとに「何を見るか」が決まっています。</p>
    <ol class="steps"><li><b>問いを決める。</b>紙に 1 行書くと、ぶれません。</li>
    <li><b>型を選ぶ。</b>次のページから 14 種類。迷ったら「3 枚(過去・現在・未来)」。</li>
    <li><b>混ぜて、1 枚ずつ引く。</b>番号の順に、位置へ置きます。</li>
    <li><b>全体を眺める。</b>先に、色・数・人物の多さなど、ぱっと見の印象を。</li>
    <li><b>番号の順に読む。</b>位置の意味(「過去」など)と、カードの絵を重ねます。</li>
    <li><b>最後に 1 文にまとめる。</b>「つまり私は〜」と書いて終わります。</li></ol>
    <p class="note">枚数の多い型ほど、読みが長くなります。最初は 1〜3 枚から。</p>`);
  for (const id of ORDER) {
    const s = spreads.find((x) => x.id === id);
    const [q, tip] = SP[id];
    const name = s.name.replace(/（.*）$/, "");
    const sub = (s.name.match(/（(.*)）$/) ?? [, ""])[1];
    const list = id === "year"
      ? `<li><b>1〜12</b> 各月<span>その月のテーマ(予言ではなく、その月に意識すること)</span></li>`
      : s.pos.map((p, i) => `<li><b>${i + 1}</b> ${esc(p.name)}<span>${esc(p.hint)}</span></li>`).join("");
    add(`<h2>${esc(name)}<small>${esc(sub)}</small></h2><div class="dwrap">${diagram(s)}</div><ul class="plist${s.pos.length > 7 ? " two" : ""}">${list}</ul><p class="q"><b>向く問い</b> ${esc(q)}</p><p class="tip"><b>読み方</b> ${esc(tip)}</p>`, "spread");
  }
  return P;
}

const SP = {
  one: ["今日の 1 枚・今いちばん必要な視点を知りたいとき", "絵をじっと見て、最初に気づいたものを言葉にします。はい／いいえの問いにも。"],
  three: ["物事の流れをつかみたいとき", "過去→現在→未来を、ひとつの短い物語につなげます。未来は「このまま進んだ先」と読みます。"],
  "three-sit": ["悩みの整理・次の一歩を考えたいとき", "「状況」と「課題」の差に注目。助言は、課題を越える 1 つの行動として読みます。"],
  "three-rel": ["相手との関係を見たいとき", "真ん中は、二人の間にあるもの。自分と相手のカードが似ているか、離れているかも見ます。"],
  "three-mbs": ["考えと行動と気持ちのずれを見たいとき", "3 枚の向きや数を比べ、いちばん離れている位置が、今の引っかかりです。"],
  diamond: ["障害を越える方法を探したいとき", "障害のカードを悪者にせず、「何を教えているか」を読みます。対策と結果をつなげます。"],
  five: ["問題を原因から解きたいとき", "「原因」と「隠れた要因」の違いが肝心。助言どおり動いた先を、結果で確かめます。"],
  choice: ["A か B かで迷っているとき", "良い・悪いではなく、各道で自分が「どう感じるか」を見ます。すぐの結果と、先の結果の差にも注目。"],
  hexagram: ["人との関係・相手の気持ちを知りたいとき", "1〜3 で時間の流れ、4 で対策、5・6 で相手と自分の気持ちを向かい合わせ、真ん中の 7 で結論に着地させます。"],
  horseshoe: ["全体の流れを広く見たいとき", "左から右へ時間が進みます。助言と障害を結んで、結果を読むと筋が通ります。"],
  celtic: ["大きな悩みを、深く見たいとき", "1 の上に 2 を横向きに重ねて十字にします。この 2 枚(現在・障害)が核。次に意識と無意識、時間の流れ、右の柱の順に読みます。"],
  tree: ["自分の中の層を見たいとき", "上(目指すもの)から下(現実)へ、心が形になっていく順に読みます。下から読み返すのもおすすめ。"],
  year: ["1 年の見通しを立てたいとき", "各月は「テーマ」。予言ではなく、その月に意識すると良いことと読みます。"],
  horoscope: ["暮らしのあらゆる面を一度に見たいとき", "12 の位置は暮らしの領域。引いたカードの多いスートに、今の関心が出ます。"],
};
const ORDER = ["one", "three", "three-sit", "three-rel", "three-mbs", "diamond", "five", "choice", "hexagram", "horseshoe", "celtic", "tree", "year", "horoscope"];
function diagram(s) {
  const cw = s.cw, ch = cw * (600 / 360);
  // ケルト十字: 2 は 1 の上に横向きに重ねる(2026-11-25 利用者)
  const at = (p) => (s.id === "celtic" && p.id === "cross" ? s.pos.find((q) => q.id === "present") : p);
  const xs = s.pos.map((p) => at(p).x), ys = s.pos.map((p) => at(p).y);
  const x0 = Math.min(...xs) - ch / 2 - 10, x1 = Math.max(...xs) + ch / 2 + 10;
  const y0 = Math.min(...ys) - ch / 2 - 10, y1 = Math.max(...ys) + ch / 2 + 10;
  const rect = (p) => {
    const c = at(p);
    const g = `<rect x="${c.x - cw / 2}" y="${c.y - ch / 2}" width="${cw}" height="${ch}" rx="10" fill="#eee" stroke="#777" stroke-width="${Math.max(4, cw / 26)}"/>`;
    return s.id === "celtic" && p.id === "cross" ? `<g transform="rotate(90 ${c.x} ${c.y})">${g}</g>` : g;
  };
  // 数字は全部の札を描いたあとに(横向きの 2 に隠れないように、1 は上の端・2 は右の端)
  const num = (p, i) => {
    const c = at(p);
    let x = c.x, y = c.y + cw * 0.18;
    if (s.id === "celtic" && p.id === "present") y = c.y - ch * 0.5 + cw * 0.5;
    if (s.id === "celtic" && p.id === "cross") x = c.x + ch * 0.36;
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${cw * 0.5}" font-weight="700" fill="#333">${i + 1}</text>`;
  };
  return `<svg viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" preserveAspectRatio="xMidYMid meet" class="dia">${s.pos.map(rect).join("")}${s.pos.map(num).join("")}</svg>`;
}

// ================= 後半(カードの解説) =================
// 中身を小さなブロックに分け、カードごとに改ページせず続けて流し込む(内容は削らない)。切れ目は paginate.cjs が高さを測って決める
const words = (arr) => `<p class="words">${arr.map(esc).join("　")}</p>`;
function cardBlocks(c, ed) {
  const d = deep[c.id], w = kw[c.id];
  const B = [];
  const add = (html, o = {}) => B.push({ html, card: c.id, suit: suitOf(c.id), ...o });
  const rv = ed !== "upright";
  add(`<div class="ctop"><img src="${img(c.file)}"><div class="cn"><span class="code">${cardCode(c.id)}</span><b>${esc(c.ja)}</b><span class="en">${esc(c.en)}</span></div>
    <div class="kwl"><span class="lb">正</span>${esc(c.kwUp)}</div>${rv ? `<div class="kwl"><span class="lb">逆</span>${esc(c.kwRv)}</div>` : ""}<p class="depict">${esc(depict[c.id] ?? "")}</p></div>`, { start: true });
  const meanings = (list) => list.forEach((m) => {
    const i = m.indexOf(": ");
    add(i > 0 && i < 8 ? `<div class="mli"><span class="mk">${esc(m.slice(0, i))}</span><span>${esc(m.slice(i + 2))}</span></div>` : `<div class="mli"><span>${esc(m)}</span></div>`);
  });
  add(`<h4>${rv ? "正位置の意味" : "意味"}</h4>`, { kwn: true });
  meanings(d.up);
  add(`<h5>意味の言葉</h5>`, { kwn: true });
  add(words(w.up));
  if (rv) {
    add(`<h4>逆位置の意味</h4>`, { kwn: true });
    meanings(d.rv);
    add(`<h5>意味の言葉</h5>`, { kwn: true });
    add(words(w.rv));
  }
  add(`<h4>絵の中のもの</h4>`, { kwn: true });
  for (const [n, m] of d.items) add(`<div class="it"><b>${esc(n)}</b>${esc(m)}</div>`);
  add(`<h4>自分への問い</h4>`, { kwn: true });
  d.questions.forEach((q, i) => add(`<div class="qi"><span class="qn">${i + 1}.</span>${esc(q)}</div>`));
  add(`<div class="csep"></div>`, { sep: true });
  return B;
}

const pageHtml = (p, n, N) => `<section class="page ${p.cls}">${p.html}<div class="pn">${n > 1 && n < N && p.cls !== "plain" ? n : ""}</div></section>`;
const memo = () => ({ html: `<h2>メモ</h2><div class="memo"></div>`, cls: "text" });
const endPage = {
  html: `<h2>おわりに</h2>
   <p>カードは、未来を決めつけるものではなく、<b>今の自分の見方を映す鏡</b>です。</p>
   <p>体や心の不調、法律、お金の大きな決断は、占いだけで決めず、<b>専門の人にも相談</b>してください。</p>
   <p>同じカードも、日によって、人によって見え方が変わります。<b>外れる・当たる</b>より、<b>気づきがあったか</b>を大切に。</p>`,
  cls: "text",
};
const backPage = {
  html: `<div class="back"><p>ウェイト版タロット解説書</p><p class="s">絵: ライダー版(1909)A. E. Waite / Pamela Colman Smith(パブリックドメイン)</p></div>`,
  cls: "plain",
};

function imposed(pgs, from, N) {
  const n = pgs.length, per = n / 4, sheets = per / 2;
  const html = [];
  for (let k = 0; k < sheets; k++) {
    const front = [0, 1, 2, 3].map((q) => q * per + 2 * k);
    const back = [0, 1, 2, 3].map((q) => q * per + 2 * k + 1);
    const backPos = [back[1], back[0], back[3], back[2]]; // 長辺で返すと左右が入れ替わる
    for (const arr of [front, backPos]) html.push(`<div class="sheet">${arr.map((pi, pos) => `<div class="slot s${pos}">${pageHtml(pgs[pi], from + pi, N)}</div>`).join("")}<i class="cutv"></i><i class="cuth"></i></div>`);
  }
  return { html: html.join(""), sheets };
}

const editions = {};
for (const ed of ["full", "upright"]) {
  const front = frontPages(ed);
  const blocks = [];
  for (const g of ["m", "w", "c", "s", "p"]) for (const c of cards.filter((c) => suitOf(c.id) === g)) blocks.push(...cardBlocks(c, ed));
  const sig = ed + ":" + blocks.length + ":" + blocks.reduce((h, b) => (h * 31 + b.html.length) % 1e9, 7) + ":" + css.length;
  writeFileSync(
    resolve(out, `measure-${ed}.html`),
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${css}</style></head><body class="read">
<section class="page cardflow probe"><div class="rh">x</div><div class="fbody"></div></section>
<section class="page cardflow measure"><div class="rh">x</div><div class="fbody mcol">${blocks.map((b, i) => `<div class="b" data-i="${i}">${b.html}</div>`).join("")}</div></section>
<script>window.__blocks=${JSON.stringify(blocks.map((b) => ({ kwn: !!b.kwn, start: !!b.start, sep: !!b.sep, suit: b.suit })))};window.__sig=${JSON.stringify(sig)}</script></body></html>`,
  );
  let paging = null;
  try {
    const j = JSON.parse(readFileSync(resolve(root, `booklet/pages-${ed}.json`), "utf8"));
    if (j.sig === sig) paging = j.pages;
  } catch {}
  if (!paging) {
    paging = [];
    let cur = [];
    blocks.forEach((b, i) => {
      if (b.start && cur.length) (paging.push(cur), (cur = []));
      cur.push(i);
    });
    if (cur.length) paging.push(cur);
  }
  const nameOf = (id) => `${cardCode(id)} ${cards.find((x) => x.id === id).ja}`;
  const cardPages = paging.map((idx) => {
    const first = blocks[idx[0]];
    const cont = first.start ? "" : `<span class="rh-cont">${esc(nameOf(first.card))}(つづき)</span>`;
    const body = idx.filter((i, j) => !(blocks[i].sep && (j === 0 || j === idx.length - 1))).map((i) => blocks[i].html).join("");
    return { html: `<div class="rh">${SUIT[first.suit]}${cont}</div><div class="fbody">${body}</div>`, cls: "cardflow" };
  });
  const book = [...front, ...cardPages, endPage];
  const target = ed === "full" ? TARGET_FULL : Math.ceil((book.length + 1) / 8) * 8;
  if (book.length + 1 > target) console.warn(`!! ${ed}: ${book.length + 1} ページで、${target} ページに収まりません`);
  while (book.length + 1 < target) book.push(memo());
  book.push(backPage);
  const N = book.length;
  const body = book.map((p, i) => pageHtml(p, i + 1, N)).join("");
  writeFileSync(resolve(out, `book-${ed}.html`), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>ウェイト版タロット解説書</title><style>${css}
@page{size:105mm 148mm;margin:0}</style></head><body class="read">${body}</body></html>`);
  // アプリの中で読む用(絵は相対パス。#z=倍率)
  writeFileSync(
    resolve(assets, `reader-${ed}.html`),
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>ウェイト版タロット解説書</title><style>${css}
body.read{background:#666;padding:16px 0}body.read .page{box-shadow:0 2px 10px rgba(0,0,0,.35);margin:0 auto 16px}</style></head><body class="read">${body.replaceAll(IMG, "../decks/tarot/")}<script>const z=()=>parseFloat(location.hash.slice(3))||1.8;const ap=()=>{document.body.style.zoom=z()};ap();addEventListener("hashchange",ap)</script></body></html>`,
  );
  // 印刷用: 続きのページのまま、MAXV ページ以下(8 の倍数)の巻に分ける
  const k = Math.ceil(N / MAXV);
  const sizes = [];
  let rest = N / 8;
  for (let i = 0; i < k; i++) {
    const s = Math.ceil(rest / (k - i));
    sizes.push(s * 8);
    rest -= s;
  }
  const vols = [];
  let from = 1;
  sizes.forEach((size, i) => {
    const pg = book.slice(from - 1, from - 1 + size);
    const { html, sheets } = imposed(pg, from, N);
    const file = `print-${ed}-${i + 1}.html`;
    writeFileSync(resolve(out, file), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${css}
@page{size:210mm 297mm;margin:0}</style></head><body class="print">${html}</body></html>`);
    vols.push({ n: i + 1, from, to: from + size - 1, pages: size, sheets, file });
    from += size;
  });
  editions[ed] = { pages: N, vols };
  console.log(`${ed}: ${N} ページ(解説 ${cardPages.length})・印刷 ${vols.length} 巻 ` + vols.map((v) => `${v.from}-${v.to}(${v.sheets}枚)`).join(" / "));
}
writeFileSync(resolve(out, "editions.json"), JSON.stringify(editions, null, 1));
writeFileSync(resolve(assets, "volumes.json"), JSON.stringify(Object.fromEntries(Object.entries(editions).map(([k, v]) => [k, { pages: v.pages, vols: v.vols.map(({ file, ...x }) => x) }])), null, 1));
