#!/bin/bash
# App Store Connect にアプリを上げる（archive → 書き出し → アップロード。TestFlight にそのまま出る）
# 2026-10-17 Ronnie「3日以内にお客様がアプリを使えるように」
#
# 使い方（Mac・ios/ で）:
#   TEAM_ID=XXXXXXXXXX tools/release.sh            # ふつう（Bluetooth・USB の MFi プリンターあり。Star・EPSON の PPID が要る）
#   TEAM_ID=XXXXXXXXXX TENPO_NO_MFI=1 tools/release.sh   # MFi なし（v1.0。LAN・Wi-Fi・CloudPRNT のプリンターは使える）
#
# 前もって要るもの:
#   - Xcode > Settings > Accounts に有料の Apple Developer のチームがある（TEAM_ID はそのチームの ID・10文字）
#   - App Store Connect に「TENPO ONE」（com.tenpoone.app）のアプリがある
# ビルド番号は日時（例 202610171530）。同じ番号は二度上げられないので、毎回ちがう番号になる。
set -euo pipefail

cd "$(dirname "$0")/.."
: "${TEAM_ID:?TEAM_ID（Apple Developer のチーム ID・10文字）を入れてください}"

BUILD_NO="$(date +%Y%m%d%H%M)"
OUT="${TENPO_RELEASE_DIR:-$HOME/tenpo-build/release-$BUILD_NO}"
ARCHIVE="$OUT/TenpoOne.xcarchive"
mkdir -p "$OUT"

# プロジェクトを作り直す（MFi なしのときは Info-noMFI.plist で）
python3 tools/gen_project.py

restore() {
  # 終わったら（失敗しても）ふつうのプロジェクトに戻す（git の差分を残さない）
  TENPO_NO_MFI= python3 tools/gen_project.py >/dev/null
  rm -f App/Info-noMFI.plist
}
trap restore EXIT

echo "== archive（ビルド番号 $BUILD_NO）"
xcodebuild archive \
  -project TenpoOne.xcodeproj -scheme TenpoOne -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NO"

echo "== App Store Connect にアップロード"
OPTS="$OUT/ExportOptions.plist"
cp tools/ExportOptions-AppStore.plist "$OPTS"
/usr/libexec/PlistBuddy -c "Add :teamID string $TEAM_ID" "$OPTS"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" -exportOptionsPlist "$OPTS" -exportPath "$OUT/export" \
  -allowProvisioningUpdates

echo "== できた：ビルド $BUILD_NO を App Store Connect に上げました（処理に 10〜30 分。終わると TestFlight に出ます）"
