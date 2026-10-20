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
#   - ターミナル（Codex）からのアップロードは Xcode のログインが使えないことがある（2026-10-20「Failed to Use Accounts」）
#     → App Store Connect の API キーを使う：Users and Access > Integrations > API Keys で作り .p8 を保存して
#        ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-... ASC_KEY_PATH=~/AuthKey_XXXXXXXXXX.p8 を付けて実行
#     → キーが無いときは、できた .xcarchive を Xcode の Organizer で開いて Distribute App（手で）
#   - archive だけ済んでいて upload だけやり直すとき：TENPO_ARCHIVE=~/tenpo-build/release-XXXX/TenpoOne.xcarchive
# ビルド番号は日時（例 202610171530）。同じ番号は二度上げられないので、毎回ちがう番号になる。
set -euo pipefail

cd "$(dirname "$0")/.."
# （メッセージは ASCII。日本語の括弧を入れると bash が変数名と誤読して unbound variable で止まった。2026-10-20）
: "${TEAM_ID:?TEAM_ID (Apple Developer team ID, 10 chars) is required}"

# App Store Connect の API キー（あればターミナルからでもアップロードできる）
AUTH=()
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] && [ -n "${ASC_KEY_PATH:-}" ]; then
  AUTH=(-authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" -authenticationKeyPath "$ASC_KEY_PATH")
fi

if [ -n "${TENPO_ARCHIVE:-}" ]; then
  # archive は済んでいる：upload だけ
  ARCHIVE="$TENPO_ARCHIVE"
  OUT="$(dirname "$ARCHIVE")"
  BUILD_NO="$(basename "$OUT" | sed 's/^release-//')"
else
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
    -allowProvisioningUpdates "${AUTH[@]}" \
    DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NO"
fi

echo "== App Store Connect にアップロード"
OPTS="$OUT/ExportOptions.plist"
if [ ! -f "$OPTS" ]; then
  cp tools/ExportOptions-AppStore.plist "$OPTS"
  /usr/libexec/PlistBuddy -c "Add :teamID string $TEAM_ID" "$OPTS"
fi
if ! xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" -exportOptionsPlist "$OPTS" -exportPath "$OUT/export" \
  -allowProvisioningUpdates "${AUTH[@]}"; then
  echo "!! アップロードできませんでした。Xcode のログインがターミナルから使えないとき（Failed to Use Accounts）は、"
  echo "   App Store Connect の API キー（ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH）を付けるか、"
  echo "   $ARCHIVE を Xcode の Organizer で開いて Distribute App してください"
  exit 70
fi

echo "== できた：ビルド $BUILD_NO を App Store Connect に上げました（処理に 10〜30 分。終わると TestFlight に出ます）"
