# v0.3 CODE COMPLETE 作業進捗（コンテキスト圧縮後はまずこれを読む）

目標: TENPO ONE v0.3.0 CODE COMPLETE（90項目指示。外部依存のみBLOCKED、他は完遂）
復帰点: タグ `checkpoint-pre-v03`。禁止事項: 本番デプロイ/Stripe実決済/外部API/秘密鍵変更/force push/migration書換/機能削除。
進行ルール: 各項目は「既に完成→テストのみ / 不足→改善 / 未実装→実装 / 外部依存→external-blockers.md」。フェーズごとに報告停止せず自走。コミットは意味単位。

## ワークストリーム計画と状態

### W0（メイン=自分）: 基盤・migration・lib
- [ ] checkpoint（済んだら✔）
- [ ] 監査grep → docs/code-complete-audit.md 骨子
- [ ] migration 00015_commerce（ポイント loyalty_settings/point_transactions + customers.point_balance/member_no、クーポン coupons/coupon_redemptions + orders.coupon_code、finalize_order v4=ポイント付与/クーポン記録/business_day、refund_orderのポイント戻し、create_public_reservation へ advisory lock+清掃バッファ、store_settings: business_day_start_hour/cleaning_buffer_minutes/allow_negative_stock/kds_settings jsonb、app_business_date関数）
- [ ] migration 00016_ops（waitlist拡張 ticket_no/called_at/seated_at/status拡張、stock_transfers+items+ship/receive RPC、budgets、daily_reports、store_tasks(+comments jsonb)、announcements+reads、manuals、approval_rules、alert_rules、restaurant_tables.pos_x/pos_y/shape、qr_token無効化(null許可)、merge_customers RPC、apply_punch v2(on_break/二重出勤/休憩中退勤自動終了)、制約: 1レジ1オープンセッションpartial unique・金額/数量CHECK、menu-images公開バケット+ポリシー）
- [ ] lib新規: receipts.ts / printing/(types,browser,mock,star-skeleton,epson-skeleton,drawer) / rate-limit.ts / approvals.ts / loyalty.ts / coupons.ts / forecast.ts / reorder.ts + lib/crm.ts拡張（ランチ/ディナー/テイクアウト/誕生月/記念日/休眠30-60-90 + audience条件ビルダー純関数）+ tests
- [ ] db push・supabase gen types → lib/database.types.ts・README追記
- [ ] セキュリティ: profiles.status停止チェックをrequireSessionへ、security headers（next.config）、/api/health

### W1エージェント（並列・第1波）
- [ ] A1 POS完成形: 商品検索/お気に入り(売れ筋)/テンキー/クイック金額(1000/5000/10000/ちょうど)/ショートカット/レシートエンジン統合(58/80mm+PrintProvider+Mock失敗系テストUI)/ドロア設定/クーポン適用/ポイント利用・付与表示/担当者変更 — app/app/pos, components/pos, app/app/orders, settings/printers
- [ ] A2 在庫実店舗化: 店舗間移動ワークフローUI(申請→発送→受取)/負在庫設定/発注提案パネル(reorder.ts)/需要予測タブ(forecast.ts)/移動理由 — inventory, purchases, components/inventory
- [ ] A3 予約・フロア・Waitlist: フロアエディタ(位置/形状)/店頭待ち(受付番号/呼出/案内)/清掃バッファ設定/割当競合検証/QRトークン無効化UI — reservations, floor, settings/tables, settings/booking
- [ ] A4 CRM完成: セグメント拡張UI/条件ビルダー/重複候補検出+Merge(RPC)/クーポン管理ページ/ポイント設定+顧客ポイント履歴/顧客データエクスポート — customers, components/customers, 新 app/app/coupons or settings/loyalty

### W2エージェント（第2波）
- [ ] B1 経理: approval_rules設定UI+金額別承認者解決(lib/approvals)/OCRアダプタUI(未接続表示+Mock)/Inbox進捗・重複検知 — invoices, expenses, cash, settings
- [ ] B2 労務: 打刻厳密化UI(休憩中警告)/シフト警告(連勤・週時間)/人件費vs予算/給与の適用期間別ルール解決+calc_version — attendance, shifts, payroll
- [ ] B3 分析・運営: 予算管理CRUD+達成率+線形着地/日報(自動生成+コメント+承認+検索)/タスク/お知らせ/通知センター強化+閾値設定(alert_rules)ダッシュボード連動 — reports, dashboard, 新tasks/announcements/daily-reports/budgets
- [ ] B4 プラットフォーム: コマンドパレット+グローバル検索(Cmd+K)/PWA(manifestリンク+PNGアイコン)/オフラインバナー+POSガード/healthのadmin表示/プラン上限+subscription mock+利用量計測/オンボーディング完了%+誘導/連携センター/ヘルプ(?)+ショートカット一覧 — layout系, admin, settings, onboarding

### W3（最終波）
- [ ] C1 Import/Export: CSVインポートウィザード(商品/顧客/仕入先/在庫、検証→プレビュー→一括、スタッフは招待フロー案内)/Export期間強化
- [ ] C2 テスト拡張: verify-flow並行性(同時会計/同時予約/同時レジ開局)+新機能チェック(ポイント/クーポン/移動/待ち)/Playwright全ルート巡回(console error検出)
- [ ] C3 Docs: code-complete-audit / data-retention / state-machines / backup-operations(operations拡張) / external-blockers / release-checklist / CHANGELOG / v0.3-manual-test / demo-script / v0.3-code-complete-report
- [ ] 最終: 全テスト → v0.3.0 タグ

## 判断メモ（既に完成→再実装しない）
- 伝票分割/統合/再会計/二重会計防止=v0.2済 / KDSステーション3種=済（追加: 焼き場等はstation自由化せず3種維持+集約表示/音/閾値設定をA1でなくB3?→KDSは既存3種+閾値設定・集約・音をA1に含めず**W0でkds_settings追加→A3に隣接せずKDS専任は置かずB4へ小タスク**→実際はA1(POS)エージェントにKDS集約/音/閾値も含める）
- Feature flags強制/オンボーディング/Realtime/監査ビューア/プリンタ設定UI=v0.2済（状態表示をSimulation表記へ=A1）
- 店舗別設定継承(72): 全面実装せず、alert_rules(org既定+store override)で本パターンを実装しdocsへ設計記載
- コンポーネント大規模整理(61): 過剰抽象化回避のため見送り、audit記録のみ
- DB types(75): 生成ファイル提供+README。全面適用は段階導入とdocs記載

## BLOCKED（external-blockers.mdへ集約）
Stripe鍵/Webhook/Terminal実機、プリンター・ドロア実機、freee/KOT/LINE/予約サイトAPI、本番ドメイン/デプロイ、正式税・社保計算、メール/SMS送信

## コミット済みログ（追記していく）
- checkpoint: chore: checkpoint before v0.3 code complete
