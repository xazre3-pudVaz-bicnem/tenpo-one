# 観測性（Observability）

外部監視SaaS（Sentry/Datadog等）はまだ接続しない。将来接続できる基盤をコードで用意する。

## エラーID（ユーザー↔内部の橋渡し）

- ユーザーには「処理に失敗しました（エラーID: ERR-XXXXXX）」を表示（lib/observability.ts `userFacingError`）。
- 同じIDで内部の構造化ログ・system_errors（DB）を検索できる。
- IDは紛らわしい文字を除いた6桁（`newErrorId`）。

## 構造化ログ

- `logStructuredError(errorId, message, ctx)` が1行JSONを `console.error` へ出力（Vercel関数ログで機械可読）。
- 記録項目: level / errorId / message(500字) / route / organizationId / storeId / userId / requestId / detail / ts。
- **PII・秘密値は記録しない**: `sanitizeDetail` が pass/secret/token/key/authorization/cookie/bank/salary キーを除去。
- `console.log` の乱用をやめ、重要エラーは本層を通す。

## system_errors（DB永続化・migration 00029）

- 監査ログ（audit_logs = 業務操作の証跡）と**分離**したシステムエラー専用テーブル。
- 書込は `log_system_error` RPC（SECURITY DEFINER）経由のみ。閲覧は CYPRESS運営のみ（RLS）。
- severity: warning / error / critical。

## Health Check

- `/api/health`: app / db（RESTルートで疎通・5秒タイムアウト）/ dbLatencyMs / responseMs。秘密値は返さない。
- 正常時200・db異常時503。

## Admin System 画面（CYPRESS運営）

- アプリバージョン・migration適用状況・health・環境（本番/プレビュー）・テナント/店舗/ユーザー数・
  最近のエラー（system_errors）を確認。秘密情報は表示しない。

## アラート基盤（ルールベース・外部通知は未接続）

- 既存の異常検知（components/dashboard/alerts.ts）は業務アラート（現金差異・未締め等）。
- システム面のルール候補（将来 cron/監視で評価）:
  - 一定時間内の system_errors 急増（critical含む）
  - 会計/返金の失敗率上昇
  - 長時間の未締めレジ（audit-data-integrity と連携）
  - db degraded（/api/health 継続503）
- 外部通知（メール/Slack/PagerDuty）は接続時にアダプタを追加（**BLOCKED D**）。

## 将来の外部監視接続（差し替えポイント）

- lib/observability.ts の `logStructuredError` / captureServerError にSDK送信を追加すれば
  既存の全呼び出し箇所が自動的に外部監視へ流れる設計。

関連: docs/incident-response.md / docs/production-runbook.md / docs/security.md
