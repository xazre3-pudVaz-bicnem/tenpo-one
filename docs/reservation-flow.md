# 予約フロー: 公開予約RPC〜台帳〜ステータス遷移〜貸切〜キャンセル待ち

関連: `docs/business-flows.md`（業務全体の流れ）、`docs/database.md`（テーブル定義）、
`docs/pos-flow.md`（予約から注文への引き継ぎ）。

## 1. 公開予約RPC（匿名・`(public)/book/[storeSlug]`）

すべて`supabase/migrations/00002_functions.sql`で`SECURITY DEFINER`かつ`anon, authenticated`に
GRANTされた関数。`app/(public)/book/[storeSlug]/page.tsx`から呼ばれる。

| RPC | 役割 |
|---|---|
| `get_booking_store(p_slug)` | 店舗情報・営業時間・コース一覧をjsonbで返す（LP表示用） |
| `get_booking_availability(p_slug, p_date, p_party)` | 日付×人数で空き枠を計算。00008で貸切ブロック対応を追加（後述） |
| `generate_reservation_code()` | 公開照会用の2×4桁英大文字コードを生成 |
| `create_public_reservation(...)` | 予約作成本体（後述） |
| `get_public_reservation(p_code, p_phone)` | コード+電話番号での照会（本人確認代わり） |
| `cancel_public_reservation(p_code, p_phone, p_reason)` | `pending`/`confirmed`の時のみキャンセル可 |

### 空き枠計算（`lib/booking.ts`の`computeSlots`とDB側`get_booking_availability`は同一ロジック）

- 定休日・営業時間外・`capacity <= 0`・`partySize > capacity`は即座に空きなし
- 最終入店時刻は`lastEntryTime`未設定なら`closeTime - 60分`がデフォルト
- 予約カットオフ（`booking_cutoff_minutes`、`store_settings`）より直近の枠は不可
- 各スロットで重複する予約の`party_size`合計が`capacity`を超えなければ空きあり
- **貸切予約が重複する枠は人数計算に関係なく丸ごと不可**にする（後述）

### `create_public_reservation` の入力検証・レート制限

- 同意（`p_consent`）必須。`customer_consents`に`web_booking`ソースで記録
- **レート制限: 同一電話番号から1時間あたり最大5件**（`booking_request_logs`を参照してカウント、
  超過は`RATE_LIMITED`）
- サーバー側で再度空き状況を検証してから確定（クライアント側の表示とのタイムラグ対策）
- 顧客は電話番号で組織内既存顧客と突合（新規なら作成）— `docs/open-questions.md`項目10
- `reservations.status='confirmed'`で作成

## 2. 予約台帳（`app/app/reservations/`）

- 画面: `reservations/page.tsx`（タイムライン/台帳）、`reservations/calendar/page.tsx`、
  `reservations/list/page.tsx`（+ CSV `list/export/route.ts`）
- 店長等が予約を確認し、テーブル割当（`reservation_tables`）を行い、来店時にステータスを進める
- ドラッグ&ドロップによるタイムライン上の予約移動は**未実装**
  （`app/app/reservations/actions.ts:290`のコメント「ドラッグ&ドロップは未実装（将来対応時は
  タイムライン側からこのactionを呼び出す想定）」。`moveReservation`関数自体は将来のUI接続先として
  存在する）

## 3. ステータス遷移表

`lib/reservations.ts`の`RESERVATION_TRANSITIONS`（アプリ層の許可表。DBのCHECK制約は
`00008_reservations_advanced.sql`で全10状態を許可するのみで、遷移順序そのものはDBレベルでは
強制していない）:

| From | 遷移可能な To |
|---|---|
| `pending`（仮予約） | `confirmed`, `cancelled` |
| `confirmed`（予約確定） | `waiting`, `arrived`, `seated`, `cancelled`, `no_show` |
| `waiting`（来店待ち） | `arrived`, `seated`, `cancelled`, `no_show` |
| `arrived`（来店） | `seated`, `cancelled` |
| `seated`（着席） | `billing`, `completed` |
| `billing`（会計待ち） | `completed` |
| `completed`（会計済み） | なし（終端） |
| `cancelled` | なし（終端） |
| `no_show`（無断キャンセル） | なし（終端） |
| `waitlisted`（キャンセル待ち） | `pending`, `confirmed`, `cancelled` |

`finalize_order()`（会計確定）は`confirmed/waiting/arrived/seated/billing`のいずれからでも
`completed`へ遷移させる（`docs/pos-flow.md`）。`cancel_public_reservation`は`pending`/`confirmed`
からのみキャンセルを許可する。

## 4. 貸切（`is_private_hire`）

- `reservations.is_private_hire boolean`（`00008_reservations_advanced.sql`で追加）
- `get_booking_availability`は、対象スロットに重複する予約の中に`is_private_hire=true`が
  1件でもあれば、通常の人数計算をスキップして**そのスロット全体を「空きなし」**として返す
  （貸切中は他の予約を一切受け付けない）
- 貸切予約自体の作成経路は公開予約RPCと同じ（`create_public_reservation`にフラグを立てて呼ぶか、
  店舗側で登録）— 貸切専用の別RPCは存在しない

## 5. キャンセル待ち（waitlist）

- テーブル: `waitlist_entries`（`status: waiting/contacted/converted/expired/cancelled`）
- 変換ロジックは**アプリ層**（`app/app/reservations/actions.ts`）で実装。DBにwaitlist専用の
  変換RPCは存在しない:
  - 予約作成時に`waitlistEntryId`を渡すと、作成成功後に対象`waitlist_entries`行を
    `status='converted'`に更新
  - 連絡済みマーク（`status='contacted'`）、期限切れ（`'expired'`）、取消（`'cancelled'`）も
    それぞれ個別のServer Actionで更新
- キャンセル待ちからの自動繰り上げ（空きが出たら自動通知等）は実装されていない
  （`docs/known-limitations.md`）

## 6. 担当者アサイン

`reservations.staff_id`（`00008`で追加）で予約ごとに担当スタッフを紐付け可能。POS側の
`orders.staff_id`とは独立した列で、予約段階の接客担当を記録する用途。
