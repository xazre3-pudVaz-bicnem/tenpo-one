# 画面構成・情報設計

> 本書は初期設計時のIA。以降追加された `/app/kitchen`（KDS）・`/app/onboarding`・`/app/menu`・
> `/app/costing/[menuItemId]`・`/app/settings/payments`・`/order/[storeSlug]/[tableToken]`（QRオーダー）
> は未反映。最新のルート構成は `docs/architecture.md`、各機能の詳細は `docs/kds.md` /
> `docs/qr-order.md` / `docs/inventory-flow.md` を参照。

## 公開画面（未ログイン）

| パス | 内容 |
|---|---|
| `/` | サービス紹介（ヒーロー・課題・機能・連動フロー・FAQ・CTA） |
| `/pricing` | 料金・プランページの下地 |
| `/login` | ログイン |
| `/reset-password` → `/reset-password/update` | パスワード再設定 |
| `/book/[storeSlug]` | 店舗別オンライン予約（空席検索→入力→確認） |
| `/book/[storeSlug]/complete` | 予約完了 |
| `/booking/[code]` | 予約確認・変更・キャンセル（予約コード+電話番号で照合） |
| `/privacy` / `/terms` | プライバシーポリシー・利用規約 |

## 管理画面 `/app`（要ログイン・店舗コンテキスト）

| パス | 画面 | 主要素 |
|---|---|---|
| `/app/dashboard` | ダッシュボード | 本日売上・予約・客数・アラート。本社は全店合計+店舗比較 |
| `/app/reservations` | 予約台帳（タイムライン） | テーブル×時間軸、状態色分け、D&D割当は将来 |
| `/app/reservations/calendar` | カレンダー表示 | 月/週の予約件数・人数 |
| `/app/reservations/list` | リスト表示 | 検索・絞込・CSV、手動予約・ウォークイン登録 |
| `/app/floor` | フロアマップ | テーブル状態一覧、着席/清掃/会計への遷移 |
| `/app/pos` | POSレジ | 左:商品グリッド 右:伝票。会計モーダル |
| `/app/orders` | 注文・取引履歴 | 検索、明細、取消・返金（権限制） |
| `/app/customers` | 顧客管理 | 一覧/検索/タグ、詳細で来店・注文履歴 |
| `/app/cash` | レジ締め・小口現金 | セッション開閉、入出金、差異、承認 |
| `/app/expenses` | 経費 | 小口経費の科目別一覧 |
| `/app/invoices` | 請求書・書類 | アップロード、状態管理、期限アラート |
| `/app/vendors` | 仕入先 | 取引先マスタ |
| `/app/purchases` | 発注 | 発注書作成・承認・入荷 |
| `/app/inventory` | 在庫 | 数量・入出庫・棚卸 |
| `/app/attendance` | 勤怠 | 打刻画面+勤怠一覧+修正申請承認 |
| `/app/shifts` | シフト | 週別シフト表・希望提出 |
| `/app/payroll` | 給与・歩合 | ルール設定、期間集計、プレビュー、承認、CSV |
| `/app/reports` | レポート | 期間/店舗/軸別グラフ+明細ドリルダウン |
| `/app/staff` | スタッフ管理 | 招待・ロール・店舗割当 |
| `/app/settings` | 設定 | 店舗情報・営業時間・テーブル・メニュー・税率・予約設定・プリンター |
| `/app/notifications` | 通知 | アプリ内通知一覧 |

## CYPRESS管理画面 `/admin`（cypress_adminのみ）

| パス | 内容 |
|---|---|
| `/admin/organizations` | 契約企業の作成・管理 |
| `/admin/stores` | 全店舗一覧 |
| `/admin/users` | 全ユーザー検索 |
| `/admin/plans` | プランマスタ下地 |
| `/admin/feature-flags` | 機能フラグ |
| `/admin/support` | サポートアクセス（操作ログ必須） |
| `/admin/audit-logs` | 監査ログ横断検索 |

## ナビゲーション

- **PC**: 左サイドバー（濃紺 #0F1120）。グループ: ホーム / 予約 / 店舗運営(POS・フロア・注文) / 顧客 / お金(レジ・経費・請求書) / 仕入・在庫 / 労務(勤怠・シフト・給与) / 分析 / 設定
- **スマホ**: 下部ナビ5つ（ホーム・予約・POS・勤怠・その他）
- **ヘッダー**: 店舗切替セレクター（アクセス可能店舗のみ、本社は「全店舗」選択可）・通知ベル・ユーザーメニュー
- 店舗コンテキストはCookie保持。全画面が選択店舗でフィルタされる

## 状態設計

- 全一覧: ローディング（スケルトン）/ 空状態（案内+プライマリアクション）/ エラー状態（再試行）
- フォーム: Zod検証、送信中disabled、成功トースト、失敗時は入力値保持
- 破壊的操作（削除・取消・返金・締め後修正）: 確認ダイアログ+理由入力
