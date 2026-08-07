# アーキテクチャ概要

最新実装（STEP 25-26時点、migrations 00001〜00014）に基づく技術構成。個別テーブルの詳細は
`docs/database.md`、権限は `docs/permissions.md`、テナント分離の実装は `docs/tenant-isolation.md` を参照。

## 技術スタック

| 領域 | 技術 |
|---|---|
| フロントエンド | Next.js 16 (App Router) / TypeScript / Tailwind CSS v4 |
| UI | 自作UIキット（`components/ui`）/ lucide-react / Recharts |
| フォーム・検証 | React Hook Form / Zod |
| バックエンド | Supabase（PostgreSQL / Auth / Storage / Realtime / RLS） |
| 決済 | Stripe（`stripe` SDK, テストモード） |
| テスト | Vitest（`tests/*.test.ts`、純関数の単体テスト）/ Playwright（`e2e/`、要Supabase環境） |
| デプロイ | Vercel |

依存パッケージのバージョンは `package.json` を参照（Next 16 / React 19 / Supabase JS 2.58 / Stripe 22 / Zod 4）。

## ディレクトリ構成

```
app/
  (public)/        # LP・料金・法務・公開予約（/book/[storeSlug], /booking/[code]）
  (auth)/          # ログイン・パスワード再設定
  app/              # 業務画面（/app/*, requireSession + requireMember 必須）
  admin/            # CYPRESS運営コンソール（/admin/*, requireCypressAdmin 必須）
  order/[storeSlug]/[tableToken]/  # QRオーダー（匿名・トークン制、requireSession不要）
  api/webhooks/stripe/route.ts     # Stripe Webhook（唯一の app/api ルート）
components/
  ui/               # 汎用UIキット
  layout/           # Sidebar・TopBar・StoreSwitcher 等シェル
  kitchen/          # KDSボード
  qr-order/         # QRオーダー客側UI
  <feature>/        # 機能別コンポーネント
lib/                # ドメインロジック（純関数）・auth・permissions・features・payments
supabase/migrations/  # スキーマ・RLS・RPC（唯一の正式なDB定義）
scripts/            # seed.mjs / verify-flow.mjs / verify-stripe.mjs
docs/               # 本ディレクトリ
tests/              # Vitest（lib/ の純関数を検証）
e2e/                # Playwright（Supabase実環境が前提）
```

CSVエクスポートは `app/api/**` ではなく `app/app/**/export/route.ts` として各機能配下に同居している
（例: `app/app/orders/export/route.ts`）。外部から叩かれる公開APIではなく、ログイン中ユーザーの
ブラウザダウンロード用ルートのため。

## レイヤー構成

1. **公開ページ**（`(public)`）— 未ログイン。LP・料金・法務・公開予約。予約系は匿名 RPC のみ
   （`get_booking_store` / `get_booking_availability` / `create_public_reservation` /
   `get_public_reservation` / `cancel_public_reservation`、いずれも `supabase/migrations/00002_functions.sql`
   で `SECURITY DEFINER` かつ `anon, authenticated` に GRANT）。
2. **QRオーダー**（`app/order/[storeSlug]/[tableToken]`）— 匿名・テーブル単位トークン制。
   詳細は `docs/qr-order.md`。
3. **業務画面**（`app/app/*`）— `app/app/layout.tsx` が `requireSession()` を呼び、未ログインは
   `/login` へ、org未所属の cypress_admin は `/admin/organizations` へ、org_owner/hq_admin で
   `organizations.onboarding.completed` が false なら `/app/onboarding` へリダイレクトする。
   サイドバーは `lib/nav.ts` のナビ定義を `lib/permissions.ts`（ロール）と `lib/features.ts`
   （機能フラグ）の両方でフィルタして表示する。
4. **運営コンソール**（`app/admin/*`）— `app/admin/layout.tsx` が `requireCypressAdmin()` を呼ぶ。
   店舗切替なし・org非依存。契約企業作成、機能フラグ、サポートアクセス、監査ログ横断検索を提供。
5. **RPC層**（`supabase/migrations/00002〜00013`）— トランザクション整合性が必要な処理
   （会計確定・返金・レジ開閉・打刻・在庫入荷・QRオーダー）はすべて `SECURITY DEFINER` の
   PostgreSQL関数として実装し、Server Action からは `supabase.rpc(...)` で呼ぶ。単純なCRUDは
   Server Action から直接 `supabase.from(...)` を呼び、RLSに委ねる。
6. **RLS層**（`supabase/migrations/00003, 00005, 00006`）— 最終防衛ライン。全ポリシーが
   `app_is_cypress_admin() or (...)` から始まる。詳細は `docs/tenant-isolation.md`。

## データ連動の中核: `finalize_order()`

会計確定は単一のDBトランザクション関数 `finalize_order(p_order_id, p_payments, p_register_session_id)`
（`00002_functions.sql` で新設、`00008_reservations_advanced.sql` で予約ステータス拡張に追随、
`00010_recipes.sql` でレシピ連動を追加した最終版が現行）が担う。呼び出し元は
`app/app/pos/payment-actions.ts` 等の Server Action。

書き込み順序:

1. `orders` を `for update` でロックし `status='open'` を要求（二重会計防止。2回目の呼び出しは
   `ORDER_NOT_OPEN` で拒否される。`scripts/verify-flow.mjs` セクション13で検証）
2. `recalc_order_totals(p_order_id)` で `order_items` と `store_settings`（サービス料率・端数処理）
   から `orders.subtotal/tax_total/service_charge/total` を再計算
3. `p_payments[].amount` の合計が `orders.total` と一致することを検証（不一致は `PAYMENT_MISMATCH`）
4. `payments` に決済方法ごとの行を挿入（現金なら `change_amount` を計算）
5. 現金収受かつレジセッション指定ありなら `cash_transactions`（`kind='sale'`）を挿入
6. `orders.status='paid'`, `closed_at`, `business_date`, `register_session_id` を更新
7. `customer_id` があれば `customers.visit_count / total_spent / last_visit_at / first_visit_at` を更新
8. `reservation_id` があれば `reservations.status='completed'`（`confirmed/waiting/arrived/seated/billing`
   のいずれかからのみ遷移）
9. `table_id` があれば `restaurant_tables.current_status='cleaning'`
10. 商品直結の在庫（`inventory_items.menu_item_id`）を `stock_movements`（`movement_type='sale'`）で
    減算
11. レシピ連動在庫（`menu_item_ingredients`、00010で追加）を同様に減算。数量は
    `menu_item_ingredients.quantity × order_items.quantity`
12. `log_audit(...)` で `audit_logs` に `order.finalize` を記録

1トランザクションで **注文・支払・現金・顧客・予約・テーブル・在庫（2系統）・監査ログ** の
8種のテーブル群が連動する。これが「ひとつのデータベースとひとつの操作画面」の実装上の核。
返金は逆方向の `refund_order()`（在庫・予約ステータスは戻さない）。伝票分割・統合は RPC ではなく
Server Action（`app/app/pos/actions.ts` の `splitOrder` / `mergeOrders`）で `orders.source_order_id`
を使って実装している。詳細は `docs/pos-flow.md`。

## Realtime

`00014_realtime_indexes.sql` で `supabase_realtime` publication に4テーブルを追加:
`orders`, `order_items`, `restaurant_tables`, `reservations`。POS/KDS/フロア図/予約台帳のライブ更新に使う。
RLSはRealtime購読時にも適用されるため、購読者は自分がSELECT可能な行のみ受信する。

匿名ユーザー（QRオーダー客）はRealtime購読の対象外（anon roleにRealtime配信しない設計）。
QRオーダー客側は `components/qr-order/order-status-view.tsx` が10秒間隔のポーリング
（`REFRESH_INTERVAL_MS = 10000` の `setInterval`）で `get_qr_order_status` RPCを呼び直す方式。
詳細は `docs/known-limitations.md`。

## 機能フラグ

`lib/features.ts` の `FEATURE_KEYS`（11種: `reservations, pos, kds, qr_order, crm, inventory, costing,
accounting, attendance, payroll, reports`）が組織単位の有効/無効を制御する。デフォルトは有効で、
`feature_flags` テーブル（`organization_id + flag_key + enabled`）に `enabled=false` の行がある場合のみ
無効化される。`/admin/feature-flags` で CYPRESS運営が組織別に切り替える
（`app/admin/feature-flags/actions.ts` の `createFeatureFlag` / `toggleFeatureFlag`）。

サーバー側の強制は `lib/auth.ts` の `requireFeature(feature)`。`getSessionContext()` が
`disabledFeatures: ReadonlySet<string>` をリクエストごとに読み込み、無効な機能への直接アクセスは
`/app/dashboard?feature_disabled=1` へリダイレクトする。UI側のナビ非表示（`lib/nav.ts` +
`isFeatureEnabled`）と合わせた二重防御。権限（`lib/permissions.ts`）との関係は
`docs/permissions.md` を参照。

## 決済抽象化（Stripe）

`lib/payments/types.ts` に `PaymentProviderAdapter` インターフェースを定義し、
`lib/payments/index.ts` の `ADAPTERS` レジストリで名前→実装を解決する
（`getPaymentProvider(name)`、未実装プロバイダーは `未対応の決済プロバイダーです` で例外）。
現在登録されているのは `stripe`（`lib/payments/stripe.ts`）のみ。型定義には将来候補として
`square | airpay | stera | paygate` が含まれるが未実装。

インターフェースは2つの決済経路を抽象化する:

- **Terminal（対面・カードリーダー）**: `processOnReader` / `simulatePresentCard` /
  `registerSimulatedReader` / `listReaders` — POS対面決済用。現状は `simulatePresentCard` の
  シミュレーテッドリーダーのみ検証済み（実機導入は `docs/payment-stripe.md` の手順が必要）
- **Checkout（ホスト型決済ページ）**: `createCheckoutSession` — 予約の事前決済・予約金用

Webhook（`app/api/webhooks/stripe/route.ts`）は署名検証後、`webhook_events`
（`unique(provider, event_id)`）への insert 失敗（`23505`）で冪等化し、ビジネスロジック失敗時も
HTTP 200 を返してStripeの自動リトライには依存しない設計（`status='failed'` に隔離）。
本番Stripeアカウントへの接続は未実施（テストキーのみ）。詳細は `docs/future-integrations.md` と
既存の `docs/payment-stripe.md`。

## 金額・日時の規約

- 金額は円単位の `integer`（浮動小数禁止）。税額計算は `lib/money.ts`（`taxFromInclusive` /
  `taxFromExclusive`）で整数演算のみを使い、`recalc_order_totals` SQL関数と同じロジックを維持する
  （コメントで明示的に同期を指示）
- 日時は `timestamptz`（UTC保存）。`business_date` は `(now() at time zone 'Asia/Tokyo')::date` で
  JST営業日として算出
- 原価計算（`lib/costing.ts`）は切り上げ（`Math.ceil`）、在庫単価換算（`lib/units.ts`）は四捨五入
  （円未満を持たない）— 用途によって丸め方向が異なる点に注意

## テスト構成

- `tests/*.test.ts`（Vitest）: `lib/` の純関数を単体テスト（money, tax, booking, reservations,
  payroll, costing, units, crm, permissions, payments）
- `e2e/core-flow.spec.ts`（Playwright）: UIスモーク。Supabase実環境+seedデータ前提（`e2e/README.md`）
- `scripts/verify-flow.mjs`: 実環境に対する業務フロー・RLS・テナント分離の統合検証（16セクション）
- `scripts/verify-stripe.mjs`: Stripeテストモードの疎通検証（Terminal simulated reader / Checkout）

運用時の実行方法は `docs/operations.md` を参照。
