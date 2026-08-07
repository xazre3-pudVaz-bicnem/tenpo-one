# データベース設計

正式な定義は `supabase/migrations/` のSQLが唯一のソース。本書はmigration単位の要約とテーブル群の
解説。旧 `docs/database-schema.md` は本ファイルへの参照に置き換え済み。

## Migration一覧（00001〜00014）

| # | ファイル | 概要 |
|---|---|---|
| 00001 | `schema.sql` | 全テーブル・CHECK制約・インデックス・`updated_at`トリガーを一括作成。money=integer、日時=timestamptz(UTC)、`business_date`はJST基準。ロール/プラン/予約経路のマスタ投入 |
| 00002 | `functions.sql` | RLSヘルパー関数群、監査ログ関数 `log_audit`、公開予約RPC一式、`recalc_order_totals`、`finalize_order`（v1）、`refund_order`、レジ開閉RPC、`apply_punch`（打刻）、`recalc_customer_stats` |
| 00003 | `rls.sql` | 全業務テーブルへのRLS一括適用（tierベースの動的生成）、個別テーブルの手書きポリシー、決済済み取引の物理削除防止トリガー、Storageバケット`documents`のポリシー |
| 00004 | `auth_trigger.sql` | `auth.users` insert時に `profiles` を自動生成するトリガー |
| 00005 | `fix_cash_rls.sql` | `staff`ロールがレジ連動の入出金（`deposit`/`withdrawal`）を登録できるようRLSを緩和（小口現金`petty_*`は対象外） |
| 00006 | `payroll_rls_tighten.sql` | `payroll_rules`/`commission_rules`/`payroll_runs`のSELECTポリシーを引き締め、一般スタッフから他人の給与・歩合設定を見えなくする |
| 00007 | `payments_stripe.sql` | 決済プロバイダー抽象テーブル群（`payment_providers`, `terminal_readers`, `payment_intents`, `webhook_events`, `saas_subscriptions`）を追加。カード情報は非保存、プロバイダーIDのみ保持 |
| 00008 | `reservations_advanced.sql` | `reservations.status`を10種に拡張（来店・着席・会計待ちを分離）、`staff_id`（担当）・`is_private_hire`（貸切）を追加。`get_booking_availability`と`finalize_order`を貸切対応に再定義 |
| 00009 | `inventory_advanced.sql` | 発注点・PO税額列を追加。`apply_stock_receipt`（加重平均原価）・`apply_stock_transfer`（店舗間移動）RPCを新設 |
| 00010 | `recipes.sql` | `menu_item_ingredients`（レシピ/BOM）を新設。`finalize_order`にレシピ連動の理論在庫減算を追加（現行版） |
| 00011 | `accounting_advanced.sql` | 請求書ステータスに`pending_approval`追加、`cash_transactions.kind`に`petty_advance`/`petty_settlement`追加、`petty_cash_counts`（実査）を新設。**新規SQL関数なし** |
| 00012 | `qr_kds.sql` | `restaurant_tables.qr_token`、`orders.order_source`、`order_items.kitchen_status`を追加。匿名RPC `get_qr_menu`/`create_qr_order`/`get_qr_order_status`を新設 |
| 00013 | `hardening_units_qr.sql` | 在庫の`purchase_unit`/`purchase_to_stock_factor`、`menu_categories.station`（KDSステーション）、QRメニューのオプション対応・販売時間帯フィルタ、`organizations`のオンボーディング/会社情報列を追加 |
| 00014 | `realtime_indexes.sql` | `orders`/`order_items`/`restaurant_tables`/`reservations`をRealtime publicationへ追加。レポート・検索用の複合インデックス8本を追加（想定規模: 100社/1000店/1000万注文） |

## 共通規約

- 主キー: `id uuid default gen_random_uuid()`
- テナント: 業務テーブルは必ず `organization_id`、店舗データは `store_id` を持つ
- 監査: `created_at / updated_at / created_by / updated_by`（`updated_at`は`set_updated_at()`トリガーで自動更新、00001で全テーブルにループ適用）
- 状態: `status` テキスト + CHECK制約
- 金額: `integer`（円）。数量は `numeric` 可
- 日時: `timestamptz`（UTC保存・JST表示）。`business_date date` を持つテーブルは営業日集計に使用
- 削除: 業務データは論理削除（`status='deleted'`等）。決済済み取引（`orders.status in (paid,refunded)`、`payments`、`refunds`）は物理削除禁止（RLSに加えトリガーでも防御。`00003_rls.sql`の`prevent_paid_mutation`/`prevent_payment_delete`）
- インデックス: `(organization_id, store_id, business_date)` 等の複合を基本にする

## テーブル群

### テナント・権限（00001）
- `organizations` — 契約企業。`plan_code`, `status(trial/active/suspended/cancelled)`, `is_demo`。00013で`postal_code/address/phone/logo_path/billing_info/onboarding jsonb`を追加
- `stores` — 店舗。`slug`（公開予約URL用、unique）, `status(active/suspended/closed)`, `booking_enabled`
- `store_settings` — 店舗別設定。予約枠(`slot_minutes`)・滞在時間・端数処理(`rounding`)・サービス料率。00007で決済(`booking_payment_mode`他)、00011で`petty_opening_balance`、00013で`attendance_settings jsonb`を追加
- `profiles` — `auth.users`と1:1。`is_cypress_admin`（プラットフォームサポートフラグ）, `pin_code`（共用端末打刻用）
- `memberships` — `profile_id × organization_id`、`role`（9種のorg内ロール。CHECK制約で列挙）、`status`
- `membership_stores` — 店舗スコープの割当（HQ系ロールは全店舗自動アクセスのため未登録でも可）
- `roles` / `permissions` / `role_permissions` — 権限マスタ（`lib/permissions.ts`と同期）

### 店舗物理構成・営業（00001）
- `floors`, `restaurant_tables`（`current_status`: 空席/予約/待ち/着席/オーダー中/会計待ち/清掃中/利用不可）, `table_combinations`, `business_hours`, `holidays`

### 顧客（CRM、00001）
- `customers` — `organization_id`単位（全店共有）。集計列 `visit_count/total_spent/cancel_count/no_show_count/first_visit_at/last_visit_at`
- `customer_tags` / `customer_tag_links` / `customer_notes` / `customer_consents`

### 予約（00001, 00008）
- `reservation_sources` — グローバルマスタ（web/phone/walk_in/google/line/gourmet_site/other）
- `reservations` — `code`（公開照会用unique）。`status`は00008で拡張:
  `pending→confirmed→waiting→arrived→seated→billing→completed`（+`cancelled`/`no_show`/`waitlisted`）。
  `staff_id`（担当）, `is_private_hire`（貸切、00008）
- `reservation_tables`（予約×テーブル、複数可）, `waitlist_entries`, `booking_request_logs`（匿名予約のレート制限台帳）

### メニュー・税（00001, 00013）
- `menu_categories` — 00013で`station(kitchen/drink/dessert)`（KDSルーティング）を追加
- `menu_items` — `item_type(food/drink/course/option)`, `price/cost/takeout_price`。00013で`is_recommended`, `allergy_info`を追加
- `menu_variants` / `menu_modifiers` / `menu_item_modifiers`（トッピング・オプション）, `tax_rates`（10%標準/8%軽減）

### 注文・会計（00001, 00007, 00012）
- `orders` — `order_type(dine_in/takeout/delivery/course/pre_order)`, `status(open/paid/cancelled/refunded/void)`,
  `source_order_id`（分割・統合元へのself-FK）。00012で`order_source(pos/qr/online)`を追加
- `order_items` — メニュー名/価格スナップショット, `modifiers jsonb`。00012で`kitchen_status(pending/preparing/ready/served)`
  + `kitchen_started_at/kitchen_ready_at/served_at`を追加（KDS）
- `payments` — `method(cash/credit/qr/emoney/voucher/on_account)`。00007で`provider`, `provider_payment_intent_id`, `provider_charge_id`を追加
- `refunds` — `amount/reason/approved_by`、元取引に紐付け。00007で`provider`, `provider_refund_id`を追加

### レジ・現金（00001, 00005, 00011）
- `registers` / `register_sessions`（`opening_float/expected_cash/counted_cash/difference`）
- `cash_transactions` — `kind`は00001で`sale/refund/deposit/withdrawal/petty_in/petty_out/adjustment`、
  00011で`petty_advance`(立替)/`petty_settlement`(精算)を追加
- `daily_closings` — 営業日サマリ（`payment_breakdown jsonb`）。`(store_id, business_date)` unique
- `petty_cash_counts`（00011）— 小口現金実査。`expected_amount/counted_amount/difference`

### 経費・請求書・書類（00001, 00011）
- `expense_accounts`, `expenses`, `vendors`
- `invoices` — `status`は00001で`open/review/approved/scheduled/paid/rejected`、00011で`pending_approval`を挿入し
  `open→review→pending_approval→approved→scheduled→paid`（+`rejected`）に拡張。00011で`expense_account_id`を追加
- `documents`（Storage `documents`バケット連動）, `document_comments`

### 仕入・在庫（00001, 00009, 00010, 00013）
- `inventory_items` — `item_kind(ingredient/supply/product)`, `avg_cost`（加重平均）。00009で`optimal_quantity/min_quantity/last_purchase_cost`、
  00013で`purchase_unit`/`purchase_to_stock_factor`（仕入単位→在庫単位換算係数）を追加
- `purchase_orders`（`status: draft→requested→approved→ordered→partially_received→received/cancelled`）/ `purchase_order_items`
- `stock_movements` — `movement_type(in/out/waste/return/transfer_in/transfer_out/count_adjust/sale)`。00009で`transfer_group_id`, `to_store_id`を追加（店舗間移動のペア記録）
- `stock_counts` / `stock_count_items`（棚卸・差異）
- `menu_item_ingredients`（00010）— レシピ/BOM。`menu_item_id × inventory_item_id`、`quantity`（1個販売あたり消費量、在庫単位）

### 勤怠・シフト・給与（00001）
- `time_entries`（`entry_type`: 通常/遅刻/早退/欠勤/有給/休日出勤）, `time_entry_events`（打刻の生ログ）, `attendance_requests`（修正申請）
- `shifts`（`kind: planned/requested/confirmed`）, `shift_requirements`
- `payroll_rules` — `pay_type(monthly/hourly/daily)`, `overtime_rate`(既定1.25)/`night_rate`(既定0.25)/`holiday_rate`(既定1.35)
- `commission_rules` — `method(fixed/rate/tiered)`, `tiers jsonb`（`[{from,to,rate}]`、段階式歩合）, `basis(tax_included/tax_excluded)`
- `payroll_runs`（`status: draft→confirmed→approved`。draftが試算＝プレビュー段階）, `payroll_items`（社員別明細、`breakdown jsonb`に計算根拠）

### 決済（Stripe、00007）
- `payment_providers`（組織別プロバイダー設定、秘密鍵は含まない）
- `terminal_readers`（カードリーダー。`is_simulated`既定true）
- `payment_intents`（プロバイダー非依存の決済台帳。`idempotency_key unique`, `provider_payment_intent_id unique`）
- `webhook_events`（Webhook冪等化。`unique(provider, event_id)`。クライアントアクセス不可、サービスロール専用）
- `saas_subscriptions`（SaaS課金。org単位、CYPRESS運営のみ書込。設計のみで本番接続なし）

### 基盤（00001）
- `notifications`, `audit_logs`（`before_data/after_data jsonb`, `actor_role`, `note`に`support_access`等）
- `feature_flags`（org別機能ON/OFF）, `plans`（プランマスタ下地）
- `printer_configs` / `print_jobs`（印刷キュー。現状はブラウザ印刷のみ、実機SDK未接続）

## 命名規約

- テーブル名: 複数形スネークケース（`orders`, `order_items`）
- 外部キー列: `<単数形>_id`（`order_id`, `menu_item_id`）。自己参照は用途を示す名（`source_order_id`）
- 状態列: `status`固定名 + CHECK制約で列挙（enum型は不使用、マイグレーションでの拡張を容易にするため）
- RPC関数: 動詞+目的語のスネークケース（`finalize_order`, `apply_stock_receipt`, `create_qr_order`）
- RLSヘルパー関数: `app_`プレフィックス（`app_is_cypress_admin`, `app_has_store_access`）
- インデックス: `idx_<table>_<列群>`

## 主要インデックス

00001で店舗/組織/営業日の複合インデックスを標準装備（例: `idx_orders_store_date`,
`idx_stock_movements_item`, `idx_customers_phone`）。00014で追加された8本は集計・レポート用途に特化:

```
idx_orders_staff_date(staff_id, business_date) where staff_id is not null   -- スタッフ別売上・歩合集計
idx_customers_org_lastvisit(organization_id, last_visit_at)                 -- 休眠顧客セグメント
idx_stock_movements_store_type_date(store_id, movement_type, business_date) -- 廃棄・原価集計
idx_time_entries_org_date(organization_id, work_date)                       -- 給与期間集計
idx_payments_org_date(organization_id, business_date)                       -- 支払方法別レポート
idx_audit_logs_actor(actor_id, created_at)                                  -- 運営コンソールの操作者検索
idx_notifications_recipient_created(recipient_id, created_at desc)          -- 通知一覧
idx_invoices_org_account(organization_id, expense_account_id)               -- 請求書の勘定科目別集計
idx_orders_table_open(table_id) where status = 'open'                       -- QR/KDSのテーブル別オープン注文検索
```

## 集計・連動の実装

会計確定の連鎖（`finalize_order()`）は `docs/architecture.md` と `docs/pos-flow.md` を参照。
顧客集計列は取引時に増分更新し、ズレが生じた場合の再計算関数として `recalc_customer_stats(p_customer_id)`
（`00002_functions.sql`）も用意している。日次締めのスナップショットは `daily_closings`
（`close_register_session()`が`(store_id, business_date)`にupsert）。

**RPCが存在しない領域**（アプリ層で実装、`docs/known-limitations.md`参照）:
伝票の分割・統合（`app/app/pos/actions.ts`の`splitOrder`/`mergeOrders`）、棚卸差異の反映
（`stock_counts`/`stock_count_items`はアプリ側で書込）、給与計算本体（`lib/payroll.ts`の純関数を
Server Actionが呼び`payroll_items`へ書込）、待機リストからの予約変換（`app/app/reservations/actions.ts`）。
