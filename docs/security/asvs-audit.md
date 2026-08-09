# OWASP ASVS 監査チェックリスト（TENPO ONE）

> 本書は **OWASP ASVS L2/L3 を指向したセキュリティ監査チェックリスト**を、TENPO ONE の
> 実コードにマッピングしたものです。各項目は **コードで確認できた事実のみ**を記載し、
> ダッシュボード（Vercel / Supabase / GitHub）でしか設定できない項目は `📋手動設定要`
> として明確に分離しています。実装済みと手動設定を混同しないでください。
>
> 凡例:
> - ✅ **実装済み** — コード / migration で確認済み
> - ⚠️ **部分的** — 一部のみ実装、または既知のギャップあり
> - 📋 **手動設定要** — Vercel / Supabase / GitHub のダッシュボード側設定（コードでは保証されない）
> - ❌ **未対応**
>
> 関連ドキュメント（重複を避け相互参照）:
> [docs/security.md](../security.md) ・ [docs/security-design.md](../security-design.md) ・
> [docs/tenant-isolation.md](../tenant-isolation.md) ・ [docs/tenant-security.md](../tenant-security.md) ・
> [docs/storage-security.md](../storage-security.md) ・ [docs/permissions-matrix.md](../permissions-matrix.md) ・
> [docs/observability.md](../observability.md) ・ [docs/data-retention.md](../data-retention.md) ・
> [docs/privacy-operations.md](../privacy-operations.md) ・ [docs/security/threat-model.md](./threat-model.md)
>
> 検証スクリプト:
> `node --env-file=.env.local scripts/verify-security.mjs`（既存45項目・IDOR/権限昇格/RPC直叩き） ・
> `node --env-file=.env.local scripts/verify-security-fortress.mjs`（F1–F6・PUBLIC剥奪/カラム分離/台帳不変性） ・
> `npx vitest run tests/security/`（redirect / csv-injection / error-codes / authorization-matrix）

---

## V1 アーキテクチャ・設計・脅威モデリング

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V1.1 | 多層防御アーキテクチャが文書化されている | ✅ | 4層（UI→Server Action→RPC→RLS）を [docs/security.md](../security.md)、脅威モデルを [threat-model.md](./threat-model.md) に記載 |
| V1.2 | 信頼境界ごとにブラウザ入力を信用しない方針 | ✅ | organization/store/role/price/amount/approved_by/admin flag を非信用と明記（[threat-model.md](./threat-model.md) Trust Boundaries） |
| V1.4 | アクセス制御を信頼境界（DB）で強制 | ✅ | 最終防御は RLS + SECURITY DEFINER RPC（[supabase/migrations/00003_rls.sql](../../supabase/migrations/00003_rls.sql)） |
| V1.5 | 認可の単一定義（ロール×アクション） | ✅ | [lib/permissions.ts](../../lib/permissions.ts) の `P` マップに単一定義、`can()` で参照 |
| V1.11 | 機密データフローの識別・分離 | ✅ | 給与・PIN・銀行情報・緊急連絡先をテーブル/カラム単位で分離（V8参照） |

---

## V2 認証（Authentication）

認証は **Supabase Auth（メール+パスワード）** が中核。セッションは `@supabase/ssr` の
Cookie ベース。共用端末の打刻 PIN は scrypt ハッシュで保存し、照合は service role 経由。

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V2.1 | パスワード認証は専用IdPに委譲 | ✅ | Supabase Auth `signInWithPassword`（[app/(auth)/login](../../app)） |
| V2.2 | サーバー生成の初期パスワード（招待時に平文を扱わない） | ✅ | `generateInitialPassword()` が `node:crypto` 乱数で生成、呼び出し側から受け取らない（[app/app/staff/actions.ts](../../app/app/staff/actions.ts)） |
| V2.4 | 低エントロピー秘密（PIN）のハッシュ化保存 | ✅ | scrypt + per-user salt、形式 `scrypt$<salt>$<hash>`、平文保存を廃止（[app/app/staff/actions.ts](../../app/app/staff/actions.ts) `hashPin`） |
| V2.5 | PIN ハッシュは認証ユーザーへ露出しない | ✅ | `profiles.pin_code` 列を authenticated/anon から REVOKE、照合は service role のみ（[migration 00038](../../supabase/migrations/00038_protect_pin_code.sql)） |
| V2.7 | PIN 総当たり対策（レート制限） | ✅ | `pinPunch` 20回/5分（[lib/rate-limit.ts](../../lib/rate-limit.ts)）+ DB側 booking/QR 制限との二層 |
| V2.8 | ログインの総当たり対策 | ⚠️ | Supabase Auth 側のメール単位制限に依存。ログインはクライアントから直接 `signInWithPassword` を呼ぶため、アプリの `login` レート枠は**未適用**（[lib/rate-limit.ts](../../lib/rate-limit.ts) コメント参照） |
| V2.9 | 多要素認証（MFA） | 📋 | Supabase Auth の機能に依存。**コード側で強制していない**。有効化は Supabase ダッシュボード設定 |
| V2.10 | パスワードポリシー（長さ・漏洩チェック） | 📋 | Supabase Auth 側のポリシー設定（ダッシュボード） |

---

## V3 セッション管理（Session Management）

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V3.1 | セッションは httpOnly Cookie で管理 | ✅ | `@supabase/ssr` の `createServerClient` が Cookie を設定（[proxy.ts](../../proxy.ts)、[lib/supabase/server.ts](../../lib/supabase)） |
| V3.2 | サーバー側でトークン検証（クライアント値を信用しない） | ✅ | `supabase.auth.getUser()` を毎リクエスト実行（[lib/auth.ts](../../lib/auth.ts) `getSessionContext`、[proxy.ts](../../proxy.ts)） |
| V3.3 | 権限・所属変更が即時反映される（失効） | ✅ | 毎リクエストで profile.status / membership.status / organization.status を再読込し `suspended` 等は即 `signOut`（[lib/auth.ts](../../lib/auth.ts) L60–73） |
| V3.4 | 退職者・停止アカウントの継続アクセス遮断 | ✅ | `status === 'suspended'` で `signOut` + null 返却（[lib/auth.ts](../../lib/auth.ts)）。`scripts/verify-security.mjs` の「disabledユーザー」セクションで検証 |
| V3.5 | Cookie の Secure / SameSite 属性 | 📋 | `@supabase/ssr` のデフォルト（本番 HTTPS で Secure）。アプリコードで明示設定しておらずライブラリ既定に依存 |

---

## V4 アクセス制御（Access Control）— 3層 + deny-by-default

TENPO ONE のアクセス制御は **3層**（`requirePermission` → RLS → トリガー/grant）で構成され、
すべて **deny-by-default**。RPC 実行権限は `PUBLIC` から剥奪し、必要なロールへ明示 GRANT する
教訓（下記 V4.6）を反映している。

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V4.1 | Server Action / ページでロール・所属を検証 | ✅ | `requirePermission(action)` → `requireMember` → `can()`（[lib/auth.ts](../../lib/auth.ts) L159–165） |
| V4.2 | 未知ロール・null は全権限拒否（フェイルクローズ） | ✅ | `can(null/未知, *) === false`（[lib/permissions.ts](../../lib/permissions.ts) L107–110）。[tests/security/authorization-matrix.test.ts](../../tests/security/authorization-matrix.test.ts) の「未知ロールは全権限を拒否」で検証 |
| V4.3 | テナント境界（organization）を全業務テーブルで強制 | ✅ | 全テーブルに RLS、`app_is_org_member(organization_id)` を SELECT/WRITE で強制（[migration 00003](../../supabase/migrations/00003_rls.sql)）。`verify-security.mjs`「他企業IDOR」で検証 |
| V4.4 | 店舗スコープ（水平権限）を強制 | ✅ | `app_has_store_access(organization_id, store_id)`（[migration 00003](../../supabase/migrations/00003_rls.sql)）。`verify-security.mjs`「他店舗IDOR」で検証 |
| V4.5 | 権限昇格の防止（自己 org_owner / cypress_admin 昇格） | ✅ | `profiles` 機密列変更トリガー + `memberships` 自己昇格トリガー + RLS 書込を org_owner/hq_admin に限定（[migration 00031](../../supabase/migrations/00031_privilege_escalation_guards.sql)）。`verify-security.mjs` C1/C2 で検証 |
| V4.6 | 特権 RPC のデフォルト EXECUTE 剥奪（PUBLIC revoke） | ✅ | 関数のデフォルト EXECUTE は PUBLIC 付与のため `REVOKE FROM PUBLIC` + `GRANT authenticated, service_role`（[migration 00037](../../supabase/migrations/00037_revoke_from_public.sql)）。`CREATE OR REPLACE` で権限がリセットされる罠に対し 00036 で再適用（[migration 00036](../../supabase/migrations/00036_reapply_punch_revoke.sql)） |
| V4.7 | anon が特権 RPC を直接実行できない | ✅ | `apply_punch` / `finalize_order` 等を anon から遮断。`verify-security-fortress.mjs` F1 で検証 |
| V4.8 | ロール付与の上限（role ceiling） | ✅ | `canAssignRole` / `roleOutranks` で自分より上位ロールの付与を拒否（[lib/permissions.ts](../../lib/permissions.ts) L140–151） |
| V4.9 | 監査ログの汚染防止（他org宛書込） | ✅ | `log_audit` が呼び出し元の org 所属を検証、非所属は null 返却（[migration 00031](../../supabase/migrations/00031_privilege_escalation_guards.sql)）。`verify-security.mjs` M2 で検証 |
| V4.10 | 機能フラグによるアクセス制御 | ⚠️ | `requireFeature`（[lib/auth.ts](../../lib/auth.ts)）はページ入口の UI 抑止のみ。**DB層（RLS/DEFINER RPC）は feature_flags を参照せず、認可境界ではない**（`verify-security.mjs` の所見で明示） |

---

## V5 検証・サニタイズ・エンコーディング

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V5.1 | 入力バリデーション | ⚠️ | 公開フォーム等は zod で検証（[app/(marketing)/contact/actions.ts](../../app/(marketing)/contact/actions.ts) 他2ファイル）。**全面 zod ではなく**、大半は TypeScript 型 + DB 制約 + RLS/RPC 内検証で担保 |
| V5.2 | CSV フォーミュラ・インジェクション対策 | ✅ | セル先頭 `= + - @ tab CR` を `'` 無害化（[lib/csv.ts](../../lib/csv.ts) `neutralizeFormula`）。[tests/security/csv-injection.test.ts](../../tests/security/csv-injection.test.ts) で検証 |
| V5.3 | 出力エンコーディング（XSS） | ✅ | React 自動エスケープ。`dangerouslySetInnerHTML` は JSON-LD（静的データ）1箇所のみ（[docs/security.md](../security.md)） |
| V5.4 | SQL インジェクション対策 | ✅ | Supabase クライアント/RPC 引数でパラメータ化。動的 SQL は `format()` の `%I`/`%L` + ハードコード role 配列（[migration 00003](../../supabase/migrations/00003_rls.sql)） |
| V5.5 | mass assignment（機密列の書換）防止 | ✅ | `profiles` の is_cypress_admin/status/pin_code、`memberships.role` をトリガーで拒否（[migration 00031](../../supabase/migrations/00031_privilege_escalation_guards.sql)）、`cash_transactions` の金額/種別を `prevent_cash_tx_tamper` で不変化（[migration 00035](../../supabase/migrations/00035_security_fortress_fix.sql)） |
| V5.6 | 公開エラーコードの安全化（内部情報漏洩防止） | ✅ | `safePublicErrorCode` が契約コード `^[A-Z][A-Z0-9_]+$` のみ通過、それ以外は `UNKNOWN`（[lib/observability.ts](../../lib/observability.ts)）。[tests/security/error-codes.test.ts](../../tests/security/error-codes.test.ts) で検証 |

---

## V7 エラー処理・ロギング

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V7.1 | エラーIDでユーザー提示と内部ログを紐付け | ✅ | `ERR-XXXXXX` 形式ID（`newErrorId`）を UI とログで共有（[lib/observability.ts](../../lib/observability.ts)） |
| V7.2 | ログに PII / 秘密値を含めない | ✅ | `sanitizeDetail` が pass/secret/token/key/cookie/bank/salary キーを除去、値は300字で切詰め（[lib/observability.ts](../../lib/observability.ts)） |
| V7.3 | 構造化ログ（機械可読） | ✅ | `logStructuredError` が1行JSONを `console.error` へ出力（Vercel関数ログ）（[lib/observability.ts](../../lib/observability.ts)） |
| V7.4 | エラーのDB永続化（監査可能） | ✅ | `system_errors` テーブルへ記録（CYPRESS閲覧）。詳細は [docs/observability.md](../observability.md) |
| V7.5 | 内部例外メッセージをクライアントへ漏らさない | ✅ | 公開経路は `safePublicErrorCode` 経由（V5.6）。Postgres 制約名・permission denied は `UNKNOWN` 化 |
| V7.6 | 集中的な失敗ログイン監視・アラート | 📋 | 失敗ログインの検知・集計は Supabase ログ + ログドレイン（外部）に依存。**コード側にアラート実装なし** |

---

## V8 データ保護（Data Protection）

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V8.1 | PIN ハッシュのカラム単位アクセス制御 | ✅ | `profiles.pin_code` を authenticated/anon から REVOKE、`has_pin` 生成列のみ公開（[migration 00038](../../supabase/migrations/00038_protect_pin_code.sql)）。`fortress` F3 で検証 |
| V8.2 | 従業員機密情報のテーブル分離 | ✅ | 銀行情報・緊急連絡先を `employees` から `employee_confidential` へ分離、RLS で給与ロール+本人に限定（[migration 00039](../../supabase/migrations/00039_employee_confidential.sql)）。`fortress` F4/F5 で検証 |
| V8.3 | 店長ロールへの機密カラム露出根絶 | ✅ | 行RLSはカラムを隠せないため、店長が `?select=bank_transfer_info` で取得できた穴をテーブル分離で解消（[migration 00039](../../supabase/migrations/00039_employee_confidential.sql)）。`fortress` F5 で店長の読取不可を検証 |
| V8.4 | 銀行口座は下4桁のみ保持（データ最小化） | ✅ | `bank_transfer_info` は `{ bank, last4 }` 形式で下4桁のみ（[migration 00039](../../supabase/migrations/00039_employee_confidential.sql)、[threat-model.md](./threat-model.md)） |
| V8.5 | 給与明細は本人 + 給与ロールのみ閲覧 | ✅ | `payroll_items` RLS: `profile_id = auth.uid()` or `app_can_view_payroll`（[migration 00003](../../supabase/migrations/00003_rls.sql)）。`verify-security.mjs`「給与アクセス」で検証 |
| V8.6 | 財務台帳の不変性（改ざん・削除防止） | ✅ | `payments`/`refunds` 削除トリガー拒否（[migration 00003](../../supabase/migrations/00003_rls.sql)）、`daily_closings` は RPC専用書込（insert/update/delete を REVOKE）、`stock_movements`/`cash_transactions` は追記専用（[migration 00034](../../supabase/migrations/00034_security_fortress_db.sql)）。`fortress` F6 で検証 |
| V8.7 | 個人データの保持・削除方針 | ✅ | [docs/data-retention.md](../data-retention.md) ・ [docs/privacy-operations.md](../privacy-operations.md) に記載 |
| V8.8 | 保存時暗号化（at-rest） | 📋 | Supabase / Postgres の基盤暗号化に依存（インフラ設定） |

---

## V9 通信（Communication）

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V9.1 | 全通信 HTTPS | 📋 | Vercel / Supabase が TLS を提供（インフラ）。アプリコードでは保証しない |
| V9.2 | HSTS の有効化 | ✅ | 本番のみ `Strict-Transport-Security: max-age=31536000; includeSubDomains`（[next.config.ts](../../next.config.ts)） |
| V9.3 | 接続先の制限（CSP connect-src） | ✅ | `connect-src 'self' + Supabase host(https/wss)` のみ許可（[next.config.ts](../../next.config.ts)） |

---

## V10 悪意あるコード（Malicious Code）

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V10.1 | バックドア・隠しアカウントを持たない | ✅ | 認可バイパスは service role（`auth.uid() is null`）経路のみで、いずれも app 層の `requirePermission` / 所有権チェックを直前に通す設計（[docs/security.md](../security.md)）。`is_cypress_admin` は自己昇格不可（V4.5） |
| V10.2 | Service Role Key の秘匿 | ✅ | [lib/supabase/admin.ts](../../lib/supabase/admin.ts) は `import 'server-only'`。NEXT_PUBLIC・HTML・レスポンス・ログへ出さない |
| V10.3 | 依存関係の脆弱性監視 | 📋 | `npm audit` / Dependabot 等は GitHub 側設定（ダッシュボード） |

---

## V12 ファイル・リソース（Files and Resources）

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V12.1 | アップロードの MIME/サイズ制限 | ✅ | `documents` バケットは `allowed_mime_types = [pdf,png,jpeg,webp]`、`file_size_limit = 20MB`、`public = false`（[migration 00003](../../supabase/migrations/00003_rls.sql)） |
| V12.2 | サーバー側でのファイル検証（path traversal） | ✅ | MIME・拡張子・サイズ・ファイル名を検証（[docs/storage-security.md](../storage-security.md)） |
| V12.3 | Storage のテナント境界（パスプレフィックス） | ✅ | フォルダ第1階層 = organization_id を RLS で強制、他企業ファイルは URL 推測でも取得不可（[migration 00003](../../supabase/migrations/00003_rls.sql) storage.objects ポリシー） |
| V12.4 | Storage 書込・削除ロール制限 | ✅ | insert は本社系+店長系ロール、delete は org_owner/hq_admin/hq_accounting のみ（[migration 00003](../../supabase/migrations/00003_rls.sql)） |

---

## V13 API・Web サービス

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V13.1 | PostgREST 直叩きに対する RLS 防御 | ✅ | 全テーブル RLS 有効。`verify-security.mjs` が anon key + 本人JWT で直叩き攻撃を再現し境界を確認 |
| V13.2 | SECURITY DEFINER RPC の内部認可 | ✅ | RLS をバイパスする DEFINER 関数は内部で `app_has_store_access` / `app_role_in` を再検証（[migration 00003](../../supabase/migrations/00003_rls.sql) 冒頭、`apply_punch` の認可ブロック [migration 00035](../../supabase/migrations/00035_security_fortress_fix.sql)）。`verify-security.mjs`「direct RPC」で検証 |
| V13.3 | 公開RPCの過剰剥奪回避 | ✅ | 予約・QR系の公開RPC と `app_*` ヘルパーは PUBLIC のまま維持（[migration 00037](../../supabase/migrations/00037_revoke_from_public.sql)）。`fortress` F2 で `get_booking_store` が anon 実行可を確認 |
| V13.4 | 冪等性・同時実行制御（返金/決済） | ⚠️ | `finalize_order`/`refund_order` は DEFINER RPC 内で店舗/ロール境界を強制（`verify-security.mjs` で検証）。金額整合・FOR UPDATE 等の同時実行検証は自動テスト未整備（[penetration-test-plan.md](./penetration-test-plan.md) の「冪等性・同時実行」参照） |

---

## V14 設定（Configuration）

| # | 要件 | 状態 | 根拠 |
|---|---|---|---|
| V14.1 | セキュリティヘッダーの付与 | ✅ | X-Content-Type-Options / Referrer-Policy / X-Frame-Options / Permissions-Policy を全レスポンスに付与（[next.config.ts](../../next.config.ts)） |
| V14.2 | CSP の適用 | ⚠️ | `default-src 'self'` + `base-uri 'none'` + `object-src 'none'` + `frame-ancestors 'self'` + `form-action 'self'`。本番は enforce、開発は Report-Only。ただし `script-src`/`style-src` に **`'unsafe-inline'`**（Next.js ハイドレーション用、nonce方式は将来課題として文書化）（[next.config.ts](../../next.config.ts)） |
| V14.3 | 環境変数未設定時の安全側フェイル | ✅ | `NEXT_PUBLIC_SITE_URL` / Supabase 環境変数のゲーティング。未設定時は proxy で素通しにせず各ページの `requireSession` が最終防衛（[proxy.ts](../../proxy.ts)） |
| V14.4 | Permissions-Policy で不要APIを無効化 | ✅ | `camera=(), microphone=(), geolocation=(), payment=()`（[next.config.ts](../../next.config.ts)） |
| V14.5 | 画像の許可ホスト制限 | ✅ | `images.remotePatterns` を Supabase ホストのみに限定（[next.config.ts](../../next.config.ts)） |
| V14.6 | CSPレポート収集 | 📋 | Report-Only の違反はコンソール出力のみ。集中収集は外部（ログドレイン/レポートエンドポイント）設定が必要 |

---

## 是正状況サマリ（Fortress 作業後）

migration 00031 の権限昇格封鎖、および 00034–00039 の Security Fortress（apply_punch 認可・
PUBLIC 剥奪・財務不変性・pin_code カラムグラント・employee_confidential 分離）と、
`verify-security.mjs`（45項目）/ `verify-security-fortress.mjs`（F1–F6）/ `tests/security/*` の
全 GREEN により、監査で検出した **CRITICAL / HIGH は解消済み**。

| 深刻度 | 件数 | 内容 |
|---|---|---|
| 🔴 CRITICAL | **0** | C1/C2/C3（自己 cypress_admin / org_owner 昇格・招待時平文パスワード）を封鎖（[migration 00031](../../supabase/migrations/00031_privilege_escalation_guards.sql)） |
| 🟠 HIGH | **0** | apply_punch 越境注入・daily_closings 不変性欠如・従業員機密カラム露出（G-1）・pin_code カラム露出（G-2）を解消（[migration 00034](../../supabase/migrations/00034_security_fortress_db.sql)–[00039](../../supabase/migrations/00039_employee_confidential.sql)） |
| 🟡 MEDIUM（残存） | 2 | ① in-memory レートリミッタは多インスタンス（Vercel サーバーレス）で不完全 → Redis/Upstash へ差替（📋外部）。② feature_flags は UI 抑止のみで DB 層の認可境界ではない（既知ギャップ、migration 追加が必要） |
| 🔵 LOW（残存） | 4 | ① CSP `script-src 'unsafe-inline'`（nonce 方式へ移行余地）。② MFA 未強制（Supabase 設定）。③ 失敗ログイン監視はログドレイン依存。④ ログインレート枠が未適用（ログインが Server Action 非経由） |

> 残存 MEDIUM/LOW はいずれも「受容 or 外部/ダッシュボード設定」で、コードで確認できる範囲の
> CRITICAL/HIGH は 0。運用側の対応項目は [threat-model.md](./threat-model.md) の「残存リスク」および
> [docs/security.md](../security.md) の各 BLOCKED/OWNER-ACTION と対応する。
