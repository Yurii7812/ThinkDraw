#!/bin/sh
# ウェイト版タロット解説書を作り直す: 組版 → ブロックの高さを測ってページを決める → 組版 → PDF(2 つの版の読む用と、印刷用の各巻)
cd "$(dirname "$0")/.." || exit 1
E="xvfb-run -a npx electron --no-sandbox"
node booklet/build.mjs >/dev/null || exit 1
for ed in full upright; do $E booklet/paginate.cjs $ed || exit 1; done
node booklet/build.mjs || exit 1
for ed in full upright; do
  $E booklet/render.cjs read:$ed || exit 1
  N=$(node -e "console.log(require('./booklet/out/editions.json').$ed.vols.length)")
  i=1
  while [ "$i" -le "$N" ]; do
    $E booklet/render.cjs print:$ed:$i || exit 1
    i=$((i + 1))
  done
done
echo "できました: assets/booklet/"
