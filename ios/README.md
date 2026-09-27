# TENPO ONE iPhone / iPad アプリ

2026-09-28 Ronnie「iPhone と iPad のアプリを早く。レジは iPad、ハンディとオーナーは iPhone」

| target | 端末 | 名前 | bundle id | 中身 |
| --- | --- | --- | --- | --- |
| Regi | iPad | TENPO ONE レジ | com.tenpoone.regi | レジ。/register-login でログイン → /app。画面を消さない |
| Handy | iPhone | TENPO ONE | com.tenpoone.handy | 最初に「ハンディ（スタッフ）」か「オーナー・店長」を選ぶ |

- 中身は https://www.tenpo-one.com をそのまま動かす（Web を直せばアプリも変わる。アプリの出し直しは要らない）
- アプリだけの機能（`window.TenpoNative`、`lib/native-app.ts`）：本当の振動（iPhone）、通知（APNs・画面が消えていても 音＋振動）、
  QR を読む（ハンディのログイン）、アプリの使い方を変える、iPad の画面を消さない、つながらないときの再読み込み画面
- User-Agent に `TenpoOneApp/<regi|handy|owner>/<version>` を付ける。サーバーは `lib/device-kind.ts` の `nativeAppMode` で見分ける
  （オーナーモードだけ、スマホでも /app を開ける）
- 通知：アプリが端末のトークンを `/api/native/push-token` に送る（`native_push_tokens`、migration 00088）。
  送るのは `lib/apns-server.ts`。Vercel の環境変数 `APNS_KEY_ID` `APNS_TEAM_ID` `APNS_PRIVATE_KEY`（Apple Developer の Keys で作る .p8）が要る

## プロジェクト
- `TenpoOne.xcodeproj` は `tools/gen_project.py` で作る（Mac に XcodeGen が無いため）。Swift のファイルを足したら
  `python3 tools/gen_project.py` を実行し直す
- 署名は Automatic。Apple Developer のチームを Xcode に入れてから `DEVELOPMENT_TEAM` を入れる

## 出すまで
1. Apple Developer Program（会社：株式会社D&DREAM、¥12,980/年）に登録（Ronnie 本人）
2. Xcode の Settings > Accounts に Apple ID を入れる（Ronnie 本人）
3. App Store Connect にアプリを2つ作る（TENPO ONE レジ／TENPO ONE）、APNs のキーを作って Vercel に入れる
4. `xcodebuild archive` → App Store Connect に上げる → TestFlight で確かめる → 審査に出す
   - 審査用のデモアカウント（TENPO ONE DEMO）・スクリーンショット（iPad 13インチ・iPhone 6.9インチ）・プライバシーポリシー（/privacy）
