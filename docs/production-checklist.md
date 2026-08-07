# 本番公開前チェックリスト

実行手順の詳細は`docs/deployment.md`（Vercel+Supabaseの具体的な設定手順）を参照。本書は
「何が揃っていれば公開してよいか」の判定リストと、既知の残作業をまとめる。

## 環境変数（Vercel）

| 変数 | 必須 | 備考 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Sensitive指定。クライアントに渡さない |
| `NEXT_PUBLIC_SITE_URL` | ✓（本番） | 未設定だとcanonical/OG/sitemapを出さずrobots noindex |
| `STRIPE_SECRET_KEY` | 決済利用時 | **テストモードキー(`sk_test_`)から開始**。Sensitive指定 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | 決済利用時 | |
| `STRIPE_WEBHOOK_SECRET` | 決済利用時 | Sensitive指定 |

`SUPABASE_URL` / `DEMO_PASSWORD` / `BASE_URL`はローカルスクリプト専用でありVercelには設定しない。

## Supabase設定

- [ ] `supabase/migrations/00001`〜`00014`を番号順に本番プロジェクトへ適用
- [ ] Authentication → Providers でEmailを有効化（招待制運用のためConfirm emailはオフ推奨）
- [ ] Authentication → URL Configuration: Site URLを本番ドメインに、Redirect URLsに
      `https://<本番ドメイン>/**`と（必要なら）プレビューデプロイのワイルドカードを追加
- [ ] `documents` Storageバケットがmigrationで作成されていること（`00003_rls.sql`）を確認
- [ ] RealtimeのPublication（`supabase_realtime`に`orders/order_items/restaurant_tables/
      reservations`が登録されていること、`00014_realtime_indexes.sql`）を確認
- [ ] 本番用の初回CYPRESS運営アカウントを作成し、`profiles.is_cypress_admin=true`を設定
      （SQLで直接更新。UIからの昇格経路は無い）

## Smoke Test（2段構成）

1. **UIスモーク**（Playwright, `e2e/core-flow.spec.ts`）
   ```bash
   BASE_URL=https://<本番ドメイン> npx playwright test
   ```
2. **業務フロースモーク**（`scripts/verify-flow.mjs`、実データで16セクション・多数のチェックを実行）
   ```bash
   node --env-file=.env.production.local scripts/verify-flow.mjs
   ```
   **注意**: このスクリプトは実際に¥2,180等の取引を作成する。本番の顧客データ運用開始後は
   `is_demo=true`の企業に対してのみ実行すること（スクリプト自体がdemo組織を対象にする設計）。

## 決済（Stripe）を有効化する場合

- [ ] `scripts/verify-stripe.mjs`をテストキーで実行し、Terminal（simulated reader）・Checkout・
      返金・冪等性キーの動作を確認
- [ ] Webhookエンドポイント（`/api/webhooks/stripe`）をStripe Dashboardに登録し、
      `stripe listen --forward-to <本番URL>/api/webhooks/stripe`等で疎通確認
- [ ] **本番接続（本番キー・実店舗のカードリーダー登録）は現時点で未実施**。
      実施手順は`docs/payment-stripe.md`と`docs/future-integrations.md`を参照

## リリース手順

1. `npm run typecheck && npm run lint && npm run test` が全て成功
2. `git tag`でバージョン確定
3. Vercelへ連携・環境変数設定・本番デプロイ
4. Supabase Auth URL設定（上記）
5. Smoke Test（上記）
6. `NEXT_PUBLIC_SITE_URL`設定済みを確認し、LPのcanonical/sitemap/JSON-LDが出力されることを確認

## 既知の残作業（公開前に判断が必要）

`docs/known-limitations.md`・`docs/future-integrations.md`・`docs/open-questions.md`に詳細あり。
特に本番公開の意思決定に関わるもの:

- [ ] Stripe本番アカウント接続・実機カードリーダー導入（現状はテストモード+シミュレーテッドリーダーのみ）
- [ ] レシート・キッチンプリンターの実機SDK接続（現状はブラウザ印刷のみ、`printer_configs`/`print_jobs`は
      設定・キューの下地のみ）
- [ ] 給与計算は法定計算（社会保険・所得税・年末調整）を含まない「試算」である旨を運用担当者へ周知
- [ ] メール通知は送信抽象化のみで実プロバイダー未契約（`docs/open-questions.md`項目15）
- [ ] SaaS課金（`saas_subscriptions`）は設計のみで決済連携なし。契約企業のプラン変更・請求は
      現状手動運用が前提
- [ ] LINE・グルメサイト連携、会計/勤怠freee・KING OF TIME連携、請求書OCRはいずれも未実装
      （マスタ・抽象化ポイントのみ存在）
- [ ] 商用データ量（100社/1000店/1000万注文規模）を想定したインデックス設計（`00014`）は
      投入済みだが、実運用スケールでの負荷試験は未実施
- [ ] `docs/open-questions.md`の8項目（プラン価格体系、特商法等の会社情報、本番/ステージング
      Supabaseプロジェクトの用意、インボイス登録番号の扱い、給与仕様の社労士確認、メールプロバイダー
      契約、レシートプリンター機種、グルメサイト連携範囲）はクライアント確認が必要
