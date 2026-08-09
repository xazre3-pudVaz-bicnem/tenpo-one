# オーナー作業が必要なセキュリティ設定（OWNER ACTION REQUIRED）

このファイルは **コードだけでは完結しない** セキュリティ対策の一覧です。
Vercel / Supabase / GitHub の各ダッシュボードで**人が設定**する必要があります。
**これらが完了するまで、該当の防御は有効になっていません。**（＝「実装済み」ではありません）

エンジニアでない方でも実施できるよう、画面の場所と手順を記します。所要目安は各30分以内です。
優先度: 🔴今すぐ / 🟠公開前 / 🟡運用開始後すみやかに。

---

## A. Supabase（データベース・認証）

ダッシュボード: https://supabase.com/dashboard → 対象プロジェクト

### 🔴 A-1. 漏洩パスワード保護を有効化
- 場所: Authentication → Policies（または Settings → Auth）→ "Leaked password protection"
- 操作: **Enable**（HaveIBeenPwned照合。流出済みパスワードの利用を拒否）

### 🔴 A-2. パスワード最小要件
- 場所: Authentication → Providers → Email
- 操作: 最小文字数を **12** 以上、要求文字種を有効化。

### 🟠 A-3. 多要素認証（MFA）を有効化
- 場所: Authentication → Providers → 「Multi-Factor Authentication (TOTP)」
- 操作: **Enable**。運用ロールアウトは [mfa-rollout.md](./mfa-rollout.md) を参照
  （まずCYPRESS運営・org_ownerから必須化）。

### 🟠 A-4. Service Role キーの管理
- Service Role キーは**サーバー環境変数のみ**に置き、クライアント・Gitへ絶対に置かない。
- 定期ローテーション手順は [secret-rotation.md](./secret-rotation.md)。
- 場所: Settings → API → Project API keys（漏洩時は "Reset" でローテーション）。

### 🟠 A-5. 自動バックアップ / PITR
- 場所: Database → Backups
- 操作: 日次バックアップの有効化を確認。可能ならPITR（Point-in-Time Recovery）を有効化。
- 復旧手順は [../disaster-recovery.md](../disaster-recovery.md)。

### 🟡 A-6. ログドレイン（失敗ログイン等の監視）
- 場所: Settings → Log Drains（有料プラン）
- 操作: 認証失敗・監査ログを外部（監視SaaS/ストレージ）へ転送。
- これが無いと、運営セキュリティダッシュボードの「失敗ログインの網羅監視」は行えません
  （現状はアプリDB内の `audit_logs` / `system_errors` と直近サインインのみ表示）。

### 🟡 A-7. Storage バケットの再確認
- バケット `documents` は非公開・20MB上限・許可MIME（pdf/png/jpeg/webp）で作成済み
  （[00003_rls.sql](../../supabase/migrations/00003_rls.sql)）。ダッシュボードで設定が反映されているか確認。
- 詳細は [../storage-security.md](../storage-security.md)。

---

## B. Vercel（ホスティング・ネットワーク）

ダッシュボード: https://vercel.com → 対象プロジェクト

### 🔴 B-1. 環境変数の設定と可視性
- 場所: Settings → Environment Variables
- `SUPABASE_SERVICE_ROLE_KEY`・`STRIPE_SECRET_KEY` 等の秘密値は **Production/Preview** に限定し、
  `NEXT_PUBLIC_*` でないことを確認（`NEXT_PUBLIC_` はブラウザへ露出する）。
- `NEXT_PUBLIC_SITE_URL` を本番ドメインで設定（未設定だと canonical/OG/sitemap を出さず
  robots を Disallow にする安全側動作になる）。

### 🟠 B-2. WAF / ファイアウォール
- 場所: Settings → Firewall（Vercel WAF）
- 操作: 攻撃的トラフィック・レート超過のブロックルールを有効化。
  アプリ側の `lib/rate-limit.ts` は単一インスタンス内メモリのため、面での防御はWAFで補完。

### 🟠 B-3. デプロイ保護
- 場所: Settings → Deployment Protection
- 操作: Preview環境に Vercel Authentication を有効化（未公開URLの無断閲覧を防止）。

### 🟡 B-4. ドメイン・HTTPS
- 独自ドメインのHTTPS強制（Vercel既定で有効）。HSTSはアプリ側ヘッダでも付与済みか確認。

---

## C. GitHub（ソース管理）

リポジトリ: Settings

### 🔴 C-1. ブランチ保護（main）
- 場所: Settings → Branches → Add rule（`main`）
- 操作: PR必須・レビュー必須・ステータスチェック必須（CIのセキュリティゲート、下記C-4）・
  force push禁止・直push禁止。

### 🔴 C-2. シークレットスキャン / Push Protection
- 場所: Settings → Code security and analysis
- 操作: Secret scanning・Push protection を **Enable**（秘密のコミット混入を防止）。

### 🟠 C-3. Dependabot
- 場所: 同上
- 操作: Dependabot alerts・security updates を **Enable**（依存の既知脆弱性を追跡）。

### 🟠 C-4. CIセキュリティゲート
- `.github/workflows` にセキュリティチェック（typecheck・`vitest run tests/security/`・lint）を追加し、
  C-1の必須チェックに指定。ワークフロー雛形は [security-release-checklist.md](./security-release-checklist.md)。

### 🟡 C-5. 過去コミットの秘密混入確認
- **重要**: 秘密値が過去コミットに含まれている可能性がある場合、勝手にGit履歴を書き換えないこと。
  発見時は SECURITY CRITICAL として扱い、キーのローテーション（A-4）を最優先で実施し、
  影響範囲を確認のうえで履歴処理を判断する。手順は [incident-response.md](./incident-response.md)。

---

## D. 完了チェック

| 区分 | 項目 | 完了 |
| --- | --- | --- |
| Supabase | A-1 漏洩パスワード保護 | ☐ |
| Supabase | A-2 パスワード要件 | ☐ |
| Supabase | A-3 MFA有効化 | ☐ |
| Supabase | A-4 Service Roleキー管理 | ☐ |
| Supabase | A-5 バックアップ/PITR | ☐ |
| Supabase | A-6 ログドレイン | ☐ |
| Supabase | A-7 Storage設定確認 | ☐ |
| Vercel | B-1 環境変数 | ☐ |
| Vercel | B-2 WAF | ☐ |
| Vercel | B-3 デプロイ保護 | ☐ |
| Vercel | B-4 ドメイン/HTTPS | ☐ |
| GitHub | C-1 ブランチ保護 | ☐ |
| GitHub | C-2 シークレットスキャン | ☐ |
| GitHub | C-3 Dependabot | ☐ |
| GitHub | C-4 CIゲート | ☐ |
| GitHub | C-5 過去コミット確認 | ☐ |

すべて完了するまで、TENPO ONE のセキュリティ体制は「コード実装分のみ」であり、
本書の項目は未適用であることを関係者で共有してください。
