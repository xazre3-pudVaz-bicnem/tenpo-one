# データ保持・削除ポリシー（DELETE POLICY）

原則: **お金・勤怠・監査に関わるデータは物理削除しない**。誤操作からの復旧性を最優先する。

## 分類

### 物理削除禁止（DBトリガー/設計で強制）

| テーブル | 保護方法 |
|---|---|
| orders（paid/refunded） | prevent_paid_mutation トリガーが DELETE を拒否。取消は status='void' |
| payments / refunds | DELETEトリガーで常時拒否。元取引との関連（order_id/payment_id）を保持 |
| audit_logs | 削除UIなし・書込はlog_audit経由のみ |
| point_transactions | 削除UIなし。取消は逆仕訳（revoke/refund_return/adjust） |
| stock_movements | 削除UIなし。誤登録は逆方向のadjustmentで訂正 |
| payroll_items（approved run） | run承認後は再計算・変更UIを遮断（計算スナップショット保持） |
| time_entries（給与確定期間） | 給与runがconfirmed/approvedの期間はサーバー側でロック |

### 論理削除（status/deleted系カラム）

customers（status='deleted'・統合時は電話を退避）/ menu_items・menu_categories（deleted/hidden）/
restaurant_tables・floors / vendors / documents（status='deleted'）/ coupons（deleted/paused）/
manuals / tax_rates / inventory_items / printer_configs / reservations（cancelled/no_showは履歴として保持）

### 物理削除可（履歴価値が低い運用データ）

booking_request_logs（レート制限用・定期削除可）/ webhook_events（processed後の古い行は保守で削減可）/
notifications（既読の古い通知）/ stock_transfer_items（親transferごとcascade）

## 顧客情報の開示・削除要求への対応

- 開示: 顧客詳細の「データ書き出し」（基本情報・予約・注文・ポイント履歴のCSV、監査ログ記録）
- 削除: 論理削除+個人情報のマスキングが必要な場合は氏名/電話/メールを手動で匿名化のうえ status='deleted'
  （会計履歴は法定保存の観点から取引データとして保持。法的判断は行わず、依頼時は運営と協議）

## 復旧

- 直近データ: Supabase の Point-in-Time Recovery（docs/operations.md）
- 論理削除の取り消し: status を戻すSQL（audit_logsで削除操作者・時刻を特定可能）
