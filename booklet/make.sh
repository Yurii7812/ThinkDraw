#!/bin/sh
# タロット小冊子を作り直す: 組版 → ブロックの高さを測ってページを決める → 組版 → PDF(読む用・印刷用の各巻)
cd "$(dirname "$0")/.." || exit 1
E="xvfb-run -a npx electron --no-sandbox"
node booklet/build.mjs || exit 1
$E booklet/paginate.cjs || exit 1
node booklet/build.mjs || exit 1
$E booklet/render.cjs read || exit 1
N=$(node -e 'console.log(require("./booklet/out/volumes.json").length)')
i=1
while [ "$i" -le "$N" ]; do
  $E booklet/render.cjs print:$i || exit 1
  i=$((i + 1))
done
echo "できました: assets/booklet/"
