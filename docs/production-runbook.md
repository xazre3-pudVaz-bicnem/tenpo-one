# 本番運用 Runbook

日常運用でのチェックと、よくある対応をまとめる。詳細な障害対応は docs/disaster-recovery.md。

## 日次

- CYPRESS System画面で health（app/db）・最近のエラー（system_errors）を確認。
- 前日分の店舗日次締めが全店で完了しているか（未締めは audit-data-integrity / 照合ページで検出）。
- system_errors に critical がないか。

## 週次

- `scripts/audit-data-integrity.mjs`（本番相当DBに対して）で整合性を確認（read-only）。
- クエリ遅延の傾向（Supabase Dashboard の Query Performance）。
- ストレージ使用量・DB容量の推移。

## 月次

- 各店舗の月次締め・棚卸・給与確定が運用フロー通り行われているか（店舗/経理の運用）。
- バックアップ/PITRが有効であることの再確認（本番設定）。

## デプロイ

- docs/release-strategy.md のチェックリストに従う。
- デプロイ後 `/api/health` 200 と System画面のバージョン/migration一致を確認。

## よくある対応

| 症状 | 一次対応 |
|---|---|
| ユーザーが「エラーID: ERR-xxx」を報告 | system_errors / VercelログをそのIDで検索し原因特定 |
| 特定企業だけ機能不全 | feature_flags・organizations.status・membershipを確認 |
| ログインできない | Supabase Auth状態・Site URL/Redirect設定・ユーザーstatus確認 |
| 画面が真っ白/500 | Vercelログ・直近デプロイ確認。必要ならInstant Rollback |
| 数値が合わない | 照合ページ（/app/reconciliation）・audit-data-integrityで不整合特定 |
| 未締めレジが残る | 店舗にレジ締め→店舗日次締めを依頼。放置分はaudit検出 |

## 監視すべきシグナル

- `/api/health` が継続的に 503（db障害）
- system_errors の critical / 急増
- 会計・返金の失敗（system_errors + audit_logsの不在）
- 長期の未締めレジ・未日次締め

## エスカレーション基準

- 本番設定変更・秘密鍵・外部サービス・破壊的DB操作 → 人間の承認必須。
- コードで前進修正できるもの → forward fix（docs/migration-policy.md）。

関連: docs/incident-response.md / docs/disaster-recovery.md / docs/observability.md / docs/release-strategy.md
