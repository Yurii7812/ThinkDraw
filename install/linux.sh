#!/bin/sh
# ランチャー(アプリの検索)から「bresuto」、端末から「bresuto」で起動できるようにする
# (2026-11-26 に ThinkDraw から改名。前の thinkdraw のコマンド・ランチャー・アイコンは消す)
set -e
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
chmod +x "$DIR/install/bresuto.sh"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
cp "$DIR/assets/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/bresuto.png"
# 絵の SVG は Qt(KDE)が正しく描けないことがあるので、PNG だけを各サイズで入れる
for s in 16 24 32 48 64 128 256; do
  mkdir -p "$HOME/.local/share/icons/hicolor/${s}x${s}/apps"
  rsvg-convert -w $s -h $s "$DIR/assets/icon.svg" -o "$HOME/.local/share/icons/hicolor/${s}x${s}/apps/bresuto.png" 2>/dev/null || cp "$DIR/assets/icon.png" "$HOME/.local/share/icons/hicolor/${s}x${s}/apps/bresuto.png"
done
ln -sf "$DIR/install/bresuto.sh" "$HOME/.local/bin/bresuto"
cat > "$HOME/.local/share/applications/bresuto.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=bresuto
GenericName=ブレスト・ノート
Comment=無限キャンバスに書き散らして、束ねて整理する
Exec="$HOME/.local/bin/bresuto" %U
Icon=bresuto
Terminal=false
Categories=Office;Utility;
Keywords=bresuto;bresuto;ブレスト;ノート;タロット;thinkdraw;
StartupNotify=true
StartupWMClass=bresuto
DESKTOP
# 前の名前(ThinkDraw)で入れた物を消す
rm -f "$HOME/.local/bin/thinkdraw" "$HOME/.local/share/applications/thinkdraw.desktop" "$HOME/.local/share/icons/hicolor/scalable/apps/thinkdraw.svg"
for s in 16 24 32 48 64 128 256 512; do rm -f "$HOME/.local/share/icons/hicolor/${s}x${s}/apps/thinkdraw.png"; done
gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
kbuildsycoca6 >/dev/null 2>&1 || kbuildsycoca5 >/dev/null 2>&1 || true
echo "入れました: $HOME/.local/bin/bresuto と bresuto.desktop"
