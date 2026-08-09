# 秘密情報のローテーション手順

秘密値はソースコードに置かない。すべて環境変数（Vercel / Supabase / ローカル .env.local）。
`.env*` は .gitignore 済み・Git非追跡（確認済み）。`.env.example` には値を入れず名前のみ。

## 対象の秘密

| 秘密 | 所在 | 影響度 |
|---|---|---|
| SUPABASE_SERVICE_ROLE_KEY | Vercel/ローカル env | 最重大（RLSバイパス可能） |
| SUPABASE anon / publishable key | 公開可（RLSが防御） | 低（RLS前提） |
| SUPABASE JWT secret | Supabase内部 | 重大（全JWT無効化に影響） |
| STRIPE_SECRET_KEY | Vercel/ローカル env | 重大（決済） |
| STRIPE_WEBHOOK_SECRET | Vercel/ローカル env | 中 |
| ANTHROPIC_API_KEY 等（ブログ自動投稿があれば） | GitHub Secrets | 中 |

## ローテーション手順（漏洩時 / 定期）

> Claude はダッシュボードを操作できない。以下は運営者が実施。

### Service Role Key
1. Supabase ダッシュボード → Project Settings → API → `service_role` の Reset/Roll。
2. 新しい値を Vercel（Project → Settings → Environment Variables）の `SUPABASE_SERVICE_ROLE_KEY` に更新。
3. ローカル `.env.local` も更新。
4. Vercel を再デプロイ（環境変数変更を反映）。
5. audit_logs / system_errors で漏洩期間中の不審アクセスを精査。

### Stripe Secret / Webhook Secret
1. Stripe ダッシュボード → Developers → API keys で該当キーを Roll。
2. Vercel の `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` を更新 → 再デプロイ。
3. Webhook エンドポイントの署名シークレットを新値に。

### Supabase JWT Secret（最終手段・全セッション無効化）
1. Supabase → Settings → API → JWT Settings で rotate。
2. 全ユーザーが再ログイン必要。営業時間を避けて実施。

## ローテーション後の確認
- `/api/health` が 200・db=ok・auth=ok。
- 主要フロー（ログイン・POS会計1件）のスモークテスト。
- `scripts/audit-data-integrity.mjs --strict`。

## 定期方針（推奨）
- Service Role: 少なくとも年1回、および担当者離任時。
- Stripe: 決済インシデント時。
- 漏洩が疑われたら即時（docs/security/incident-response.md ケースB）。

関連: docs/security/incident-response.md / docs/security/OWNER-ACTION-REQUIRED.md
