#!/bin/sh
# BRESUTO を入れる・最新にする(Linux)。何度実行しても同じ結果になる(YuriiNote の入れ方と同じ形)
#   はじめて:  curl -fsSL https://raw.githubusercontent.com/Yurii7812/bresuto/main/install/bootstrap.sh | sh
#   あとから:  bresuto --update
# やること: git と Node.js の用意 → 最新の取得 → 部品と組み立て → 起動コマンド・メニュー・アイコン。失敗したら、前の状態のまま
set -eu
if [ -z "${BR_REEXEC:-}" ]; then T=$(mktemp); cp "$0" "$T"; BR_REEXEC=1 exec sh "$T" "$@"; fi
ROOT="${BRESUTO_ROOT:-$HOME/.local/share/bresuto}"
APP="$ROOT/src"
REPO="${BRESUTO_REPO:-https://github.com/Yurii7812/bresuto.git}"
BIN="$HOME/.local/bin"; LAUNCH="$BIN/bresuto"
say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" = 0 ] || { have sudo && SUDO=sudo; }
ARCH=$(uname -m)
[ "$(uname -s)" = Linux ] || { say "Linux だけに対応しています"; exit 1; }
# 作業フォルダから動かしている開発用の bresuto(install/linux.sh で入れたもの)があれば、触らない
if [ -L "$LAUNCH" ] && [ -f "$(dirname "$(readlink -f "$LAUNCH")")/../.git/HEAD" ] 2>/dev/null; then
  say "開発用の bresuto($(readlink -f "$LAUNCH"))が入っています。そのままにします(更新は bresuto --update)"
  exit 0
fi
mkdir -p "$ROOT" "$BIN"
if pgrep -f "$APP/node_modules/electron" >/dev/null 2>&1; then say "BRESUTO が動いています。閉じてから、もう一度実行してください"; exit 1; fi
# ---- git
if ! have git; then
  say "git を入れます"
  if have apt-get; then $SUDO apt-get update && $SUDO apt-get install -y git ca-certificates curl
  elif have dnf; then $SUDO dnf install -y git
  elif have pacman; then $SUDO pacman -S --noconfirm git
  elif have zypper; then $SUDO zypper install -y git
  else say "git を自分で入れてから、もう一度実行してください"; exit 1; fi
fi
# ---- Node.js 22 以上(無ければ、公式の配布物を $ROOT/node に置く。システムは触らない)
[ -d "$ROOT/node/bin" ] && PATH="$ROOT/node/bin:$PATH"
nodeok() { have node && have npm && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }
if ! nodeok; then
  say "Node.js を用意します($ROOT/node)"
  case "$ARCH" in x86_64) P=linux-x64 ;; aarch64|arm64) P=linux-arm64 ;; *) say "$ARCH には対応していません。Node.js 22 以上を入れてください"; exit 1 ;; esac
  V=https://nodejs.org/dist/latest-v24.x
  F=$(curl -fsSL "$V/SHASUMS256.txt" | grep "node-v.*-$P.tar.gz" | head -1 | awk '{print $2}')
  [ -n "$F" ] || { say "Node.js の取得先が見つかりません"; exit 1; }
  T=$(mktemp -d); curl -fL --progress-bar -o "$T/n.tgz" "$V/$F"
  rm -rf "$ROOT/node"; mkdir -p "$ROOT/node"; tar -xzf "$T/n.tgz" -C "$ROOT/node" --strip-components=1; rm -rf "$T"
  PATH="$ROOT/node/bin:$PATH"
fi
export PATH
# ---- 取得・組み立て(入れ替えは、最後に一度だけ)
NEW="$ROOT/src-new"; OLD="$ROOT/src-old"
rm -rf "$NEW" "$OLD"
say "最新を取得しています…"
git clone --depth 1 "$REPO" "$NEW"
MOVED=0
if [ -d "$APP/node_modules" ]; then mv "$APP/node_modules" "$NEW/node_modules"; MOVED=1; fi   # 部品は引き継ぐ
cd "$NEW"
say "部品を確認して、組み立てています(はじめては数分かかります)…"
# Electron の本体は、部品を入れたあとに落とす(npm が入れたあとの処理を止めている場合でも動くように)
if ! { npm install --no-audit --no-fund && node node_modules/electron/install.js && node build.mjs; }; then
  say "失敗しました。前の状態のまま残しています"
  cd "$ROOT"; if [ "$MOVED" = 1 ] && [ -d "$NEW/node_modules" ]; then mv "$NEW/node_modules" "$APP/node_modules"; fi; rm -rf "$NEW"; exit 1
fi
[ -d "$APP" ] && mv "$APP" "$OLD"
mv "$NEW" "$APP"; rm -rf "$OLD"; cd "$APP"
# ---- 起動コマンド
cat > "$LAUNCH" <<'LAUNCHER'
#!/bin/sh
set -eu
ROOT="${BRESUTO_ROOT:-$HOME/.local/share/bresuto}"
APP="$ROOT/src"
if [ -d "$ROOT/node/bin" ]; then PATH="$ROOT/node/bin:$PATH"; export PATH; fi
case "${1:-}" in
  --update)
    if [ -f "$APP/install/get-linux.sh" ]; then exec sh "$APP/install/get-linux.sh"; fi
    exec sh -c 'curl -fsSL https://raw.githubusercontent.com/Yurii7812/bresuto/main/install/bootstrap.sh | sh' ;;
  --version) exec node -p 'require(process.argv[1]).version' "$APP/package.json" ;;
  --help|-h) printf '%s\n' 'bresuto             アプリを起動' 'bresuto --update    最新版に更新' 'bresuto --version   バージョンを表示'; exit 0 ;;
esac
[ -x "$APP/node_modules/electron/dist/electron" ] || {
  echo "アプリが見つかりません。次の 1 行で、入れ直してください:" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/Yurii7812/bresuto/main/install/bootstrap.sh | sh" >&2
  exit 1
}
exec "$APP/node_modules/electron/dist/electron" "$APP" "$@"
LAUNCHER
chmod +x "$LAUNCH"
ln -sf "$LAUNCH" "$BIN/BRESUTO"
# ---- アイコンとメニュー
for s in 16 24 32 48 64 128 256 512; do
  d="$HOME/.local/share/icons/hicolor/${s}x${s}/apps"; mkdir -p "$d"
  if have rsvg-convert; then rsvg-convert -w $s -h $s "$APP/assets/icon.svg" -o "$d/bresuto.png" 2>/dev/null || cp "$APP/assets/icon.png" "$d/bresuto.png"
  else cp "$APP/assets/icon.png" "$d/bresuto.png"; fi
done
have gtk-update-icon-cache && gtk-update-icon-cache -q -f --ignore-theme-index "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/bresuto.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=BRESUTO
GenericName=ブレスト・ノート
Comment=無限キャンバスに書き散らして、束ねて整理する
Exec="$LAUNCH" %U
Icon=bresuto
Terminal=false
Categories=Office;Utility;
Keywords=bresuto;BRESUTO;ブレスト;ノート;
StartupNotify=true
StartupWMClass=bresuto
DESKTOP
have update-desktop-database && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
have kbuildsycoca6 && kbuildsycoca6 >/dev/null 2>&1 || true
say "入れました: バージョン $(node -p "require('./package.json').version")"
case ":$PATH:" in *":$BIN:"*) say "ターミナルで bresuto と打つと開きます(メニューからも)。更新は bresuto --update" ;;
  *) say "$BIN が PATH に無いので、ターミナルでは $LAUNCH と打ってください(メニューからも開けます)" ;; esac
