# セキュリティ・インシデント対応

一般的な障害対応は docs/incident-response.md。本書はセキュリティ侵害に特化する。
バックドアは作らない（「秘密URLで管理者になれる」等は禁止）。復旧は正規の権限操作で行う。

## 深刻度（Severity）

| Sev | 定義 | 例 |
|---|---|---|
| SEV1 | テナント越境・機密情報漏洩・管理者権限奪取・Service Role漏洩 | 企業間データ漏洩・給与漏洩・cypress権限奪取・service role key流出 |
| SEV2 | 単一テナント内の不正アクセス・限定的漏洩・重要機能の悪用 | 悪意ある店長の不正返金・他店舗閲覧・アカウント乗っ取り1件 |
| SEV3 | 未遂・軽微・回避策あり | ブルートフォース試行検知・rate limit発動・軽微な情報開示 |

## 対応フロー（SEV1/2）

1. **発覚 (Detect)**: system_errors/audit_logsの異常・Security Dashboard・利用者報告（エラーID）。
2. **アクセス遮断 (Contain)**:
   - 侵害アカウント: `profiles.status='suspended'` または membership 停止 → 次リクエストで遮断（lib/auth.ts）。
   - 侵害テナント: `organizations.status='suspended'` → 業務画面操作不可（データは保持）。
   - Service Role 漏洩: Supabase ダッシュボードで鍵 rotation（docs/security/secret-rotation.md）。
3. **証拠保全 (Preserve)**: audit_logs / system_errors / Supabase Auth ログを保全。確定データは物理削除不可なので改ざんされにくい。
4. **影響範囲特定 (Scope)**: audit_logs で誰が何を・いつ閲覧/変更したか。support access ログでcypress操作を確認。`scripts/audit-data-integrity.mjs` で整合性確認。
5. **復旧 (Recover)**: 必要なら Supabase PITR（docs/backup-restore.md）。復旧後 audit-data-integrity で検証。
6. **原因修正 (Fix)**: 脆弱性を forward-fix migration / コードで塞ぐ。tests/security に回帰テストを追加。
7. **事後 (Postmortem)**: 時系列・原因・恒久対策を記録。

## ケース別

### A. 管理者アカウント侵害（cypress / org_owner）
1. 該当 profile を suspended。2. パスワードリセット強制。3. cypress権限の付与履歴を audit_logs で確認（legal_rule.activate 等の重要操作）。4. MFA未有効なら有効化（OWNER-ACTION）。

### B. Service Role 漏洩
1. **最優先**: Supabaseで service role key を rotation。2. Vercel環境変数を更新し再デプロイ。3. audit_logs/system_errors で不審な全テナントアクセスを精査（service roleはRLSバイパス可能=最重大）。4. Gitヒストリに混入していないか再スキャン。

### C. 悪意ある内部スタッフ
1. membership を suspended。2. 直近の返金/値引/給与変更/export を audit_logs で確認。3. 不正な金額操作は修正仕訳・void で是正（物理削除しない）。

### D. データ破損 / 改ざん疑い
1. audit_logs で変更経路を特定。2. 確定データ（payments/journal等）はトリガーで改ざん不可なので、draft/論理データを確認。3. 必要なら PITR で該当時点へ復元。

## 法令上の通知（BLOCKED E）
個人情報漏洩時の本人通知・当局報告の要否と期限は専門家確認（法的判断は行わない）。

関連: docs/security/secret-rotation.md / docs/security/break-glass.md / docs/backup-restore.md
