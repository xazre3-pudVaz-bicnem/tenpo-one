# 外部依存ブロッカー一覧（BLOCKER REGISTRY）

コードだけでは完成できない項目の集約。準備が整い次第、記載の手順で接続する。
v0.3.0 CODE COMPLETE 時点で、以下以外にコード側の未完了項目はない（docs/v0.3-code-complete-report.md参照）。

| # | 項目 | 必要なもの | なぜ必要 | 準備できた後の手順 |
|---|---|---|---|---|
| 1 | Stripe Test決済 | Stripe Test Secret Key / Publishable Key | POS端末決済・予約事前決済の疎通検証（基盤実装済み） | `.env.local` へ `STRIPE_SECRET_KEY`（sk_test_）設定 → `node --env-file=.env.local scripts/verify-stripe.mjs` → 設定→決済・端末でsimulated reader登録 |
| 2 | Stripe Webhook | Webhook Signing Secret | 決済状態の自動反映（署名検証実装済み） | Dashboard→Webhooks→エンドポイント登録（/api/webhooks/stripe・5イベント）→ `STRIPE_WEBHOOK_SECRET` 設定。ローカルは `stripe listen` |
| 3 | Stripe Terminal実機 | 日本対応リーダー実機・Location登録 | 対面カード決済の本番運用 | docs/payment-stripe.md「実機Terminal導入時に必要な作業」参照。完了まで「テストモード」表示維持 |
| 4 | Stripe Billing（SaaS課金） | Live契約・Price設定 | 契約企業への月額課金 | saas_subscriptions（モック管理UI実装済み）へBilling webhookを接続。plans.features のstripe_price_id対応付け |
| 5 | レシートプリンター実機 | EPSON TM系 or Star mC系 実機 + SDK検証 | 紙レシート・キッチン伝票の自動印刷 | lib/printing/providers.ts の epson/star skeleton を各SDK（ePOS-Print / WebPRNT）で実装 → printer_configs.connection_type 切替 → is_verified=true は実機検証後のみ |
| 6 | キャッシュドロア実機 | プリンター経由接続のドロア | 現金会計時の自動開放 | プリンターSDK実装内で drawer kick を実装（DrawerProvider interface へ差し込み）。設定UI・自動開放判定（shouldOpenDrawer）は実装済み |
| 7 | メール送信 | Resend等の契約・APIキー | 予約確認/リマインド・通知メール | notifications 基盤へアダプタ追加（lib/notify として新設）。テンプレは予約確認/リマインド/承認依頼から |
| 8 | LINE連携 | LINE公式アカウント・Messaging API | LINE予約・通知・販促配信 | campaignAudience（lib/crm matchesAudience）が抽出条件を提供済み。reservation_sources に経路記録済み |
| 9 | グルメサイトAPI | 各社API契約 | 外部予約の自動取込 | reservations.source_id / created_via='manual' の手動登録で現在は運用。API毎のアダプタを追加 |
| 10 | freee / KING OF TIME | 各API credentials | 会計・勤怠の外部連携 | 現在はCSVエクスポートで代替（勤怠・給与・売上・経費すべてCSV対応済み） |
| 11 | OCR | Cloud Vision / Document AI 等の契約 | 請求書の自動読取 | DocumentExtractionProvider interface（components/invoices/extraction.ts）へ実装を差し込み。documents.ocr_payload 格納構造は定義済み |
| 12 | 本番ドメイン・デプロイ | Vercelプロジェクト・ドメイン | 本番公開 | docs/deployment.md + docs/release-checklist.md の手順。NEXT_PUBLIC_SITE_URL設定でSEO出力が有効化 |
| 13 | 正式な給与計算 | 社労士・税理士の仕様確認 | 所得税・社会保険・年末調整 | 現在は「試算」明示。payroll_items のbreakdownは正式計算の入力として利用可能 |
| 14 | プッシュ通知/SMS | FCM・SMS事業者契約 | ウェイティング呼出の外部通知 | 現在はシステム内呼出表示。waitlist_entries.called_at をトリガに接続 |
