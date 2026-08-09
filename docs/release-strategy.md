# リリース戦略

## 構成

- **アプリ**: GitHub `main` → Vercel 自動デプロイ（hnd1リージョン）。
- **DB**: `supabase/migrations` を `supabase db push` で適用（手動または将来CI）。
- **バージョン**: `package.json` の version と Git tag（v0.x.y）。health/System画面で確認可能。

## リリース種別

| 種別 | 内容 | 手順 |
|---|---|---|
| アプリのみ | UI/ロジック（DB変更なし） | mainへマージ → Vercel自動デプロイ |
| DB + アプリ | migration追加あり | DB migration先行 → アプリデプロイ（Expandパターン・migration-policy.md） |
| 破壊的DB | DROP/RENAME/NOT NULL等 | Expand/Contractで複数デプロイに分割 |

## デプロイ順序の原則

1. **後方互換なmigrationを先に適用**（旧アプリが新DBで動く状態を作る）。
2. アプリをデプロイ。
3. 破壊的な後始末（Contract）は全アプリが新版になってから別デプロイで。

## Feature Flag

- 企業単位の機能フラグ（feature_flags・lib/features.ts）で、大きな変更をデプロイ直後に全企業ONにしない
  運用が可能。段階ロールアウト・特定企業での先行検証に使う。
- フラグ行がなければ既定ON、enabled=falseで無効。

## Rollback

- **アプリ**: Vercelの previous deployment へ Instant Rollback（DB非破壊なら即復旧）。Git tagでも特定可能。
- **DB**: rollbackは単純でない（データ損失リスク）ため **forward fix を基本**。打ち消すmigrationを追加。
  Expandパターンを守っていれば、アプリだけ戻しても旧DBスキーマと矛盾しにくい。

## リリースチェックリスト（デプロイ前）

- [ ] `npx tsc --noEmit` / `npx eslint . --max-warnings=0`
- [ ] `npx vitest run`（TZ=UTC）全GREEN・テスト数が減っていない
- [ ] `npm run build` 成功
- [ ] `npx playwright test` 全GREEN
- [ ] verify-flow / verify-backoffice / verify-accounting-consistency / verify-store-day 全GREEN
- [ ] `scripts/audit-data-integrity.mjs --strict`（本番前は対象DBで）
- [ ] 新規migrationのみ（既存改変なし）を `git diff` で確認
- [ ] `supabase migration list` で local=remote
- [ ] `lib/database.types.ts` 再生成済み
- [ ] backup/PITRが有効であることを確認（本番）
- [ ] 環境変数（Supabase URL/anon/service role・NEXT_PUBLIC_SITE_URL・Stripe系）設定確認
- [ ] Supabase Auth の Site URL / Redirect URL 設定確認
- [ ] 破壊的変更はExpand/Contractに分割済み
- [ ] feature flagの初期状態を意図通りに設定
- [ ] スモークテスト（ログイン・POS会計1件・締め）を本番URLで実施

## デプロイ後

- `/api/health` が 200・db=ok を確認。
- CYPRESS System画面でバージョン・migration・エラー数を確認。
- 数分間 system_errors の急増がないか監視。

関連: docs/migration-policy.md / docs/release-checklist.md / docs/deployment.md / docs/production-runbook.md
