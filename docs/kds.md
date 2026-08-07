# KDS（キッチンディスプレイシステム）

関連: `docs/qr-order.md`（注文の発生源）、`docs/pos-flow.md`、`docs/database.md`。
実装は`supabase/migrations/00012_qr_kds.sql`（ステータス列の基盤）、
`00013_hardening_units_qr.sql`（ステーション列）、画面は`app/app/kitchen/`・
`components/kitchen/`。

## ステーション

- `menu_categories.station`（`00013`で追加）: `kitchen`（厨房） / `drink`（ドリンク・バー） /
  `dessert`（デザート）の3種、既定`kitchen`
- 品目の担当ステーションは`menu_items.category_id → menu_categories.station`で解決する
  （品目ごとの個別ステーション指定列は無く、カテゴリ単位のルーティング）

## 状態遷移

`order_items.kitchen_status`（`00012`）は4状態のCHECK制約: `pending → preparing → ready → served`。
タイムスタンプ列`kitchen_started_at`/`kitchen_ready_at`/`served_at`を状態遷移ごとに記録する。
状態遷移の順序を強制するSQLトリガー・CHECK制約は無く、遷移の妥当性検証はアプリ層
（`app/app/kitchen/actions.ts`の`setItemKitchenStatus`）が担う。

- 画面操作: `app/app/kitchen/page.tsx`が`order_items`を`status='active'`かつ親`orders.status='open'`
  で取得し、直近1時間以内（`RECENT_SERVED_WINDOW_MS`）に提供済み（`served`）の品目も含めて
  `KdsOrderGroup[]`（注文単位のグループ）に整形して`KdsBoard`（`components/kitchen/kds-board.tsx`）
  へ渡す
- `setItemKitchenStatus` / `markOrderServed`（`app/app/kitchen/actions.ts`）が状態を更新する
- アクセス制御: `requireFeature('kds')` + `requirePermission('pos.order')`
  （権限は注文操作権限を流用。KDS専用の権限アクションは無い）

## 警告しきい値

DBに警告しきい値のカラムは無く、**すべてクライアント側で経過時間から算出**する
（`components/kitchen/types.ts`, `components/kitchen/order-card.tsx`）:

```
KDS_WARNING_MINUTES = 15   // 15分経過で警告色
KDS_DANGER_MINUTES  = 25   // 25分経過で危険色
```

- `order-card.tsx`: 個々の注文グループの経過時間（`now - group.orderTime`）が15分/25分の
  しきい値を超えると枠線・文字色が`warning`/`danger`トーンに変わる
- `kds-board.tsx`: ボード全体の平均経過時間（`avgElapsedMinutes`）が同じ15/25分しきい値で
  ヘッダーのトーンを切り替える

## Realtime

`order_items`（`orders`とあわせて）は`00014_realtime_indexes.sql`で`supabase_realtime`
publicationに登録済み。QRオーダー・POSいずれから追加された品目もKDSボードへ即座に反映される。
インデックス`idx_order_items_kitchen(store_id, kitchen_status, created_at)`（`00012`）が
未提供品目の一覧取得を支える。RLSはRealtime購読にも適用されるため、店舗スタッフは自店の
`order_items`のみ受信する（`docs/tenant-isolation.md`）。

## 検証

`scripts/verify-flow.mjs`セクション15で、新規品目が`kitchen_status='pending'`で始まること、
`preparing → ready → served`の遷移が正しく永続化されることを確認している。
