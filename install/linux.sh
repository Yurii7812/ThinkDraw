#!/bin/sh
# ランチャー(アプリの検索)から「thinkdraw」で起動できるようにする
set -e
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
chmod +x "$DIR/install/thinkdraw.sh"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps" "$HOME/.local/share/icons/hicolor/scalable/apps"
cp "$DIR/assets/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/thinkdraw.png"
cp "$DIR/assets/icon.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/thinkdraw.svg"
ln -sf "$DIR/install/thinkdraw.sh" "$HOME/.local/bin/thinkdraw"
cat > "$HOME/.local/share/applications/thinkdraw.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=ThinkDraw
GenericName=ブレスト・ノート
Comment=無限キャンバスに書き散らして、束ねて整理する
Exec="$HOME/.local/bin/thinkdraw" %U
Icon=thinkdraw
Terminal=false
Categories=Office;Utility;
Keywords=thinkdraw;ThinkDraw;ブレスト;ノート;タロット;
StartupNotify=true
StartupWMClass=thinkdraw
DESKTOP
gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
kbuildsycoca6 >/dev/null 2>&1 || kbuildsycoca5 >/dev/null 2>&1 || true
echo "入れました: $HOME/.local/bin/thinkdraw と thinkdraw.desktop"
