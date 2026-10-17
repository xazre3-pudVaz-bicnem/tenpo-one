# TENPO ONE iPhone / iPad アプリ（アプリは1つ）

2026-09-28 Ronnie「iPhone と iPad のアプリを早く。レジは iPad、ハンディとオーナーは iPhone」
2026-10-13 Ronnie「funfo のように1つのアプリでいろいろ。まず iPad（レジ）から」→ **アプリを1つにした**

| アプリ | bundle id | 端末 |
| --- | --- | --- |
| TENPO ONE | com.tenpoone.app | iPhone・iPad（ユニバーサル） |

| 開いた端末 | 何になるか |
| --- | --- |
| iPad | **レジ**（/register-login → /app。画面を消さない。Bluetooth・USB のレシートプリンター＋ドロア） |
| iPhone | 最初に選ぶ：**ハンディ（スタッフ）**＝/handy（お店の QR でログイン）／**オーナー・店長**＝/app（売上・予約…） |
| パソコン | アプリは使わない（ブラウザの管理画面） |

- 端末の見分けは `Shared/AppConfig.swift` の `isPad`（コンパイルの印ではなく、動いている端末を見る）
- 中身は https://www.tenpo-one.com をそのまま動かす（Web を直せばアプリも変わる。アプリの出し直しは要らない）
- アプリだけの機能（`window.TenpoNative`、`lib/native-app.ts`）：本当の振動（iPhone）、通知（APNs・画面が消えていても 音＋振動）、
  QR を読む（ハンディのログイン）、アプリの使い方を変える、iPad の画面を消さない、つながらないときの再読み込み画面、
  **iPad の Bluetooth・USB レシートプリンター**（`window.TenpoNative.bluetooth`）
- User-Agent に `TenpoOneApp/<regi|handy|owner>/<version>` を付ける。サーバーは `lib/device-kind.ts` の `nativeAppMode` で見分ける
  （オーナーモードだけ、スマホでも /app を開ける）
- 通知：アプリが端末のトークンを `/api/native/push-token` に送る（`native_push_tokens`、migration 00088）。
  送るのは `lib/apns-server.ts`。Vercel の環境変数 `APNS_KEY_ID` `APNS_TEAM_ID` `APNS_PRIVATE_KEY`（Apple Developer の Keys で作る .p8）が要る

## プロジェクト
- `TenpoOne.xcodeproj` は `tools/gen_project.py` で作る（Mac に XcodeGen が無いため）。Swift のファイルを足したら
  `python3 tools/gen_project.py` を実行し直す
- 無料の Apple ID（個人のチーム）で自分の iPad・iPhone に入れて試すとき：`TENPO_NO_PUSH=1 python3 tools/gen_project.py`
  （通知の権限は有料の Apple Developer でないと署名できないので、通知だけ外す。試すだけなら問題なし）
- 署名は Automatic。Apple Developer のチームを Xcode に入れてから `DEVELOPMENT_TEAM` を入れる

## 出すまで
1. Apple Developer Program（会社：株式会社D&DREAM、¥12,980/年）に登録（Ronnie 本人）
2. Xcode の Settings > Accounts に Apple ID を入れる（Ronnie 本人）
3. App Store Connect にアプリを1つ作る（TENPO ONE・com.tenpoone.app）、APNs のキーを作って Vercel に入れる
4. `xcodebuild archive` → App Store Connect に上げる → TestFlight で確かめる → 審査に出す
   - 審査用のデモアカウント（TENPO ONE DEMO）・スクリーンショット（iPad 13インチ・iPhone 6.9インチ）・プライバシーポリシー（/privacy）
   - プライバシーマニフェスト `Shared/PrivacyInfo.xcprivacy`（追跡なし・UserDefaults CA92.1・集めるデータ）。
     App Store Connect の「App のプライバシー」も同じ答えにする
   - Star・EPSON の MFi の承認（PPID）がまだなら `TENPO_NO_MFI=1 python3 tools/gen_project.py` で作って出す
     （Bluetooth・USB の MFi プリンターだけ使えない。LAN・Wi-Fi のプリンターは使える）。PPID がそろったら、ふつうに作って出し直す

## レシートプリンター（＋ドロア）を iPad と Bluetooth・USB でつなぐ（2026-10-13〜。Ronnie の iPad に入れて試し中）
Ronnie「レシートプリンター＋ドロアは iPad と Bluetooth、チケットプリンターは LAN・Wi-Fi。ESC/POS・Star・RP-F10 を選べるように。Airレジ・funfo と同じ」

| 種類 | SDK | つなぎ方 | 送るもの |
| --- | --- | --- | --- |
| Star（mC-Print3 など） | StarXpand SDK（Swift Package `StarIO10`。gen_project.py が入れる） | Bluetooth・USB | StarPRNT |
| EPSON（TM-m30III など） | **要らない**：iPad とペアリングすると External Accessory（`com.epson.escpos`）で見えるので、そこへ ESC/POS をそのまま送る（#260）。ePOS SDK を `ios/Vendor/libepos2.xcframework` に置けば SDK でも探す（`EPSON_SDK`） | Bluetooth・USB | ESC/POS |
| SII（RP-F10 など） | SII の SDK（未。入れるまでは Bluetooth LE で試す） | Bluetooth・USB | ESC/POS |
| そのほか ESC/POS | なし（CoreBluetooth・BLE） | Bluetooth LE | ESC/POS |

- Web 側：レジの設定「このiPadのプリンター」→「プリンターを探す」→ 選ぶ → 試し印刷・ドロア（`components/pos/device-printer-panel.tsx`）。
  印刷は `components/printing/direct-print-agent.tsx` が `/api/print/direct`（next-bt）で受け取り、`window.TenpoNative.bluetooth.print` に渡す
- アプリ側：`ios/Shared/BluetoothPrinters.swift`、ブリッジは `WebViewController.swift`（btDiscover / btPrint → `window.__tenpoNativeReply`）
- Info.plist（App/Info.plist）：`UISupportedExternalAccessoryProtocols`（jp.star-m.starpro・com.epson.escpos）、`NSBluetoothAlwaysUsageDescription`
- **App Store に出すとき**：Bluetooth・USB（MFi）のアプリは各社の承認が要る（EPSON：フォーム → 約5営業日で PPID → 審査メモに書く。Star・SII も申請）
- 自分の iPad で試すだけなら、無料の Apple ID で Xcode から入れられる（7日ごとに入れ直し）
- ネイティブのオーダー・会計（試験中）は Web の上に**重ねて**出す（fullScreenCover にすると下の Web が「見えない」扱いで止まり、
  Bluetooth のレシート・ドロアの印刷＝DirectPrintAgent が出なくなる。#260）
