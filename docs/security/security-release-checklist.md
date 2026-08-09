# セキュリティ・リリースチェックリスト

本番デプロイ前に確認する。既存の [../release-checklist.md](../release-checklist.md) /
[../production-checklist.md](../production-checklist.md) と併用。

## 1. コード側（自動で確認できる）
- [ ] `npx tsc --noEmit` … 型エラー 0
- [ ] `npx eslint .` … lint 通過
- [ ] `npx vitest run` … 全ユニット通過（`tests/security/` 含む）
- [ ] `node --env-file=.env.local scripts/verify-security.mjs` … 45/45
- [ ] `node --env-file=.env.local scripts/verify-security-fortress.mjs` … 14/14
- [ ] 業務回帰: verify-flow / verify-backoffice / verify-accounting-consistency / verify-store-day … GREEN
- [ ] 新規マイグレーションは**追記のみ**（既存を書き換えていない）
- [ ] 関数を再定義した場合、REVOKE/GRANTを再適用した（[database-grants.md](./database-grants.md) §1.1）
- [ ] 秘密値がコード・コミットに含まれていない（`NEXT_PUBLIC_*` に秘密を置いていない）

## 2. 手動設定（ダッシュボード / [OWNER-ACTION-REQUIRED.md](./OWNER-ACTION-REQUIRED.md)）
- [ ] Supabase: 漏洩パスワード保護・パスワード要件・MFA・バックアップ
- [ ] Vercel: 環境変数（秘密の可視性）・WAF・Preview保護・`NEXT_PUBLIC_SITE_URL`
- [ ] GitHub: ブランチ保護・シークレットスキャン・Dependabot・CIゲート

## 3. デプロイ直後の検証
- [ ] `curl -I https://<本番>/` … CSP / HSTS / X-Frame-Options 等のヘッダが付いている
- [ ] 未ログインで `/app/*` が `/login` へリダイレクトされる
- [ ] `/admin/*` が CYPRESS 以外で 403/リダイレクト
- [ ] ログイン後 `?next=//evil.com` が自サイト内へ丸められる（[safe-redirect](../../lib/safe-redirect.ts)）
- [ ] 運営セキュリティダッシュボード `/admin/security` が表示され、異常イベントが確認できる

## 4. CIゲート雛形（`.github/workflows/security.yml`）
```yaml
name: security
on: [pull_request]
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint .
      - run: npx vitest run tests/security/
```
> DB接続を要する `scripts/verify-security*.mjs` はSecrets（テスト用プロジェクト）を用意できる場合のみ
> CIに追加する。実顧客データ・本番は使わない。

## 5. ロールバック
- 問題検知時の手順は [incident-response.md](./incident-response.md) / [../disaster-recovery.md](../disaster-recovery.md)。
- DBマイグレーションは前方専用のため、ロールバックは**打ち消しマイグレーションの追加**で行う。
