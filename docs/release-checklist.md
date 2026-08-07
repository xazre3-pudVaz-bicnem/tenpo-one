# リリースチェックリスト

本番公開前に上から順に確認する。詳細手順は docs/deployment.md / docs/operations.md。

## 1. データベース

- [ ] `npx supabase migration list` で local = remote（00001〜最新）一致
- [ ] 本番Supabaseプロジェクトは開発と別プロジェクト
- [ ] PITR（Point-in-Time Recovery）が有効なプラン
- [ ] RLS検証: `node --env-file=.env.production.local scripts/verify-flow.mjs`（デモ企業に対して）

## 2. 環境変数（Vercel）

- [ ] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
- [ ] SUPABASE_SERVICE_ROLE_KEY（Sensitive指定）
- [ ] NEXT_PUBLIC_SITE_URL（本番URL — SEO/canonical出力の条件）
- [ ] Stripe利用時: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET（Sensitive）/ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
- [ ] SUPABASE_URL / DEMO_PASSWORD / BASE_URL は**設定しない**（ローカルスクリプト専用）

## 3. Supabase設定

- [ ] Auth Site URL = 本番URL、Redirect URLs に 本番/** と localhost/**
- [ ] Email provider有効（Confirm emailオフ=招待制）
- [ ] Storage: documents（private）/ menu-images（public）バケット存在・ポリシー適用済み（migrationで自動）

## 4. ビルド・テスト

- [ ] npm run typecheck / lint / test 全通過
- [ ] npm run build 成功
- [ ] BASE_URL=本番 npx playwright test（デプロイ後）
- [ ] scripts/verify-flow.mjs（デプロイ後・デモ企業）

## 5. セキュリティ

- [ ] `.next/static` に service_role / Stripe secret が含まれない（grep）
- [ ] git履歴に実秘密鍵なし
- [ ] /api/health が200（秘密情報を含まない応答）
- [ ] セキュリティヘッダー確認（X-Content-Type-Options等。next.config.ts）

## 6. 運用準備

- [ ] デモ企業と本番企業の分離（is_demo）。本番企業は運営コンソールから作成
- [ ] cypress管理者アカウント作成（profiles.is_cypress_admin）
- [ ] 監査ログ画面の動作確認（/admin/audit-logs）
- [ ] 監視: /api/health の外形監視登録（UptimeRobot等・外部契約は任意）
- [ ] backup/復旧手順の共有（docs/operations.md）

## 7. 機器・外部連携（該当時のみ）

- [ ] Stripe: verify-stripe.mjs 通過 → Webhook本番エンドポイント登録
- [ ] プリンター実機: docs/external-blockers.md #5 の手順（未導入なら「シミュレーション」表示のまま公開可）

## 8. 最終

- [ ] docs/v0.3-manual-test.md をブラウザで一周
- [ ] タグ付与とリリースノート（CHANGELOG.md）
