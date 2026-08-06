# 業務フロー定義

## 1. 予約〜会計の縦フロー（コア）

```
[客] /book/{slug} で日時・人数を選択
  → 空席判定 get_booking_availability(store, date, party)
     営業時間・休業日・受付締切・テーブル容量・既存予約の滞在時間重複を判定
  → 予約作成 create_public_reservation()（SECURITY DEFINER RPC・rate limit考慮）
     電話番号+氏名で customers を検索、なければ作成 → reservations(status=confirmed, code発行)
  → 完了画面に予約コード表示（/booking/{code} で確認・変更・キャンセル）

[店舗] /app/reservations 台帳に自動表示
  → テーブル割当（reservation_tables）
  → 来店 → 「着席」ボタン → reservations.status=seated / restaurant_tables.current_status=occupied
  → 台帳から「注文へ」 → orders 作成（reservation_id, customer_id, table_id, guest_count 引継ぎ）

[POS] /app/pos?order={id}
  → 商品タップで order_items 追加（価格・税率スナップショット）
  → 追加注文・数量変更・メモ・品目取消（理由必須・監査ログ）
  → 会計: 支払方法（複数併用可）・値引き・端数処理 → finalize_order()
     ├ payments 記録
     ├ orders.status=paid, business_date確定
     ├ 現金分を register_sessions の cash_transactions へ
     ├ customers.visit_count/total_spent/last_visit_at 更新
     ├ order_items→在庫連動（inventory連携品目のみ）
     ├ reservations.status=completed / テーブル=清掃中
     └ レシート画面 → ブラウザ印刷
```

## 2. ウォークイン

フロアマップ or 台帳から「ウォークイン」→ 人数・テーブル選択 → reservations(channel=walk_in, status=seated) 即作成 → そのまま注文へ。顧客紐付けは任意。

## 3. レジ締め（日次）

1. 開店時: レジ開局（opening_float=釣銭準備金、担当者）
2. 営業中: 中間入出金（両替・銀行入金等）を cash_transactions へ
3. 閉店時: 閉局 → 理論現金（開局額+現金売上−現金返金±入出金）を自動計算 → 実残高入力 → 差異と理由 → 店長承認 → daily_closings 確定
4. 締め後修正は hq_admin/店長のみ・理由必須・audit_logs 記録

## 4. 小口現金・経費

小口入出金を科目・用途・レシート画像付きで登録 → 承認待ち → 店長/経理が承認 → 月次残高へ反映。レジ現金とは別台帳（kind=petty_*）で区別。

## 5. 請求書・書類

アップロード（PDF/画像、D&D対応）→ 書類種別・取引先・金額・期限を手動入力 → 未処理→確認待ち→承認済み→支払予定→支払済み（差戻しあり）→ 期限超過は通知。ScanSnap出力PDFは保存ボックス（未仕分けリスト）へ入れて後から仕分け。

## 6. 勤怠〜給与試算

1. スタッフが出勤/退勤/休憩を打刻（共用端末はPIN選択式）
2. 打刻漏れ・遅刻はアラート表示
3. 修正申請 → 店長承認
4. 月次: payroll_run 作成 → 期間内の time_entries 集計（実働・残業・深夜）× payroll_rules + 売上実績 × commission_rules → スタッフ別プレビュー（計算根拠表示）→ 承認 → CSV出力
5. 税・社保は対象外である旨を画面に明示

## 7. 発注・在庫

発注書作成（vendor・品目・数量）→ 承認 → 発注済み → 入荷登録で stock_movements(入庫) → 在庫数量更新。棚卸: stock_counts で実数入力 → 差異を調整移動として記録。

## 8. 本社の1日

朝: 本社ダッシュボードで前日全店実績（売上・客数・差異・未締め店舗・打刻漏れ）→ 異常店舗をドリルダウン → 週次でレポート画面からCSV → 会計ソフトへ。

## 9. 通知

イベント（新規予約/キャンセル/締め未完了/差異/期限超過/承認待ち）→ notifications 挿入 → ベルに未読数。メール送信はアダプタ層（`lib/notify.ts`）で将来Resend等を接続。
