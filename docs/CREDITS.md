# 同梱しているデータの出所

## カードの画像(`assets/decks/tarot/`)

- ライダー・ウェイト版(Rider-Waite-Smith)。画: Pamela Colman Smith、発行: Rider & Company、1909 年。著作権は切れている(パブリックドメイン)。
- スキャン: Steve P.(steve-p.org)による 1909 年の「Pam-A」の清書。
- 旧 YuriiNote の `assets/cards/`(360×600 に縮めたもの)から、78 枚だけを写した。出典は旧リポジトリの `assets/cards/SOURCES.md` で確かめた。表紙の画像(`Cover*.jpg`)は使わないので写していない。

## カードの意味・キーワード・問い(`src/decks/tarot/cards.json`)

- 旧 YuriiNote の `decks/tarot-cards.js` と `decks/tarot-meanings.js` から抜き出した。
- 旧ファイルの冒頭に「このアプリ用に書いたもの。小冊子・解説書の文章は使っていない」とある(利用者がこのアプリのために書いた文章)。

## スプレッド(`src/decks/tarot/spreads.json`)

- 旧 YuriiNote の `decks/tarot-spreads.js` の 14 種(1 枚・3 枚 ×4・ダイヤモンドクロス・5 枚・二者択一・ヘキサグラム・ホースシュー・ケルト十字・生命の樹・12 か月・ホロスコープ)。位置の名前とヒントも、同じファイルにあったもの。
