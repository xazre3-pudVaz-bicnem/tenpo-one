# バックアップ・復旧設計

> 実際のSupabase managed backup設定はこのドキュメントでは変更しない（本番設定はダッシュボードで人間が確認）。
> 本書はTENPO ONEとして必要な復旧設計と手順の整理。

## バックアップ対象と方式

| 対象 | 方式 | 責任 | 頻度/保持（目標） |
|---|---|---|---|
| PostgreSQL | Supabase自動バックアップ + Point-in-Time Recovery（PITR） | Supabase managed | 日次 + PITR（プラン依存・要確認） |
| Storage（documents等） | Supabaseバケット | Supabase managed | 要確認（別途エクスポートも検討） |
| migration定義 | Git（supabase/migrations） | リポジトリ | コミット毎 |
| アプリコード | Git + Vercelデプロイ履歴 | リポジトリ/Vercel | コミット毎 |
| 環境変数 | Vercel/Supabase設定 + 秘密管理（1Password等） | 運用者 | 変更時 |
| 法定rule version | DB（legal_rule_versions）→ 上記PostgreSQLに含む | Supabase | DBに準拠 |

> **BLOCKED（B: 本番設定）**: PITR保持期間・Storageバックアップ有無はSupabaseプラン設定に依存。
> 本番契約時にダッシュボードで確認・設定すること。

## 論理バックアップ（コードで用意した手段）

- `scripts/pilot-org.mjs` / seed系: テスト企業の再構築（本番復旧用ではない）
- 会計・取引の**確定データは物理削除不可**（docs/data-retention.md）。誤削除の主リスクは論理削除データ。
- 将来: `pg_dump` による定期論理バックアップをCI/cronで取得する運用を追加可能（未実装・BLOCKED B）。

## リストアドリル（ローカル/テストDBで検証可能な手順）

本番を触らずに復旧手順を確認する:

```bash
# 1. 空のローカル/テストSupabaseプロジェクトを用意（または supabase start）
# 2. migrationを順に適用（スキーマ復元）
npx supabase db push
# 3. 型生成が通ることを確認
npx supabase gen types typescript --linked > lib/database.types.ts
# 4. seedでデモデータ投入（データ復元の代替）
node --env-file=.env.local scripts/seed.mjs
# 5. 業務検証で健全性チェック
node --env-file=.env.local scripts/verify-flow.mjs
node --env-file=.env.local scripts/audit-data-integrity.mjs --strict
```

本番相当のリストアは Supabase の PITR/バックアップ復元（ダッシュボード操作）に従う。
復元後は必ず `scripts/audit-data-integrity.mjs` で整合性を確認する。

## RPO / RTO（現時点の目標値・保証値ではない）

| 指標 | 目標 | 根拠 |
|---|---|---|
| RPO（許容データ損失） | ≤ 5分 | PITRを前提とした目標。実値はSupabaseプラン設定で確定 |
| RTO（復旧時間） | ≤ 2時間 | PITR復元 + 整合性監査 + 動作確認の想定所要 |

> これらは**目標値**。正式なSLA/保証値は本番契約・Supabaseプラン確定後に更新する（BLOCKED B）。

## 誤削除への備え

- 会計/勤怠/監査データは物理削除禁止（トリガー）。誤操作の主対象は論理削除（status変更）。
- 論理削除の取り消し: status を戻す（audit_logsで操作者・時刻を特定）。
- 詳細は docs/disaster-recovery.md のケース別Runbook。

関連: docs/disaster-recovery.md / docs/data-retention.md / docs/migration-policy.md
