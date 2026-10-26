#!/bin/bash
# App Store Connect にアプリを上げる（archive → 書き出し → アップロード。TestFlight にそのまま出る）
# 2026-10-17 Ronnie「3日以内にお客様がアプリを使えるように」
#
# 使い方（Mac・ios/ で）:
#   TEAM_ID=XXXXXXXXXX tools/release.sh            # ふつう（Bluetooth・USB の MFi プリンターあり。Star・EPSON の PPID は 2026-10-26 にそろった）
#   TEAM_ID=XXXXXXXXXX TENPO_UPLOAD=0 tools/release.sh   # 上げない：archive と書き出し（.ipa）だけ。MFi の宣言を確かめてから上げるとき
#   TEAM_ID=XXXXXXXXXX TENPO_NO_MFI=1 tools/release.sh   # MFi なし（v1.0・1.1 で使った。今は使わない）
#
# MFi ありのときは、できた archive（と書き出した .ipa）の Info.plist に UISupportedExternalAccessoryProtocols
# （jp.star-m.starpro・com.epson.escpos）が入っているか確かめ、無ければ止める（審査メモの PPID と食い違わないように）
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
  # ビルド番号は archive から（フォルダ名 release-mfi-… からだと「mfi-…」と出た）
  BUILD_NO="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist" 2>/dev/null || basename "$OUT" | sed -E 's/^release-(mfi-)?//')"
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
    -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} \
    DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NO"
fi

# MFi の宣言（Star・EPSON の外部アクセサリーのプロトコル）が入っているか（MFi なしのときは入っていないか）
check_mfi() {
  local plist="$1" where="$2" got
  got="$(/usr/libexec/PlistBuddy -c 'Print :UISupportedExternalAccessoryProtocols' "$plist" 2>/dev/null || true)"
  if [ "${TENPO_NO_MFI:-}" = "1" ]; then
    if [ -n "$got" ]; then echo "!! $where: TENPO_NO_MFI=1 but UISupportedExternalAccessoryProtocols is present"; exit 71; fi
    echo "== $where: MFi なし（UISupportedExternalAccessoryProtocols なし）"
    return
  fi
  for p in jp.star-m.starpro com.epson.escpos; do
    if ! printf '%s\n' "$got" | grep -qx "[[:space:]]*$p"; then
      echo "!! $where: UISupportedExternalAccessoryProtocols に $p がありません"; exit 71
    fi
  done
  if ! /usr/libexec/PlistBuddy -c 'Print :NSBluetoothAlwaysUsageDescription' "$plist" >/dev/null 2>&1; then
    echo "!! $where: NSBluetoothAlwaysUsageDescription がありません"; exit 71
  fi
  echo "== $where: MFi の宣言 OK（jp.star-m.starpro・com.epson.escpos・Bluetooth の説明）"
}
APP_DIR="$ARCHIVE/Products/Applications/TenpoOne.app"
check_mfi "$APP_DIR/Info.plist" "archive"
if [ "${TENPO_NO_MFI:-}" != "1" ] && [ ! -d "$APP_DIR/Frameworks/StarIO10.framework" ]; then
  echo "!! archive: StarIO10.framework（StarXpand SDK）が入っていません"; exit 71
fi

OPTS="$OUT/ExportOptions.plist"
if [ ! -f "$OPTS" ]; then
  cp tools/ExportOptions-AppStore.plist "$OPTS"
  /usr/libexec/PlistBuddy -c "Add :teamID string $TEAM_ID" "$OPTS"
fi

if [ "${TENPO_UPLOAD:-1}" = "0" ]; then
  # 上げない：.ipa を書き出して中の Info.plist も確かめる（上げるのは確かめてから、TENPO_ARCHIVE=… でもう一度）
  LOCAL_OPTS="$OUT/ExportOptions-local.plist"
  cp "$OPTS" "$LOCAL_OPTS"
  /usr/libexec/PlistBuddy -c "Set :destination export" "$LOCAL_OPTS"
  echo "== 書き出し（上げない）"
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" -exportOptionsPlist "$LOCAL_OPTS" -exportPath "$OUT/export" \
    -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}
  IPA="$(ls "$OUT"/export/*.ipa | head -1)"
  TMP_PLIST="$OUT/export/Info-from-ipa.plist"
  unzip -p "$IPA" 'Payload/*.app/Info.plist' > "$TMP_PLIST"
  check_mfi "$TMP_PLIST" "ipa"
  echo "== できた（上げていない）：ビルド $BUILD_NO  $IPA"
  echo "   上げるとき：TEAM_ID=$TEAM_ID TENPO_ARCHIVE=$ARCHIVE tools/release.sh"
  exit 0
fi

echo "== App Store Connect にアップロード"
if ! xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" -exportOptionsPlist "$OPTS" -exportPath "$OUT/export" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}; then
  echo "!! アップロードできませんでした。Xcode のログインがターミナルから使えないとき（Failed to Use Accounts）は、"
  echo "   App Store Connect の API キー（ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH）を付けるか、"
  echo "   $ARCHIVE を Xcode の Organizer で開いて Distribute App してください"
  exit 70
fi

echo "== できた：ビルド $BUILD_NO を App Store Connect に上げました（処理に 10〜30 分。終わると TestFlight に出ます）"
