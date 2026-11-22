#!/bin/sh
# ThinkDraw の起動: 作業フォルダを、その場でまとめてから起動する(古い複製を起動しないように)
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
NODE="$(command -v node || echo "$HOME/.local/bin/node")"
cd "$DIR" || exit 1
# thinkdraw --update: 作業フォルダを最新にして(git pull)、依存を入れ直してから起動する
if [ "$1" = "--update" ]; then
  shift
  git pull --ff-only || { echo "更新できませんでした(手元に未コミットの変更があるか、通信できません)" >&2; exit 1; }
  npm install --no-audit --no-fund || exit 1
fi
"$NODE" build.mjs >/dev/null || exit 1
exec "$DIR/node_modules/electron/dist/electron" "$DIR" "$@"
