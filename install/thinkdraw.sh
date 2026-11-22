#!/bin/sh
# ThinkDraw の起動: 作業フォルダを、その場でまとめてから起動する(古い複製を起動しないように)
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
NODE="$(command -v node || echo "$HOME/.local/bin/node")"
cd "$DIR" || exit 1
"$NODE" build.mjs >/dev/null || exit 1
exec "$DIR/node_modules/electron/dist/electron" "$DIR" "$@"
