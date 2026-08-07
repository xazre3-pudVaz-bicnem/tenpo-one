# QRオーダー

関連: `docs/pos-flow.md`（QR注文が乗る先の`orders`/会計フロー）、`docs/kds.md`（厨房への反映）、
`docs/database.md`。実装は`supabase/migrations/00012_qr_kds.sql`（基盤）と
`00013_hardening_units_qr.sql`（オプション・販売時間帯対応）。

## トークン設計

- `restaurant_tables.qr_token`（`00012`で追加）: テーブルごとに一意な文字列トークン
  - デフォルト生成式: `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`
    （UUID2つを連結しハイフンを除去した64文字の16進文字列。事実上推測不可能な高エントロピー値）
  - `unique`制約あり。DB側で自動生成されるため、アプリがトークンの採番ロジックを持たない
- 客側URL: `/order/[storeSlug]/[tableToken]`（`app/order/[storeSlug]/[tableToken]/page.tsx`）。
  `table_id`はクライアントに一切露出せず、常に`(slug, token)`の組でRPCへ渡す
- 公開URLかつ非ログイン前提のため、当該ページの`robots`は`noindex`（検索インデックス回避）
- 無効なトークンは`get_qr_menu`が`null`を返し、`notFound()`（404）を表示

## 匿名RPC（すべて`SECURITY DEFINER`・`anon, authenticated`にGRANT）

| RPC | 役割 |
|---|---|
| `get_qr_menu(p_slug, p_token)` | メニュー取得。カテゴリ→品目のjsonbツリー、オプション・おすすめ・アレルギー表示・販売時間帯フィルタ込み（`00013`で拡張） |
| `create_qr_order(p_slug, p_token, p_items jsonb)` | 注文作成・追加。テーブルの`open`な注文へ追記、無ければ新規作成 |
| `get_qr_order_status(p_slug, p_token)` | 自分のテーブルの現在の注文内容・厨房状況・合計金額を取得 |

## `get_qr_menu` の絞り込み

- `food`/`drink`種別かつ`active`、売り切れ(`is_sold_out`)でない品目のみ
- 販売時間帯（`sell_start_time`/`sell_end_time`）でのフィルタ。日をまたぐ設定
  （`sell_start_time > sell_end_time`、例: 22:00〜翌2:00）にも対応した比較式:
  ```sql
  (sell_start_time <= sell_end_time and now between sell_start_time and sell_end_time)
  or (sell_start_time > sell_end_time and (now >= sell_start_time or now <= sell_end_time))
  ```
- 各品目に`is_recommended`（おすすめ表示）・`allergy_info`（アレルギー表示文言）・`image_path`・
  紐付く`modifiers`（オプション候補）を含めて返す
- 並び順: `is_recommended desc, sort_order`

## オプション（modifiers）

- カタログ: `menu_modifiers`（名称・価格）↔`menu_item_modifiers`（品目ごとの許可リスト）
- 注文時、客が選んだ`modifier_ids`は`create_qr_order`内でサーバー側検証される:
  - 1品目あたり最大5個（超過は`TOO_MANY_MODIFIERS`）
  - 実際に`menu_item_modifiers`で当該品目に紐付き、かつ`active`なものだけ許可
    （未許可IDが混じっていれば`INVALID_MODIFIER`。クライアント側の改ざん・不正リクエスト対策）
  - 選択されたオプションの名称・価格は`order_items.modifiers jsonb`へ**スナップショット**保存
    （FK参照ではない）。将来オプションのカタログ内容が変わっても過去注文の表示は変化しない
- `line_total = (menu_item.price + Σ modifier.price) × quantity`

## レート制限

- `create_qr_order`: **同一テーブルから1分あたり最大5注文**
  （`orders`を`table_id + order_source='qr' + created_at > now() - 1分`でカウントし、
  5件以上なら`RATE_LIMITED`）
- 1回のリクエストで最大30品目（`TOO_MANY_ITEMS`）、1品目あたり数量1〜20（`INVALID_QUANTITY`）
- 公開予約側（`create_public_reservation`）にも別途、同一電話番号1時間5件のレート制限がある
  （`docs/reservation-flow.md`）

## 注文の反映先

- `create_qr_order`は対象テーブルの`open`な注文があれば再利用し、無ければ`order_source='qr'`で
  新規作成する。テーブルの状態が`available`/`reserved`/`waiting`であれば`seated`へ更新する
- 追加した`order_items`は`kitchen_status='pending'`で作成され、`recalc_order_totals`を呼んで
  合計を更新する
- QR経由の注文もPOS・KDS側から見れば通常の`orders`/`order_items`と同一であり、POS画面での
  追加会計・値引き・取消もそのまま適用できる

## Realtime反映

`orders`/`order_items`は`00014_realtime_indexes.sql`で`supabase_realtime` publicationに登録済みの
ため、QRオーダーで追加された品目はPOS画面・KDS画面へRealtime購読を通じて即座に反映される
（RLSはRealtime購読にも適用されるため、店舗スタッフは自店の行のみ受信する）。

**客側（anon）はRealtime購読の対象外**。ログイン不要な匿名アクセスにRealtimeを許可すると
店舗を跨いだ購読制御が複雑になるため、`get_qr_order_status`は
`components/qr-order/order-status-view.tsx`が10秒間隔（`REFRESH_INTERVAL_MS = 10000`の
`setInterval`）でポーリングする方式を採る。詳細は`docs/known-limitations.md`。

## 検証

`scripts/verify-flow.mjs`セクション14で、有効/無効トークンの挙動・不正な`modifier_ids`の拒否・
QR注文の作成とPOS/KDS側からの可視性・客側`get_qr_order_status`の内容一致を確認している。
