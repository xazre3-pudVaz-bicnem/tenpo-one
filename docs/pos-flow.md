# POSフロー: 注文〜会計〜連動更新〜分割/統合/再会計/返金

業務全体の文脈は`docs/business-flows.md`、DB関数の詳細は`docs/database.md`・`docs/architecture.md`を
参照。本書はPOS操作（`app/app/pos/`, `app/app/orders/`, `app/app/kitchen/`）に絞った実装詳細。

## 1. 注文作成

- 画面: `app/app/pos/page.tsx`（オーダーグリッド+伝票）、`app/app/pos/actions.ts`
- 予約から起票する場合: `reservation_id`/`customer_id`を引き継いで`orders`を作成
  （`docs/reservation-flow.md`参照）。フリー入店（ウォークイン）の場合は`table_id`のみで作成
- 品目追加のたびに`recalc_order_totals(p_order_id)` RPCを呼び、`orders.subtotal/tax_total/
  service_charge/total`を再計算（税額は`store_settings`の税率・内税外税設定、サービス料率に従う）
- QRオーダー（`create_qr_order` RPC）経由で客が自分で品目追加した場合も同じ`orders`/`order_items`に
  乗るため、POS画面にはリアルタイムで反映される（`docs/qr-order.md`）

## 2. 会計（`finalize_order`）

- 呼び出し: `app/app/pos/payment-actions.ts`（Stripe決済を伴う場合）または現金/その他手段の
  Server Actionから`supabase.rpc('finalize_order', {...})`
- 事前条件: `orders.status='open'`であること。2回目の呼び出しは`ORDER_NOT_OPEN`で拒否
  （二重会計防止、`scripts/verify-flow.mjs`セクション13で検証）
- 支払方法は複数を組み合わせ可能（現金+クレジット等）。`p_payments`の合計が`orders.total`と
  一致しない場合は`PAYMENT_MISMATCH`で拒否

## 3. 連動更新（会計確定時のカスケード）

`finalize_order()`が単一トランザクションで以下を更新する（詳細な実装順序は`docs/architecture.md`の
「データ連動の中核」節を参照）:

1. `orders` → `status='paid'`
2. `payments` → 決済方法ごとに1行（現金は`change_amount`を計算）
3. `cash_transactions` → 現金収受分を`kind='sale'`で記録（レジセッションが開いている場合）
4. `customers` → `visit_count`/`total_spent`/`last_visit_at`/`first_visit_at`を更新
5. `reservations` → 紐付く予約があれば`status='completed'`
6. `restaurant_tables` → `current_status='cleaning'`
7. `stock_movements`/`inventory_items` → 商品直結在庫の減算（①）+ レシピ連動在庫の減算（②、
   `menu_item_ingredients`経由。`docs/inventory-flow.md`参照）
8. `audit_logs` → `order.finalize`を記録

## 4. 分割（split）

- 実装: `app/app/pos/actions.ts`の`splitOrder(orderId, moves: SplitMove[])`（**SQL RPCではなく
  Server Action**。`docs/database.md`「RPCが存在しない領域」を参照）
- `moves`は`{orderItemId, quantity}`の配列。数量の一部だけ移動する場合、元品目を`quantity`減算し
  残りを新伝票へ`insert`、全量移動の場合は`order_items.order_id`を書き換えるだけ
- 新伝票は`orders.source_order_id = 元伝票ID`で作成し、系譜を保持
- 移動後、両伝票に対し`recalc_order_totals`を呼び直す
- `log_audit(p_action: 'order.split', ...)`で記録
- 分割後は両伝票をそれぞれ独立に会計できる（個別会計はこの機能で実現）

## 5. 統合（merge）

- 実装: `app/app/pos/actions.ts`の`mergeOrders(targetOrderId, sourceOrderId)`
- 異なる店舗の伝票は統合不可（`他店舗の伝票とは統合できません`）
- `source`側の`active`な`order_items`を`target`側へ`order_id`を書き換えて移動
- `source`側の伝票は物理削除せず`status='void'`、`source_order_id=targetOrderId`、
  `void_reason='伝票統合のため'`で論理的に無効化（決済済みでない`open`な伝票のみ対象なので
  物理削除防止トリガーには抵触しない）
- `target`側の`guest_count`を合算し、`recalc_order_totals`を呼び直す
- `log_audit(p_action: 'order.merge', ...)`で記録

## 6. 再会計・テーブル移動

- テーブル移動: `moveTable(orderId, newTableId)`（`app/app/pos/actions.ts`）— 旧テーブルを
  `cleaning`、新テーブルを`seated`にする
- 会計後の金額修正（値引き追加・品目取消等）を`open`に戻して再会計するような「reopen」専用RPCは
  存在しない。決済済み（`paid`/`refunded`）の`orders`は`prevent_paid_mutation`トリガーで
  UPDATE/DELETEの対象外ではないが更新可否はRLS次第、かつ運用上は返金（次節）で対応する設計
  （`docs/open-questions.md`・現場運用ではPOSの「取消」は未会計の`open`伝票のみを想定）

## 7. 返金（`refund_order`）

- RPC: `refund_order(p_order_id, p_amount, p_method, p_reason, p_register_session_id)`
  （`00002_functions.sql`、以降未変更）
- ロール制限: `org_owner/hq_admin/area_manager/store_manager`のみ（`part_time`は拒否。
  `scripts/verify-flow.mjs`セクション6で検証）
- `p_amount + 既存返金額 <= 会計済み合計`を検証（超過は`REFUND_EXCEEDS_PAID`）
- `refunds`へ挿入（元取引と`order_id`で紐付け、物理削除は不可）
- 現金返金の場合は`cash_transactions`（`kind='refund'`）を追加
- 累計返金額が会計済み合計に達したら`orders.status='refunded'`に遷移
- `customers.total_spent`を減算
- `log_audit(p_action: 'order.refund', ...)`で記録
- **在庫・予約ステータスは戻さない** — 返金は会計の逆操作であって、提供済み商品の在庫を戻す
  操作ではないという設計判断（`docs/known-limitations.md`）

## 8. レジ締め・日次締めへの反映

会計確定・返金で発生した`cash_transactions`は`close_register_session()`が`kind`別に集計し
（`sale - refund + deposit - withdrawal`）、`expected_cash`と`counted_cash`の差異を記録した上で
`daily_closings`へ`(store_id, business_date)`単位でupsertする。詳細は`docs/database.md`の
レジ・現金セクションを参照。

## データフロー図（会計確定時）

```
POS画面（会計ボタン）
  └→ finalize_order(order_id, payments[], register_session_id) [RPC/SECURITY DEFINER]
       ├→ orders.status = 'paid'
       ├→ payments (insert × 支払方法数)
       ├→ cash_transactions (insert, kind='sale', 現金がある場合)
       ├→ customers (update: 来店・売上集計)
       ├→ reservations (update: status='completed')
       ├→ restaurant_tables (update: current_status='cleaning')
       ├→ stock_movements + inventory_items (商品直結在庫の減算)
       ├→ stock_movements + inventory_items (レシピ連動在庫の減算)
       └→ audit_logs (insert: order.finalize)
```
