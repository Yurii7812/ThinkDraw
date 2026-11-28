#!/bin/sh
# BRESUTO のスマホ用アプリ(APK)を作って、downloads/BRESUTO-memo.apk に置く(BRESUTO の「スマホにアプリを入れる」が、これを使う)
#   要: JDK 17(JAVA_HOME)と Android SDK(ANDROID_HOME)。例: JAVA_HOME=$HOME/Android/jdk ANDROID_HOME=$HOME/Android/Sdk sh android/build-apk.sh
# YuriiNote のスマホ用アプリを写して作り変えたもの(2026-11-28)
set -e
cd "$(dirname "$0")"
[ -f local.properties ] || printf 'sdk.dir=%s\n' "${ANDROID_HOME:-$HOME/Android/Sdk}" > local.properties
./gradlew --offline assembleFast || ./gradlew assembleFast
mkdir -p ../downloads && cp app/build/outputs/apk/fast/app-fast.apk ../downloads/BRESUTO-memo.apk
echo "できました: downloads/BRESUTO-memo.apk"
