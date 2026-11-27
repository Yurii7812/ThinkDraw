# bresuto(ブレスト)

2026-11-26 に ThinkDraw から改名。起動のコマンドは `bresuto`。

「ページが一つだけ」の無限キャンバスに考えを書き散らし、散らかったら束ねてグループにする、デスクトップのノートアプリ。仕様は [SPEC.md](SPEC.md)。

- Electron + TypeScript。Linux で作っている。Windows・Mac 用のファイルも作る(2026-11-28 から。自分用で署名なし)。
- 開いたフォルダに、1 ノード = 1 つの `.md`(frontmatter 付きの Markdown)で保存する。

## 入れる(配布ファイル)

[Releases](https://github.com/Yurii7812/bresuto/releases) から、使う OS のファイルを落とす。

| OS | ファイル | 入れ方 |
|---|---|---|
| Linux | `BRESUTO-版.AppImage` | 実行できるようにして(`chmod +x`)ダブルクリック。新しい版が出ると自動で落とし、知らせてくれる |
| Linux(Debian・Ubuntu) | `bresuto_版_amd64.deb` | `sudo apt install ./bresuto_版_amd64.deb` |
| Windows | `BRESUTO-Setup-版.exe` | ダブルクリック。署名が無いので「Windows によって PC が保護されました」が出たら「詳細情報 → 実行」。自動更新あり |
| Mac(Apple シリコン M1 以降) | `BRESUTO-版-arm64.dmg` | 開いてアプリケーションへ。署名が無いので、最初だけ右クリック →「開く」。自動更新は無い(新しい版を手で入れ替える) |

紙PKM(スキャンした紙のノートの取り込み)は、ImageMagick(`magick`)と poppler(`pdftoppm`)と OCR の道具を使う。Windows・Mac で使うときは、それらを別に入れる必要がある。

新しい版を出すには、`package.json` の version を上げてタグを push する(`git tag v0.2.0 && git push origin v0.2.0`)。GitHub Actions が 3 つの OS のファイルを作って Releases に置く。手元で作るなら `npm run dist`(`release/` にできる)。

## 動かす(作業フォルダから)

```sh
npm install
npm start          # まとめてから起動
sh install/linux.sh   # ランチャー(アプリの検索)から「bresuto」、端末から「bresuto」で起動できるようにする
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
