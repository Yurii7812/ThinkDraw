#!/bin/sh
# BRESUTO を入れる・最新にする(Mac)。Releases のいちばん新しい完成品(.dmg)を「アプリケーション」に入れる。
#   curl -fsSL https://raw.githubusercontent.com/Yurii7812/bresuto/main/install/bootstrap.sh | sh
# 署名していないので、ダウンロードの印を外し、その場の印(アドホック署名)を付け直す(「壊れている」「開けません」と出ないように)。
# Mac は自動では更新しないので、新しい版が出たら同じ 1 行をもう一度
set -eu
say() { printf '%s\n' "$*"; }
[ "$(uname -s)" = Darwin ] || { say "Mac だけに対応しています"; exit 1; }
API="https://api.github.com/repos/${BRESUTO_GH:-Yurii7812/bresuto}/releases/latest"
LIST=$(curl -fsSL "$API" | grep '"browser_download_url"' | grep '\.dmg"' | sed 's/.*"\(https[^"]*\)".*/\1/')
# M1 以降は -arm64.dmg、Intel はそれ以外の .dmg
case "$(uname -m)" in arm64) URL=$(printf '%s\n' "$LIST" | grep -- '-arm64\.dmg$' | head -1) ;; *) URL=$(printf '%s\n' "$LIST" | grep -v -- '-arm64\.dmg$' | head -1) ;; esac
[ -n "$URL" ] || { say "Releases に Mac の完成品が見つかりません"; exit 1; }
T=$(mktemp -d)
say "取得しています: $(basename "$URL")"
curl -fL --progress-bar -o "$T/b.dmg" "$URL"
if pgrep -x BRESUTO >/dev/null 2>&1; then say "BRESUTO が動いています。閉じてから、もう一度実行してください"; exit 1; fi
MNT="$T/mnt"; mkdir -p "$MNT"
hdiutil attach -nobrowse -quiet -mountpoint "$MNT" "$T/b.dmg"
DEST=/Applications
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
rm -rf "$DEST/BRESUTO.app"
cp -R "$MNT/BRESUTO.app" "$DEST/"
hdiutil detach -quiet "$MNT" || true
rm -rf "$T"
xattr -dr com.apple.quarantine "$DEST/BRESUTO.app" 2>/dev/null || true
codesign --force --deep --sign - "$DEST/BRESUTO.app" >/dev/null 2>&1 || say "(印の付け直しはできませんでした。開けないときは、右クリック →「開く」)"
say "入れました: $DEST/BRESUTO.app(Launchpad・Spotlight から BRESUTO で開けます)。新しい版が出たら、同じ 1 行をもう一度"
