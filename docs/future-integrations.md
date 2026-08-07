# 外部連携の状態表

CLAUDE.mdの「正直表示」方針（未実装の外部連携を「対応済み」と表示しない）に基づき、各連携の
実装状況を明記する。詳細設計は個別ドキュメント、抽象化ポイントは実装コードへのリンクを併記する。

| 連携 | 状態 | 抽象化ポイント / 実装箇所 |
|---|---|---|
| **決済（Stripe）** | **基盤実装済み・本番接続未実施** | `lib/payments/`（`PaymentProviderAdapter`インターフェース）、`lib/payments/stripe.ts`（Stripe実装）、`app/api/webhooks/stripe/route.ts`。テストモードキー・シミュレーテッドリーダーで検証済み（`scripts/verify-stripe.mjs`）。実店舗のカードリーダー登録・本番キー切替は未実施 |
| 決済（Square/Airpay/Stera/Paygate） | 未実装・抽象化ポイントあり | `lib/payments/types.ts`の`PaymentProviderName`型に列挙のみ。`lib/payments/index.ts`の`ADAPTERS`に未登録。`PaymentProviderAdapter`を実装するアダプタファイルを追加し登録すれば接続可能 |
| SaaS課金（サブスクリプション） | 設計のみ・未接続 | `saas_subscriptions`テーブル（`00007_payments_stripe.sql`）。Stripe Billing想定のカラム（`provider_subscription_id`等）はあるが決済連携なし。書込はCYPRESS運営限定 |
| レシート・キッチンプリンター | 未実装・抽象化ポイントあり | `printer_configs`（機種・接続方式・IPアドレス等の設定）、`print_jobs`（印刷キュー、`status: queued→printed`）。現状`target='browser'`のブラウザ印刷のみ実装（`app/app/settings/printers/actions.ts`の`createTestPrint`）。実機SDK（Epson/Star等）への接続は未実装 |
| LINE公式アカウント連携 | 未実装・マスタのみ | `reservation_sources`にLINE（`line`）がグローバルマスタとして登録済み（予約経路の記録用選択肢）。LINE Messaging API等での自動通知・予約連携は未実装 |
| グルメサイト連携（食べログ等） | 未実装・マスタのみ | `reservation_sources`に`gourmet_site`が登録済み（記録用選択肢のみ）。外部サイトからの自動予約取込・在庫連携APIは未実装 |
| Google連携（予約・マップ） | 未実装・マスタのみ | `reservation_sources`に`google`が登録済み。Reserve with Google等のAPI連携は未実装 |
| 会計ソフト連携（freee等） | 未実装 | `invoices`/`expenses`/`vendors`は自前実装。freee API等へのエクスポート・同期機能は無く、CSV手動エクスポート（`app/app/invoices/export/route.ts`等）が現状の連携手段 |
| 勤怠・給与ソフト連携（KING OF TIME等） | 未実装 | 打刻・勤怠は自前実装（`apply_punch` RPC）。外部勤怠システムとの同期APIは無く、CSVエクスポート（`app/app/attendance/export/route.ts`, `app/app/payroll/[runId]/export/route.ts`）が現状の連携手段 |
| 請求書・領収書OCR | 未実装 | `documents.ocr_status`列（`none/pending/done/failed`）と`ocr_payload jsonb`は下地として存在し、常に`'none'`固定。実際のOCR処理（Google Document AI等）は未接続 |
| メール通知 | 未実装・抽象化ポイントのみ | `notifications`テーブル（アプリ内通知ベル）は実装済み。メール送信の抽象化層（`lib/notify.ts`想定、`docs/open-questions.md`項目15）はコード上未作成で、実プロバイダー（Resend等）との契約・実装が必要 |

## Stripeの詳細ステータス

「基盤実装済み・本番接続未実施」の内訳:

- 実装済み: `PaymentProviderAdapter`抽象化、Terminal（対面カード決済、simulated readerで検証）、
  Checkout（予約の事前決済/予約金）、Webhook受信+冪等化（`webhook_events`）、返金
- 未実施: 本番Stripeアカウントの`STRIPE_SECRET_KEY`（`sk_live_`）への切替、実機カードリーダーの
  登録・現地検証、SaaS Billing（サブスクリプション課金）、Stripe Connect（該当があれば）
- 詳細な設計判断（Checkout vs Elements、Terminal vs オンライン決済の使い分け等）は
  既存の`docs/payment-stripe.md`を参照

## プリンターSDKの抽象化ポイント

現状は`print_jobs.target='browser'`のみを実装しているが、`printer_configs`に接続方式
（`connection_type`）・IPアドレス・用紙幅等の設定項目が既にあるため、将来的に
`target='network_printer'`等を追加し、`print_jobs`をポーリングまたはRealtime購読する
プリンタードライバー側の実装を追加すれば拡張できる設計になっている。

## 判断の指針

新しい外部連携を追加する際は、まず本表に「未実装・抽象化ポイントあり/なし」を明記し、
実装が完了するまで画面上に「対応済み」と表示しないこと（CLAUDE.mdの正直表示方針）。
