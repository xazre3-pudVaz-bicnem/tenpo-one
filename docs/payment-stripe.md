# 決済基盤設計 — Stripe（第一対応プロバイダー）

## 方針

```
TENPO ONE（注文・予約・会計の業務データ）
   │  payment_provider 抽象化レイヤー（lib/payments/）
   ├─ Stripe（第一対応: Payments / Terminal / Checkout / Webhooks / 将来Billing・Connect）
   └─ 将来: Square / AirPAY / stera / PAYGATE
```

- TENPO ONE本体はStripe固有APIへ**直接依存しない**。全決済操作は `lib/payments/types.ts` の
  `PaymentProviderAdapter` インターフェース経由で行い、Stripeは実装のひとつ（`lib/payments/stripe.ts`）
- DB側もプロバイダー非依存の `payment_intents` / `terminal_readers` / `webhook_events` を持ち、
  Stripe固有IDは `provider_*` カラムへ保存する
- **カード番号・CVC・磁気/IC情報は一切TENPO ONEに保存しない**（StripeのトークンとIDのみ）
- 本番キーは使用しない。Test Mode（`sk_test_...`）+ Terminal simulated reader で検証し、
  実機検証が完了するまで画面上「本番対応済み」と表示しない

## 想定用途と対応フェーズ

| 用途 | 使用するStripe機能 | フェーズ |
|---|---|---|
| 1. POS対面決済 | Terminal（PaymentIntent + Reader） | 今回（simulated） |
| 2. 予約時の事前決済/予約金 | Checkout（hosted） | 今回（Test Mode） |
| 3. キャンセル料 | Checkout / Payment Links | 今回は設計+データ構造 |
| 4. オンライン決済リンク | Checkout Session URL共有 | 今回は設計+データ構造 |
| 5. TENPO ONE SaaS利用料 | Billing（Subscription） | 設計のみ（別ドメイン） |
| 6. 導入企業ごとの決済管理 | Connect（connected accounts） | 設計のみ |

## Checkout vs Elements の比較と決定

| 観点 | Stripe Checkout（hosted） | Stripe Elements（埋め込み） |
|---|---|---|
| PCI DSS範囲 | SAQ-A（最小） | SAQ-A-EP（要件増） |
| 実装・保守コスト | 低（UI保守不要・3DS/ウォレット自動対応） | 中〜高（UI実装・更新追随） |
| UX | Stripeホスト画面へ遷移（モバイル最適化済・日本語対応） | 自社ページ内で完結 |
| ブランド統一 | ロゴ・カラー設定可（限定的） | 完全に自由 |

**決定: 予約事前決済・キャンセル料・決済リンクは Checkout を採用する。**
理由: 公開予約ページの決済は発生頻度がPOSより低く、保守コスト最小・PCI範囲最小・
コンビニ/ウォレット等の決済手段自動追随のメリットが大きい。ブランド埋め込みが必要になった
段階でElementsへ差し替えられるよう、アダプター境界（`createCheckoutSession`）の内側に隠蔽する。
POS対面決済はどちらも使わず Terminal API（サーバー駆動）を用いる。

## データモデル（migration 00007）

```
payment_providers   … 企業ごとのプロバイダー有効化・非秘密設定
  (organization_id, provider['stripe'|...], mode['test'|'live'], is_active, config jsonb)
  ※ Secret Key はDBに保存しない（環境変数のみ）。Connect移行時は config.stripe_account_id を使用

terminal_readers    … 決済端末（店舗ごと）
  (organization_id, store_id, provider, provider_reader_id, label, device_type,
   is_simulated, status['online'|'offline'|'unknown'], last_seen_at)

payment_intents     … プロバイダー決済の台帳（TENPO ONE側の真実）
  (organization_id, store_id, provider, purpose['pos_charge'|'booking_prepay'|'booking_deposit'
     |'cancellation_fee'|'payment_link'],
   order_id?, reservation_id?, customer_id?, amount(円), currency='jpy',
   status['created'|'processing'|'requires_action'|'succeeded'|'failed'|'canceled'|'refunded'],
   provider_payment_intent_id UNIQUE, provider_charge_id, provider_customer_id,
   provider_checkout_session_id, reader_id?, idempotency_key UNIQUE, error_message, metadata)

webhook_events      … Webhook受信の冪等化台帳
  (provider, event_id, UNIQUE(provider,event_id), event_type, payload, status, error)

payments  += provider, provider_payment_intent_id, provider_charge_id
refunds   += provider_refund_id
store_settings += booking_payment_mode['onsite'|'prepay_full'|'deposit'],
                  booking_deposit_amount, cancellation_fee_policy jsonb

saas_subscriptions  … SaaS課金（POS売上と完全分離した別ドメイン）
  (organization_id UNIQUE, provider, provider_customer_id, provider_subscription_id,
   plan_code, status, current_period_start/end)
```

**分離原則**: `payment_intents`（店舗の売上に関わる金）と `saas_subscriptions`
（TENPO ONE自身の利用料）はテーブル・用途・Stripeアカウント文脈を分ける。
将来Connect導入時は前者がconnected account、後者がプラットフォームアカウントで処理される。

## POS対面決済フロー（Stripe Terminal・サーバー駆動）

```
POS会計モーダル「カード端末で決済」
→ [server] recalc_order_totals で金額確定
→ [server] payment_intents 行を作成（idempotency_key = pos:{order_id}:{amount}）
→ [Stripe] paymentIntents.create({ amount, currency:'jpy',
     payment_method_types:['card_present'] }, { idempotencyKey })
→ [Stripe] terminal.readers.processPaymentIntent(reader, intent)
→ 端末でカード/対応決済手段の支払い
   （simulated readerでは testHelpers.terminal.readers.presentPaymentMethod で擬似提示）
→ 成功確認は2経路（両方が payment_intents.status を更新・冪等）
   a) Webhook payment_intent.succeeded
   b) POSのポーリング action がStripeへ照会
→ [server] confirm action: intent succeeded を確認後 finalize_order RPC
   （payments[{method:'credit'}] → 売上/顧客履歴/スタッフ実績/在庫/レジ/予約/テーブル一括連動）
→ payments 行へ provider_payment_intent_id / charge_id を記録
→ レシート → レジ締め → レポート（既存フローに合流）
```

### 二重決済防止（idempotency）

1. `payment_intents.idempotency_key` はDB UNIQUE。同一注文×同一金額の再試行は既存行を再利用し、
   Stripeへも**同じidempotencyKey**を渡す（Stripe側で同一リクエストと判定され新規決済は発生しない）
2. 金額が変わった場合はキーが変わる（新intent）。旧intentは cancel する
3. `finalize_order` は status='open' 以外を拒否するため、Webhookと画面操作が競合しても会計の二重確定は不可能
4. Webhookは `webhook_events(provider,event_id)` UNIQUE への insert が成功した場合のみ処理
   （同一イベント再送は on conflict でスキップ）
5. 返金もStripe呼び出しに `refund:{refund用キー}` のidempotencyKeyを付与

### 障害時の挙動

- 端末エラー/客のキャンセル → intent canceled、注文は open のまま（現金等の他手段で会計可能）
- 決済成功後にPOS画面が閉じた → 注文は open のまま intent succeeded が残る。POS再表示時に
  「決済済み・会計確定待ち」を検出して確定操作を案内（confirm action は何度実行しても冪等）

## 予約オンライン決済（Checkout）

店舗設定 `booking_payment_mode`:

- `onsite`（既定）… 現地払いのみ。従来どおり
- `prepay_full` … 予約時全額決済（コース選択時: コース価格×人数）
- `deposit` … 予約金のみ（`booking_deposit_amount` × 人数）

フロー: 予約作成（既存RPC）→ サーバーで Checkout Session 作成
（metadata: reservation_id / purpose、success_url=/booking/{code}?paid=1）→ Stripeホスト画面で決済
→ Webhook `checkout.session.completed` / `payment_intent.succeeded` で payment_intents を succeeded へ
→ 台帳・予約詳細に「事前決済済み」表示。キャンセル料は同じ仕組みで `cancellation_fee` purposeの
Checkout Session URLを顧客へ送る（リンク決済）。

※ Test Mode段階では「未決済なら予約を自動キャンセルする」等の強制は行わない（設計のみ・doc記載）。

## Webhook設計（/api/webhooks/stripe）

- 署名検証必須: `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`。失敗は400
- 冪等化: `webhook_events` へ (provider, event.id) を挿入。重複はスキップして200
- 処理対象イベント:
  - `payment_intent.succeeded` → payment_intents.status='succeeded'、charge_id記録
  - `payment_intent.payment_failed` → status='failed'、error_message記録
  - `payment_intent.canceled` → status='canceled'
  - `charge.refunded` → status='refunded'、対応する refunds 行に provider_refund_id
  - `checkout.session.completed` → session→intent紐付けの補完
- 未対応イベントは記録のみで200（Stripeの再送を防ぐ）
- 常に200/400を返しビジネス処理の失敗は `webhook_events.status='failed'` に隔離（Stripe再送に依存しない）

## SaaS課金（Stripe Billing・設計のみ）

- 対象: 初期費用（一回性 Invoice Item）/ 月額基本料（Subscription）/ 店舗追加（数量ベースの
  Subscription Item, quantity=店舗数）/ オプション（追加Subscription Item）
- `plans.code` ↔ Stripe Price ID のマッピングを `plans.features.stripe_price_id` に保持
- 契約企業 = Stripe Customer（`saas_subscriptions.provider_customer_id`）
- 支払い状態のWebhook（`invoice.paid` / `invoice.payment_failed`）で `organizations.status` を
  trial/active/suspended へ連動（滞納時の機能制限）
- POS決済とはStripeアカウント文脈もテーブルも分離（上記データモデル参照）

## 環境変数

| 変数 | 場所 | 備考 |
|---|---|---|
| `STRIPE_SECRET_KEY` | サーバーのみ | `sk_test_...` から開始。**NEXT_PUBLIC禁止** |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | 公開可 | 将来のElements用（Checkoutのみなら未使用でも可） |
| `STRIPE_WEBHOOK_SECRET` | サーバーのみ | Webhookエンドポイント署名シークレット |

## Stripe Dashboard 設定手順（Test Mode）

1. アカウント作成 → Test Mode に切替
2. Developers → API keys から `sk_test_` を取得し環境変数へ
3. Developers → Webhooks → Add endpoint: `https://<ドメイン>/api/webhooks/stripe`
   （ローカルは `stripe listen --forward-to localhost:3000/api/webhooks/stripe`）
   イベント: payment_intent.succeeded / payment_intent.payment_failed / payment_intent.canceled /
   charge.refunded / checkout.session.completed → Signing secret を環境変数へ
4. Terminal → Locations を作成（simulated readerは location 不要で登録可能）
5. 検証: `node --env-file=.env.local scripts/verify-stripe.mjs`
   （simulated reader登録 → PaymentIntent → 擬似カード提示 → succeeded → 返金 まで自動確認）

## 実機Terminal導入時に必要な作業（将来）

- 日本対応のStripe Terminal読取機（例: Stripe Reader S700 / BBPOS WisePOS E の国内提供状況を契約時に確認）の調達
- Terminal Location の住所登録と reader のペアリング（登録コード）
- 店舗ネットワーク（TLS通信可能なWi-Fi）とファームウェア自動更新の運用確認
- `terminal_readers.is_simulated=false` の実機で決済〜返金〜日次締めの実機E2E
- 完了までUI上は「テストモード/未検証」表示を維持する
```
