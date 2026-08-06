# データベース設計

正式な定義は `supabase/migrations/` のSQLが唯一のソース。本書は構造の解説。

## 共通規約

- 主キー: `id uuid default gen_random_uuid()`
- テナント: 業務テーブルは必ず `organization_id`、店舗データは `store_id` を持つ
- 監査: `created_at / updated_at / created_by / updated_by`（updated_atはトリガー更新）
- 状態: `status` テキスト+CHECK制約
- 金額: `integer`（円）。数量は `numeric` 可
- 日時: `timestamptz`（UTC保存・JST表示）。営業日集計用に `business_date date` を持つテーブルあり
- 削除: 業務データは論理削除（status='deleted' 等）。決済済み取引は物理削除禁止
- インデックス: (organization_id, store_id, business_date) 等の複合を基本にする

## テーブル群

### テナント・権限
- `organizations` — 契約企業。name, plan_code, status(active/suspended/trial)
- `stores` — 店舗。slug(公開予約URL用, unique), name, address, phone, booking設定への参照
- `store_settings` — 店舗別設定KV(jsonb)。予約枠間隔・滞在時間デフォルト・端数処理・サービス料等
- `profiles` — auth.users 1:1。display_name, phone, is_cypress_admin
- `memberships` — profile×org、role(10種), status
- `membership_stores` — 店舗スコープの割当
- `roles` / `permissions` / `role_permissions` — 権限マスタ（`lib/permissions.ts` と同期。DBはRLS関数で参照）

### 店舗物理構成・営業
- `floors` — フロア（1F/2F/テラス）
- `restaurant_tables` — テーブル。name, capacity_min/max, floor_id, attributes(個室/カウンター/禁煙), is_active, current_status(空席/着席等)
- `table_combinations` — 結合可能テーブルの組
- `business_hours` — 曜日別 open/close/last_entry
- `holidays` — 定休・臨時休業（date, reason）

### 顧客（CRM）
- `customers` — 氏名/カナ/電話/メール/誕生日/住所(任意)/アレルギー/好み/接客メモ + 集計列(first_visit_at, last_visit_at, visit_count, total_spent, cancel_count, no_show_count)。org単位（全店共有）
- `customer_tags` / `customer_tag_links`
- `customer_notes` — 時系列メモ
- `customer_consents` — 同意種別(privacy/marketing_email/marketing_line)と取得日時

### 予約
- `reservation_sources` — 予約経路マスタ（web/phone/walk_in/google/line/gourmet_site…）
- `reservations` — store_id, customer_id, code(公開照会用), 日時, 人数(adults/children), course_id, purpose, status(pending/confirmed/seated/completed/cancelled/no_show/waitlist), channel, cancel_reason, allergy_note, memo, reminder送信フラグ
- `reservation_tables` — 予約×テーブル(複数可)
- `waitlist_entries` — キャンセル待ち
- `courses`(menu_itemsのコース種別で代替) — コース。所要時間・価格

### メニュー・税
- `menu_categories` — 表示順・POS色
- `menu_items` — name, category, price(店内), takeout_price, cost, tax_rate_id, item_type(food/drink/course/option), available_stores, sell_start/end時間帯, is_sold_out, image_path
- `menu_variants` — サイズ等
- `menu_modifiers` / `menu_item_modifiers` — トッピング・オプション
- `tax_rates` — 10%標準 / 8%軽減、内税外税フラグ

### 注文・会計
- `orders` — store_id, reservation_id?, customer_id?, table_id?, order_type(dine_in/takeout/delivery/course/pre_order), status(open/paid/cancelled/refunded/void), guest_count, subtotal, discount_total, service_charge, tax_total, total, rounding_adjustment, business_date, opened_at/closed_at, staff_id(担当), void_reason, source_order_id(分割元)
- `order_items` — menu_item snapshot(name/price/tax_rate), qty, modifiers(jsonb), memo, status(active/cancelled), staff_id, cancelled_reason
- `payments` — order_id, method(cash/credit/qr/emoney/voucher/on_account), amount, tendered, change, register_session_id, status(completed/refunded)
- `refunds` — payment_id/order_id, amount, reason, approved_by。元取引に紐付け

### レジ・現金
- `registers` — レジ端末マスタ
- `register_sessions` — 開局(opening_float)/閉局(expected_cash, counted_cash, difference, difference_reason), status(open/closed/approved), approved_by
- `cash_transactions` — セッション入出金 + 小口現金(kind: sale/refund/deposit/withdrawal/petty_in/petty_out), account_code(勘定科目), receipt_path, approval_status
- `daily_closings` — 営業日サマリ（売上・件数・客数・支払方法別・現金差異）。締め後修正は権限+監査ログ

### 経費・請求書・書類
- `expense_accounts` — 勘定科目マスタ
- `expenses` — 小口経費（cash_transactions連動 or 独立）
- `vendors` — 仕入先。締め日/支払日/振込先
- `invoices` — 請求書。vendor, 発行日, 支払期限, 金額, 税額, 登録番号, status(未処理/確認待ち/承認済み/支払予定/支払済み/差戻し), 支払方法, document_id
- `documents` — Storageファイルメタ。doc_type(請求書/領収書/納品書/発注書/見積書/契約書/レシート/他), 年月, ocr_status('none'固定・将来用), ocr_payload jsonb
- `document_comments`

### 仕入・在庫
- `purchase_orders` / `purchase_order_items` — 発注。status(draft/申請/承認/発注済/入荷待ち/一部入荷/完了/取消)
- `inventory_items` — 品目（食材/資材/商品）。unit, reorder_point, avg_cost
- `stock_movements` — 入庫/出庫/廃棄/返品/移動/棚卸調整/販売連動。qty±, unit_cost, ref(order_id等)
- `stock_counts` / `stock_count_items` — 棚卸

### 勤怠・シフト・給与
- `time_entries` — clock_in/out, break_minutes, 区分(通常/遅刻/早退/欠勤/有給/休日出勤), 深夜/残業分, status(open/closed/approved), source(共用端末/個人端末), 店舗間応援は store_id で表現
- `time_entry_events` — 生打刻ログ（in/out/break_start/break_end, PIN使用）
- `attendance_requests` — 修正申請→承認
- `shifts` — 確定シフト・希望シフト(kind), 時間帯, status
- `shift_requirements` — 時間帯別必要人数
- `payroll_rules` — スタッフ別: pay_type(monthly/hourly/daily), base_amount, 残業1.25/深夜0.25/休日1.35倍率, 交通費, 手当jsonb, 締め日/支払日
- `commission_rules` — 対象(personal_sales/menu_item/category/store_target/nomination), 方式(fixed/rate/tiered), tiers jsonb, 上限下限, 適用期間
- `payroll_runs` — 期間×店舗/企業, status(draft/confirmed/approved), 計算スナップショット
- `payroll_items` — スタッフ別明細。勤怠集計・基本給・残業・深夜・手当・歩合・総支給、計算根拠jsonb

### 基盤
- `notifications` — 宛先profile, type, title, body, link, read_at
- `audit_logs` — actor, organization_id, action, target_table/target_id, before/after jsonb, ip, note(support_access等)
- `feature_flags` — org別機能ON/OFF
- `plans` — プランマスタ下地
- `print_jobs` — 印刷キュー（ブラウザ印刷/将来SDK用抽象化）

## 集計・連動の実装

- 会計確定（Server Action `finalizeOrder`）はDB関数 `finalize_order()`（SECURITY DEFINER・トランザクション）で:
  payments挿入 → orders.status='paid' → cash_transactions(現金分) → customers集計更新 → stock_movements(商品在庫) → reservations.status='completed' 連動
- レポートは `orders/order_items/payments` からのビュー+集計クエリ（`daily_closings` は締め時スナップショット）
- 顧客集計列は取引時に増分更新し、再計算関数 `recalc_customer_stats()` も用意
