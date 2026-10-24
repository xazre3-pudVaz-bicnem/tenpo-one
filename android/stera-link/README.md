# TENPO ONE 連携（stera terminal 用 Android アプリ）

stera terminal の中で動く小さなアプリ。レジ（TENPO ONE の iPad／Web）で「stera で決済」を押すと、
金額がこの端末に届き、stera 標準の決済アプリが開いて決済 → 結果がレジに戻って会計が確定し、ドロアが開く。

```
iPad レジ ──「stera で決済」──▶ TENPO ONE サーバー（stera_payment_requests）
                                      ▲   │ GET /api/stera/<リンクコード>（1〜2秒ごと）
                                      │   ▼
                      POST 結果 ──── このアプリ ──Intent──▶ stera 標準決済アプリ
```

- サーバー側・レジ側は実装済み：`lib/stera.ts`・`lib/stera-server.ts`・`app/api/stera/[code]/route.ts`・
  `app/app/pos/stera-actions.ts`・`components/pos/stera-pay-panel.tsx`・`ios/Shared/NativeCheckoutView.swift`
- 端末の登録（リンクコード発行）：管理画面の **設定 ＞ 決済・端末 ＞ stera 連携**（レジの iPad からは変えられない）
- LAN・IP アドレスは使わない。端末はインターネットに出られればよい（stera terminal は決済のため常時つながっている）

## 画面

1. リンクコード（12文字。`ABCD-EFGH-JKLM` の形で表示）とサーバー（既定 `https://www.tenpo-one.com`）を入れて **つなぐ**
2. 「レジからの会計を待っています」＋ 店舗名・端末名 が出れば OK（管理画面の stera 連携が「つながっています」になる）
3. レジで「stera で決済」→ 金額と支払種別が出て、決済アプリが自動で開く → 完了するとレジへ結果が送られる
4. **練習モードで決済する**（チェック）：検証用端末・練習用。`TransactionMode="2"` で呼ぶのでお金は動かない

## 決済アプリとの連携（公開仕様）

stera developers「[決済アプリと連携する](https://www.smbc-card.com/steradevelopers/develop/kessai.jsp)」のとおり。

- Intent：`com.panasonic.smartpayment.android.salesmenu` / `.MainActivity` を `startActivityForResult`
- extras（すべて文字列）：`TransactionMode`（1=通常, 2=練習）`TransactionType`（1=売上）`Amount` `Tax` `PaymentType`（01 / 02-01〜02-07 / 03）`SlipNumber`（5桁）
- 戻り：`PaymentType` `ErrorCode`（エラー時 `FFFFFFFF`、無ければ空）`SlipNumber` `Amount` `CreditCardBrand` `CreditCardMaskedPAN` `EMoneyType` `QRPayType` など
  → そのまま `extras` としてサーバーへ POST（サーバー側 `interpretSteraResult` が受け取ってよい項目だけ残し、カード番号は再マスク）

**成功の判定は厳しめ**：`ErrorCode` が空 **かつ** `resultCode == RESULT_SUCCESS` のときだけ `SUCCESS`。
それ以外は `CANCEL` / `FAIL`（レジは SUCCESS のときだけ会計を確定するため、取れていないお金を成功にしない）。

> **要実機確認**：公開ページのサンプルは `MainActivity.SUCCESS / FAIL / CANCEL` と比べているが値は非公開。
> `MainActivity.kt` の `RESULT_SUCCESS`（仮 = `Activity.RESULT_OK` = -1）/ `RESULT_CANCEL`（仮 = 0）を、
> 検証用端末で返ってきた `resultCode`（サーバーの `stera_payment_requests.result.resultCode` に残る）に合わせて直す。
> stera market の「おむすび」サンプルアプリにも定義がある。

## 守っていること

- 結果は届くまで消さない：POST に失敗したら `Prefs.pendingResult` に残し、つながり次第、新しい依頼より先に送り直す
- 決済アプリを呼んだまま戻らなかった（アプリが落ちた・再起動）→ `FAIL` + `ErrorCode=LOST_RESULT` で返す。端末の決済アプリの取引履歴で確認する
- 同じ依頼を2回呼ばない（サーバーが `queued → sent` で1回しか渡さない）
- 画面を消さない（`FLAG_KEEP_SCREEN_ON`）。ポーリングは画面が前にある間だけ（決済アプリが前の間は止まる）

## ビルド

- minSdk 27（stera terminal standard = Android 8.1）/ targetSdk 29（stera terminal mobile = Android 10）/ compileSdk 34
- 依存は AndroidX appcompat・core-ktx だけ（Google Play 開発者サービスは使わない）

```sh
cd android/stera-link
# Android Studio で開く（Gradle 8.7 / AGP 8.5.2 / Kotlin 1.9.24）か、
ANDROID_HOME=<SDK> gradle assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
```

リリース（stera market 提出用）は自社の keystore **だけ**で署名する（ストア署名を付けない。更新は同じ keystore）：
stera developers「[アプリ配信のための署名](https://www.smbc-card.com/steradevelopers/develop/signature.jsp)」。

## stera market に載せるまで（公式の流れ）

1. **新規参画申請** https://support.smbc-card.com/inq/webinq_VF_SteraJoinEntry ＋ **ユーザー登録** https://tms02.mdmsv.panasonic.com/aps1p/t1/appp01050/developer
2. stera market サイトにログイン → 開発ガイドライン・SDK・デザインガイドライン・署名ツールを取得
3. 三井住友カードの担当者から「手数料等の定め」など申込書類の案内 → 返送（無料アプリなら加盟店申込書・PG申込書は不要）
4. **検証用端末の貸与**（原則1ヶ月。USB でこの apk を直接入れられる）→ 実機で決済アプリ連携を確認し `RESULT_*` を直す
5. 公開申請（apk・アイコン・スクリーンショット最大5枚・アクティベート情報2端末分・パッケージ名 `com.tenpoone.steralink`・ハッシュ値）
6. 審査（約10営業日）→ 掲載 → 各店の stera terminal に stera market からインストール（ダウンロード申請）

POS連動（仕様書による直接連動）は別ルート：`pos_stera@gmo-fg.com` 宛に「【POS連動希望】株式会社D&DREAM」。

## 実機テストのチェック（検証用端末）

- [ ] リンクコードを入れて「つながりました」→ 管理画面の stera 連携が「つながっています」
- [ ] レジ「stera で決済」→ 端末に金額が出て決済アプリが開く（約1〜2秒）
- [ ] 練習モードで クレジット / 交通系IC / QR の3種類 → レジが会計を確定し、ドロアが開く・レシートが出る
- [ ] 端末側でキャンセル → レジに「キャンセル」が戻る
- [ ] レジ側でキャンセル（端末が受け取る前）→ 端末に金額が出ない
- [ ] 決済中に Wi-Fi を切る → 復帰後に結果が送られる（「結果をレジへ送れていません」→「送りました」）
- [ ] `resultCode` の実際の値を確認して `RESULT_SUCCESS` / `RESULT_CANCEL` を直す
