#!/bin/sh
# BRESUTO を 1 行で入れる・最新にする(Linux・Mac):
#   curl -fsSL https://raw.githubusercontent.com/Yurii7812/bresuto/main/install/bootstrap.sh | sh
# Linux: YuriiNote と同じく、作業フォルダを取ってきて組み立てる(bresuto --update で更新)。
# Mac: Releases の完成品(.dmg)を「アプリケーション」に入れる(更新は同じ 1 行をもう一度)。
# Windows は PowerShell で: irm https://raw.githubusercontent.com/Yurii7812/bresuto/main/install/bootstrap.ps1 | iex
set -eu
RAW="${BRESUTO_RAW:-https://raw.githubusercontent.com/Yurii7812/bresuto/main}"
T=$(mktemp)
case "$(uname -s)" in
  Linux) curl -fsSL "$RAW/install/get-linux.sh" -o "$T" ;;
  Darwin) curl -fsSL "$RAW/install/get-mac.sh" -o "$T" ;;
  *) echo "Windows では PowerShell に次の 1 行を貼ってください:"; echo "  irm https://raw.githubusercontent.com/Yurii7812/bresuto/main/install/bootstrap.ps1 | iex"; exit 1 ;;
esac
exec sh "$T" "$@"
