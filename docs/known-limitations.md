# 既知の制限

コード中のコメント・実装の欠落箇所から収集した、現状の実装上の制限一覧。「未実装」と「対応済みだが
簡易ロジック」を区別して記載する。外部連携の状況は`docs/future-integrations.md`を参照。

## UI・操作性

- **予約タイムラインのドラッグ&ドロップは未実装**。`app/app/reservations/actions.ts:290`に
  「ドラッグ&ドロップは未実装（将来対応時はタイムライン側からこのactionを呼び出す想定）」と
  明記されており、対象の`moveReservation`アクション自体は存在するが、呼び出し元のUIが無い
- **キャンセル待ちからの自動繰り上げは無い**。`waitlist_entries`のステータス変換
  （`waiting/contacted/converted/expired/cancelled`）はアプリ層で手動操作を前提にしており、
  空きが出た際の自動通知・自動昇格ロジックは実装されていない

## QRオーダー

- **QRテーブルの画像はHTTP URLのみ**。QRコード生成は`qrcode`パッケージでURLを画像化する方式で、
  トークン自体は`restaurant_tables.qr_token`（DB生成のランダム文字列）。印刷用画像の配信経路に
  特別な保護は無く、URLを知っていれば誰でもアクセスできる想定（店舗が物理的に管理するテーブル
  設置QRコードという運用前提）
- **匿名ユーザーはRealtime購読の対象外**。QR客側の注文状況表示（`get_qr_order_status`）は
  Realtime購読ではなく、`components/qr-order/order-status-view.tsx`による**10秒間隔のポーリング**
  （`setInterval(fetchStatus, 10000)`）で実現している。POS/KDS側は同じデータをRealtimeで
  即時受信するため、QR客側の表示にはポーリング間隔分（最大10秒）のタイムラグがありうる

## CRM・セグメント集計

- **顧客一覧・セグメント集計クエリは10,000件上限**。`app/app/customers/page.tsx`の一覧取得・
  セグメント集計クエリが`.limit(10000)`で打ち切られる（複数箇所）。10,000顧客を超える組織では
  集計結果が不完全になりうる
- 運営コンソールのユーザー一覧（`app/admin/_utils.ts`の`listAllAuthUsers`）は最大2,000ユーザー
  （10ページ×200件）で打ち切られ、`truncated`フラグをUIに表示する
  （`app/admin/users/page.tsx:66`, `app/admin/organizations/page.tsx:99`）

## 給与計算（`lib/payroll.ts`）

- **社会保険料・所得税・年末調整等の法定計算は対象外**。ファイル冒頭で明示されており、
  算出額はあくまで「試算」。実際の支給額計算には別途、税理士・社労士の確認が必要
  （`docs/open-questions.md`項目7・8・13）
- 深夜時間の算出は「休憩は日中から控除したとみなす簡易計算」（`lib/payroll.ts:22`付近のコメント）
- 月給者の割増計算に使う基礎時給は「1ヶ月21日×8時間」の固定仮定であり、実際の暦日数・
  所定労働日数は考慮しない（`lib/payroll.ts:81`付近）
- 変形労働時間制（変形労働時間制）は非対応（`docs/open-questions.md`項目8）
- 給与計算そのものを行うSQL RPCは存在せず、`payroll_runs.status`（draft/confirmed/approved）の
  ライフサイクル管理と実際の計算（Server Actionが`lib/payroll.ts`を呼ぶ）が分離している

## 在庫

- **仕入単位→在庫単位の換算係数（`purchase_to_stock_factor`）を適用するSQL関数が無い**。
  列自体は`00013_hardening_units_qr.sql`で追加済みだが、`apply_stock_receipt`はこの列を
  参照するよう再定義されていない。換算はアプリケーション側（`lib/units.ts`）の責務
- **棚卸差異（`stock_counts`/`stock_count_items`）を計算・反映するSQL関数が無い**。
  差異の算出・在庫数量への反映はアプリ層のServer Actionが担う
- 在庫単価は円未満を四捨五入するため、少額品目（1g未満の単価等）で無視できない誤差が生じうる。
  `lib/units.ts`の`hasCostPrecisionRisk`が5%超の誤差を検知して警告する仕組みはあるが、
  単位設定自体（例: gではなく100gを在庫単位にする）はユーザー判断に委ねられる

## 決済（Stripe）

- POS対面決済（Terminal）は**シミュレーテッドリーダーのみ検証済み**。実機カードリーダーの
  導入・登録手順は`docs/payment-stripe.md`にあるが、実施は未完了
- 決済プロバイダーは**Stripeのみ実装**。型定義（`lib/payments/types.ts`）には
  `square | airpay | stera | paygate`が将来候補として存在するが、`lib/payments/index.ts`の
  `ADAPTERS`には登録されておらず、指定すると`未対応の決済プロバイダーです`で例外になる
- プロバイダー選択は現状ハードコード（`getPaymentProvider()`の既定値`'stripe'`）。
  組織ごとにプロバイダーを選べる`payment_providers`テーブルは存在するが、選択ロジックへの
  接続は未実装

## 注文・会計

- **伝票の分割・統合・返金にSQL RPCは無い**。分割・統合はServer Action（`splitOrder`/
  `mergeOrders`、`app/app/pos/actions.ts`）で`orders.source_order_id`を使って実装しており、
  DBレベルのトランザクション保証（`finalize_order`のような単一RPC）ではなく複数クエリの連続実行
  になっている
- 返金（`refund_order` RPC）は在庫・予約ステータスを元に戻さない（会計の逆操作としてのみ機能する）

## 予約

- 貸切予約（`is_private_hire`）専用の作成RPCは無く、通常の予約作成フローでフラグを立てる想定
- 予約ステータスの遷移順序（`pending→confirmed→...`）はアプリ層（`lib/reservations.ts`の
  `RESERVATION_TRANSITIONS`）でのみ検証されており、DBのCHECK制約は取りうる値の列挙のみで
  遷移順序を強制しない。RPC以外の経路（Supabase Studio等）から直接UPDATEすれば任意の遷移が可能

## RLSとアプリ権限の同期

`lib/permissions.ts`（アプリ層の権限マトリクス）と`supabase/migrations`のRLSポリシー
（`app_role_in()`等）は、思想は同じだが実装は独立している。片方を変更してももう片方は
自動追従しないため、権限を変更する際は両方を手動で揃える必要がある
（`docs/permissions.md`「実装方式」参照）。
