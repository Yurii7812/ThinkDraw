# BRESUTO(ブレスト)

2026-11-26 に ThinkDraw から改名。起動のコマンドは `bresuto`。

「ページが一つだけ」の無限キャンバスに考えを書き散らし、散らかったら束ねてグループにする、デスクトップのノートアプリ。仕様は [SPEC.md](SPEC.md)。

- Electron + TypeScript。対象は Linux。
- 開いたフォルダに、1 ノード = 1 つの `.md`(frontmatter 付きの Markdown)で保存する。

## 動かす

```sh
npm install
npm start          # まとめてから起動
sh install/linux.sh   # ランチャー(アプリの検索)から「BRESUTO」、端末から「bresuto」で起動できるようにする
```

`install/linux.sh` は `~/.local/bin/bresuto`(この作業フォルダの `install/bresuto.sh` へのリンク)と `bresuto.desktop` を入れる(前の名前の `thinkdraw` は消す)。設定は `~/.config/bresuto/`(前の `~/.config/thinkdraw/` は最初の起動で写す。前のフォルダはそのまま残る)。起動のたびに作業フォルダをまとめ直すので、変更はすぐ効く。

更新するには `bresuto --update`(作業フォルダで `git pull --ff-only` と `npm install` をしてから起動する)。

## 試験

```sh
npm test           # 単体の試験(一時ディレクトリの vault だけを使う)
npm run test:e2e   # 画面の試験(本物の Electron を xvfb-run の上で起動。一時ディレクトリの vault)
npm run typecheck
```

## 構成

| 場所 | 中身 |
|---|---|
| `src/core/` | データモデル・frontmatter の読み書き・索引・操作の意味・元に戻す・グラフの配置・スプレッドの配置(画面に依存しない) |
| `src/main/` | Electron の main・preload・フォルダの読み書き(一時ファイル → リネーム)・ファイル監視 |
| `src/renderer/` | 画面(キャンバス・本文のポップアップ・検索・グラフ・タロット)。UI の文字は `strings.ts` にまとめてある |
| `src/decks/` | デッキ(いまはタロットのみ)。デッキごとにカード定義・意味・スプレッドを持つ |
| `assets/decks/tarot/` | カードの画像(出所は [docs/CREDITS.md](docs/CREDITS.md)) |
| `docs/DECISIONS.md` | SPEC に無い細部で、実装のときに決めたこと |
