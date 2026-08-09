# TENPO ONE セキュリティ要塞化（Security Fortress）報告書

対象: TENPO ONE（マルチテナント飲食店SaaS / Next.js 16 + Supabase）
方針: 多層防御（Prevent → Detect → Contain → Audit → Recover）。「絶対安全」を前提にせず、
1つの層が破られても次の層で守る構造を目指す。CRITICAL=0・HIGH=0 を達成基準とする。

---

## 1. サマリ

| 深刻度 | 要塞化前（監査） | 要塞化後 | 備考 |
| --- | --- | --- | --- |
| CRITICAL | 0 | **0** | 破壊的な即時侵害経路は検出されず |
| HIGH | 3 | **0** | 下記 H-1〜H-3 を是正 |
| MEDIUM | 6 | 1（残） | 主要項目を是正。CSPノンス化のみ計画残（下記M-6） |
| LOW | 数件 | 数件（許容） | 既知ギャップとして文書化（設計上のトレードオフ） |

自動検証は全てGREEN:
- `node --env-file=.env.local scripts/verify-security.mjs` … 45/45
- `node --env-file=.env.local scripts/verify-security-fortress.mjs` … 14/14
- `npx vitest run tests/security/` … 24/24
- 既存業務スイート（flow/backoffice/accounting-consistency/store-day）も回帰なし。

> 重要: 本書は**コードで実装・検証済み**の対策のみを「実装済み」と記す。
> Vercel/Supabase/GitHubの**ダッシュボード設定が必要**な項目は「実装済み」に含めず、
> [OWNER-ACTION-REQUIRED.md](./OWNER-ACTION-REQUIRED.md) に分離した。オーナーの手動作業が完了するまで、
> それらの防御は有効化されていない。

---

## 2. 是正したHIGH

### H-1: 特権RPCが匿名（anon）から直接実行可能だった
- **原因**: Postgres関数のデフォルトEXECUTE権限は `PUBLIC` ロールへ付与される。
  `REVOKE EXECUTE ... FROM anon` は無効（anonはPUBLIC経由で継承）。さらに
  `CREATE OR REPLACE FUNCTION` は付与をデフォルト（PUBLIC）へリセットする。
- **是正**: [00037_revoke_from_public.sql](../../supabase/migrations/00037_revoke_from_public.sql) で
  業務RPC群を `REVOKE EXECUTE FROM PUBLIC` → `GRANT to authenticated, service_role`。
  公開RPC（予約・QR）とRLSヘルパー（`app_*`）は対象外（PUBLICのまま）。
- **検証**: fortress F1（anonの apply_punch / finalize_order が不可視/拒否）・F2（公開RPCは維持）。
- 詳細は [database-grants.md](./database-grants.md)。

### H-2: PINハッシュ・他者機密がカラム単位で漏洩し得た
- **原因**: 行RLSはカラムを隠せない。同一組織の認証ユーザーが PostgREST 直叩き
  `?select=pin_code` で同僚のPINハッシュ（低エントロピー秘密）を取得できた。
- **是正**: [00038_protect_pin_code.sql](../../supabase/migrations/00038_protect_pin_code.sql) で
  `has_pin` 生成列を追加し、`profiles` から `pin_code` を除くカラムのみ authenticated/anon へ
  カラム単位GRANT。PIN照合は service role 経由のみ。
- **検証**: fortress F3（authenticated は pin_code 不可・has_pin/通常列は可）。

### H-3: 従業員の銀行・緊急連絡先が店長ロールへカラム露出していた
- **原因**: `employees_select` RLS は area_manager/store_manager にも行全体を許可し、
  `?select=bank_transfer_info,emergency_contact` で店長が閲覧可能だった。`authenticated` ロール内で
  給与管理者と店長をカラムGRANTで区別できない。
- **是正**: [00039_employee_confidential.sql](../../supabase/migrations/00039_employee_confidential.sql) で
  機密2列を専用テーブル `employee_confidential` へ分離し、RLSで給与ロール
  （org_owner/hq_admin/hq_accounting）＋本人に限定。`employees` 本体から機密列を削除。
  アプリ側 [employees/[id]/page.tsx](../../app/app/employees/%5Bid%5D/page.tsx)・
  [employees/actions.ts](../../app/app/employees/actions.ts) の読み書き経路を新テーブルへ移行。
- **検証**: fortress F4（列除去）・F5（給与ロールのみ読取・店長は0件・書換不可）。

---

## 3. 是正したMEDIUM

| ID | 項目 | 是正内容 | 検証 |
| --- | --- | --- | --- |
| M-1 | オープンリダイレクト | ログイン後遷移を [safeNextPath](../../lib/safe-redirect.ts) で検証（`//host`・`/\host`・スキーム・制御文字を排除） | tests/security/redirect.test.ts |
| M-2 | CSVフォーミュラ・インジェクション | [lib/csv.ts](../../lib/csv.ts) で `= + - @ tab CR` 始まりの文字列を無害化 | tests/security/csv-injection.test.ts |
| M-3 | 公開アクションのエラー漏洩 | [safePublicErrorCode](../../lib/observability.ts) で契約コードのみ通過、内部エラーはID化してサーバーログのみ。予約作成・決済セッションに適用 | tests/security/error-codes.test.ts |
| M-4 | エクスポートの店舗スコープ | [resolveExportStore](../../lib/export-scope.ts) でクライアント指定 `store` が ctx.stores に含まれるか検証（RLSに加える多層防御）。会計/元帳/財務諸表/原価/在庫/仕入の6経路に適用 | typecheck・手動 |
| M-5 | 財務台帳の不変性 | daily_closings はRPC専用（直接INSERT/UPDATE/DELETE剥奪）、cash_transactions/stock_movements のUPDATE/DELETE剥奪＋改ざん防止トリガー | fortress F6 |

### 残: M-6 CSPノンス化（計画のみ）
現状のCSPは本番で `script-src 'self' 'unsafe-inline'`（開発はReport-Only）。ノンス方式が理想だが、
静的生成との相性・フレームワーク注入スクリプトとの整合で破壊リスクがあるため、段階導入計画として
[csp.md](./csp.md) に記載。CRITICAL/HIGHではないため今回はコード変更を見送り、計画を残す。

---

## 4. 多層防御の構造（Defense in Depth）

1. **認証**: Supabase Auth（メール+パスワード）。PINは service role 照合のみ。
2. **認可（アプリ）**: `requirePermission` / `requireCypressAdmin` / `requireFeature`（[lib/auth.ts](../../lib/auth.ts)）。
   `can()` はフェイルクローズ（未知ロールは全拒否）。
3. **認可（DB / RLS）**: 全業務テーブルにRLS。deny-by-default。テナント・店舗・ロール境界を強制。
4. **入力検証**: zod スキーマ、CSV無害化、リダイレクト検証、レート制限（[lib/rate-limit.ts](../../lib/rate-limit.ts)）。
5. **DB制約・トリガー**: 財務不変性、機密列変更禁止、監査書込の所属チェック。
6. **GRANT境界**: 特権RPCはPUBLIC剥奪、機密列はカラムGRANT、機密テーブルは専用RLS。
7. **監査・観測**: `audit_logs`・`system_errors`・構造化ログ・[運営セキュリティダッシュボード](../../app/admin/security/page.tsx)。

「クライアントを信用しない」原則: organization/store/role/price/amount/approved_by/admin フラグは
ブラウザ入力を信用せず、サーバー側のセッション文脈（ctx）とDB側のRLS/制約で二重に検証する。

---

## 5. バックドア非設置の確認

「秘密URLで管理者になれる」等のバックドアはコードに設けていない。CYPRESS運営権限は
`profiles.is_cypress_admin`（本人書換不可・トリガー保護）にのみ依存し、緊急アクセスは
[break-glass.md](./break-glass.md) の監査可能な手順（service roleキーの正規管理下での利用）に限定する。

---

## 6. 残存リスク（既知・許容/計画）

- **MFA未強制**: Supabase MFA依存。段階導入計画は [mfa-rollout.md](./mfa-rollout.md)。
- **CSP unsafe-inline**: M-6のとおり計画残。
- **失敗ログインの網羅監視**: Supabaseログドレイン設定が必要（[OWNER-ACTION-REQUIRED.md](./OWNER-ACTION-REQUIRED.md)）。
- **機能フラグはUI制御のみ**: 機能OFFはDB層の認可境界ではない（RPC直叩きは通る）。設計上の既知ギャップ。
- 各項目は「絶対安全」を主張せず、検知・封じ込め・復旧の運用（[incident-response.md](./incident-response.md)）で補完する。

---

## 7. 手動設定が必要な項目

コードでは完結しない対策は [OWNER-ACTION-REQUIRED.md](./OWNER-ACTION-REQUIRED.md) を参照
（Supabase: 漏洩パスワード保護・MFA・ログドレイン・バックアップ、Vercel: WAF/ファイアウォール、
GitHub: ブランチ保護・シークレットスキャン・Dependabot 等）。これらが未完了の間、当該防御は無効である。
