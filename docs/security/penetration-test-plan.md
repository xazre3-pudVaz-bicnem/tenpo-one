# ペネトレーションテスト計画（TENPO ONE）

> 本計画は **認可された環境に対する検証のみ**を対象とする、TENPO ONE のセキュリティ
> テスト手順書です。各テストケースには「手順」「期待結果」「現状の自動テスト対応」を記載し、
> 自動化されていない項目は末尾の「未自動化・手動実施が必要な項目」にまとめています。
>
> 関連: [asvs-audit.md](./asvs-audit.md) ・ [threat-model.md](./threat-model.md) ・
> [docs/security.md](../security.md) ・ [docs/tenant-isolation.md](../tenant-isolation.md) ・
> [docs/permissions-matrix.md](../permissions-matrix.md)

---

## 対象範囲と禁止事項（Scope & Rules of Engagement）

### ✅ 許可される対象（Authorized Scope）

- **localhost**（`next dev` + ローカル/検証用 Supabase）
- **専用の検証環境**（本番から隔離されたテスト Supabase プロジェクト）
- **合成ユーザー・合成データのみ**（`[SEC]` / `[SECF]` 接頭辞。テスト後に必ず後始末する）

### 🚫 禁止事項（絶対に行わない）

- **本番環境へのテストは禁止**（tenpo-one.vercel.app 及び本番 Supabase）
- **実顧客データ・実従業員データ・実決済データへのアクセス／改変は禁止**
- **第三者サイト・第三者インフラへの攻撃は禁止**（対象は TENPO ONE 自身のみ）
- **大量負荷・DoS・ストレス試験は禁止**（レート制限の確認は少数リクエストで行う）
- **破壊的操作は合成データに限定**。確定済み（会計済み等）データは削除せず `void` に留める
  （`verify-security.mjs` の後始末ポリシーに準拠）

### 実行前提

- 検証は既存スクリプトの流儀に従う: **anon key + 本人 JWT でログイン（＝RLS 適用）** して
  PostgREST/RPC を直叩きし、service role は準備と後始末のみに使う。
- 検証データには `[SEC]`（verify-security）/ `[SECF]`（fortress）接頭辞を付け、`finally` で削除する。

### 実行コマンド

```bash
# PostgREST 直叩き攻撃の再現（IDOR・権限昇格・RPC直叩き・log_audit汚染・feature_flag所見）
node --env-file=.env.local scripts/verify-security.mjs

# Fortress 回帰（PUBLIC剥奪・pin_code列・employee_confidential・財務台帳不変性）
node --env-file=.env.local scripts/verify-security-fortress.mjs

# 純粋関数のユニットテスト（redirect / csv-injection / error-codes / authorization-matrix）
npx vitest run tests/security/
```

---

## 前提（テスト環境の構成）

| 項目 | 内容 |
|---|---|
| テスト企業 A | `is_demo = true` のデモ企業（渋谷店 `tenpoone-shibuya` / 横浜店 `tenpoone-yokohama`） |
| テスト企業 B | `[SEC]` 接頭辞で動的作成する別テナント（IDOR 検証用・後始末で削除） |
| 合成ユーザー | `owner@` / `keiri@`（hq_accounting）/ `shibuya@`（店長）/ `yokohama@`（店長）/ `staff1@` `staff2@` `staff3@`（一般スタッフ）@demo.tenpo.one |
| パスワード | `DEMO_PASSWORD`（既定 `TenpoOne-Demo1!`） |

各ロールの合成ユーザーで **「持つべきでない権限を行使できないこと」** を否定側から検証する。

---

## テストケース

### 1. テナント分離 / IDOR

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-1.1 | 企業Bのユーザーで企業Aの `orders`/`customers`/`journal_entries`/`payments`/`refunds`/`memberships` を `?organization_id=A` で SELECT | すべて 0 件 | ✅ `verify-security.mjs`「他企業IDOR」 |
| T-1.2 | 企業Bのユーザーで企業Aの行を UPDATE（memo/name/tendered 等の改ざん試行） | 0 件更新（RLS で拒否） | ✅ `verify-security.mjs`「他企業IDOR」 |
| T-1.3 | 横浜店長で渋谷店の `orders`/`register_sessions`/`daily_closings` を ID 直接指定で SELECT | 0 件（店舗スコープ） | ✅ `verify-security.mjs`「他店舗IDOR」 |
| T-1.4 | 横浜店長で渋谷店の `orders` を UPDATE | 0 件更新 | ✅ `verify-security.mjs`「他店舗IDOR」 |
| T-1.5 | `suspended` メンバーで自組織の `orders`/`customers`/`organizations` を SELECT | 0 件（自組織すら不可視） | ✅ `verify-security.mjs`「disabledユーザー」 |

### 2. 認可・権限昇格

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-2.1 | staff1 が自分の `profiles.is_cypress_admin` を true へ UPDATE | 拒否（`FORBIDDEN_FIELD`）・値は不変 | ✅ `verify-security.mjs` C1 |
| T-2.2 | staff1 が自分の `profiles.status` を `suspended` 等へ変更 | 拒否・値は不変 | ✅ `verify-security.mjs` C1 |
| T-2.3 | staff1 が自分の `profiles.pin_code` を直接 UPDATE | 拒否・値は不変 | ✅ `verify-security.mjs` C1 |
| T-2.4 | staff1 が `display_name` を自己更新（正常系） | 許可（過剰拒否でないこと） | ✅ `verify-security.mjs` C1 |
| T-2.5 | 渋谷店長が自分の `memberships.role` を `org_owner` へ UPDATE | 0 件・`store_manager` のまま | ✅ `verify-security.mjs` C2 |
| T-2.6 | 渋谷店長が第三者を `org_owner` として `memberships` へ INSERT | 拒否・DB に行が作られない | ✅ `verify-security.mjs` C2 |
| T-2.7 | ロール階層を超えた付与（`canAssignRole` / `roleOutranks`）の否定側 | 上位ロールの付与・操作は不可 | ✅ `tests/security/authorization-matrix.test.ts` |
| T-2.8 | 給与/組織設定/スタッフ管理/CSV 等を staff・part_time で `can()` 判定 | すべて false | ✅ `tests/security/authorization-matrix.test.ts` |
| T-2.9 | 未知ロール（`super_admin` 等）での `can()` 判定 | すべて false（フェイルクローズ） | ✅ `tests/security/authorization-matrix.test.ts` |

### 3. RPC 認可（SECURITY DEFINER）

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-3.1 | staff1（渋谷所属）が横浜店の注文を `finalize_order` で直接会計 | `FORBIDDEN`・status は `open` のまま | ✅ `verify-security.mjs`「direct RPC」 |
| T-3.2 | staff1 が横浜店の paid 注文を `refund_order` で直接返金 | `FORBIDDEN`・返金行が作られない | ✅ `verify-security.mjs`「direct RPC」 |
| T-3.3 | staff1 が非所属 org へ `log_audit` を実行 | null 返却・監査行なし | ✅ `verify-security.mjs` M2 |
| T-3.4 | staff1 が自所属 org へ `log_audit`（正常系） | id 返却・actor_id が本人 | ✅ `verify-security.mjs` M2 |
| T-3.5 | anon で `apply_punch` / `finalize_order` を直接実行 | permission denied / 関数不可視（PUBLIC 剥奪） | ✅ `verify-security-fortress.mjs` F1 |
| T-3.6 | anon で `get_booking_store`（公開RPC）を実行 | permission denied にならない（過剰剥奪でない） | ✅ `verify-security-fortress.mjs` F2 |
| T-3.7 | 認証ユーザーが `apply_punch` で `p_via_pin=true` を偽装し他人を代理打刻 | 管理者ロール以外は `FORBIDDEN`、他org は `FORBIDDEN` | ⚠️ 部分的（F1 は anon 遮断のみ。代理打刻の否定側は未自動化 → 手動） |

### 4. 認証・セッション

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-4.1 | ログアウト後 / 未ログインで `/app/*` `/admin/*` へアクセス | `/login?next=...` へリダイレクト | 📋 手動（proxy.ts の挙動。e2e 化推奨） |
| T-4.2 | `suspended` 化直後の既存セッションで業務ページを開く | 即 signOut・null セッション | ⚠️ RLS 側は F/verify で担保、UI 遷移は手動 |
| T-4.3 | 契約停止（organization.status ≠ active/trial）企業のユーザーでログイン | 遮断される | 📋 手動（[lib/auth.ts](../../lib/auth.ts) L65–73） |
| T-4.4 | PIN 打刻を短時間に多数試行（同一店舗） | `pinPunch` 20回/5分で制限 | 📋 手動（レート制限は単一プロセス前提） |

### 5. 機密データ（pin_code / 銀行 / PII）

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-5.1 | authenticated（店長）で `profiles.pin_code` を SELECT | permission denied（列グラントなし） | ✅ `verify-security-fortress.mjs` F3 |
| T-5.2 | authenticated で `profiles.has_pin`/通常列を SELECT | 許可（過剰剥奪でない） | ✅ `verify-security-fortress.mjs` F3 |
| T-5.3 | `employees.bank_transfer_info` / `emergency_contact` を SELECT | 列が存在しない（分離済み） | ✅ `verify-security-fortress.mjs` F4 |
| T-5.4 | 店長で `employee_confidential` を SELECT | 0 件（給与ロール外） | ✅ `verify-security-fortress.mjs` F5 |
| T-5.5 | org_owner / hq_accounting で `employee_confidential` を SELECT | 読める（正常系） | ✅ `verify-security-fortress.mjs` F5 |
| T-5.6 | 店長で `employee_confidential` を UPDATE | 0 件更新（書込不可） | ✅ `verify-security-fortress.mjs` F5 |
| T-5.7 | staff1 で他人（staff2）の `payroll_items` を ID フィルタで取得 | 0 件（本人分のみ） | ✅ `verify-security.mjs`「給与アクセス」 |

### 6. Storage

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-6.1 | 企業Bのユーザーで企業Aの `documents/<A_org_id>/...` を取得 | RLS で不可（パス第1階層 = org_id） | 📋 手動（[migration 00003](../../supabase/migrations/00003_rls.sql) storage ポリシー） |
| T-6.2 | 許可外 MIME（例: `.exe`/`.svg`）をアップロード | `allowed_mime_types` で拒否 | 📋 手動 |
| T-6.3 | 20MB 超のファイルをアップロード | `file_size_limit` で拒否 | 📋 手動 |
| T-6.4 | `documents` バケットの公開URL推測でファイル取得 | 非公開バケットのため不可 | 📋 手動 |
| T-6.5 | staff ロールで Storage delete | insert/delete は許可ロール外で拒否 | 📋 手動 |

### 7. Realtime

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-7.1 | 企業Bのユーザーで企業Aのテーブル変更を `postgres_changes` で購読 | 行 RLS が適用され他テナントの変更は届かない | 📋 手動（Supabase Realtime は テーブル RLS を継承。**コードで明示設定は未確認**） |
| T-7.2 | broadcast / presence チャネルを使用している場合の購読認可 | チャネル単位の認可 | ❌ 未確認（コード上で Realtime チャネル認可の実装を確認できず。使用時は Supabase 側設定が必要） |

### 8. レート制限

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-8.1 | 公開予約作成を 60秒に 10回超で実行 | `publicReservation` 10/分で制限 | 📋 手動 |
| T-8.2 | QR 注文を短時間に多数実行 | DB 側 5/min/table + アプリ側で二層制限 | 📋 手動 |
| T-8.3 | 問い合わせフォーム連投 | `contact` 5回/10分で制限 | 📋 手動 |
| T-8.4 | 多インスタンス（サーバーレス）での制限の実効性 | in-memory 実装は不完全 → 共有ストア必要 | ⚠️ 既知の限界（[lib/rate-limit.ts](../../lib/rate-limit.ts)） |

### 9. 入力検証（XSS / CSV / mass assignment）

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-9.1 | `=`/`+`/`-`/`@`/tab/CR 始まりの文字列を CSV エクスポート | 先頭に `'` を付与し数式化を無効化 | ✅ `tests/security/csv-injection.test.ts` |
| T-9.2 | カンマ・引用符・改行を含む値の CSV 出力 | 正しくクオート/エスケープ | ✅ `tests/security/csv-injection.test.ts` |
| T-9.3 | `<script>` 等を含む入力を画面表示 | React 自動エスケープで無害化 | 📋 手動（自動テスト未整備） |
| T-9.4 | mass assignment: 機密列（is_cypress_admin/status/pin_code/role）を混ぜて UPDATE | トリガーで拒否 | ✅ `verify-security.mjs` C1/C2 |
| T-9.5 | `cash_transactions` の amount/kind/参照を UPDATE で改ざん | `CASH_TX_IMMUTABLE` で拒否 | ⚠️ 部分的（[migration 00035](../../supabase/migrations/00035_security_fortress_fix.sql) 実装済み、否定側の直叩き検証は未自動化 → 手動） |

### 10. オープンリダイレクト

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-10.1 | `?next=//evil.com` / `/\evil.com` / `https://evil.com` / `javascript:` でログイン後遷移 | すべて fallback（`/app/dashboard`） | ✅ `tests/security/redirect.test.ts` |
| T-10.2 | 制御文字・改行・タブ・先頭空白での回避 | fallback | ✅ `tests/security/redirect.test.ts` |
| T-10.3 | ログイン画面 `next` パラメータでの実ブラウザ遷移 | 自サイト内のみ許可 | 📋 手動（`safeNextPath` 適用箇所の e2e 化推奨） |

### 11. エラー漏洩

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-11.1 | 公開RPCで Postgres 内部エラー（permission denied / 制約違反）を誘発 | クライアントには `UNKNOWN`、詳細はサーバーログのみ | ✅ `tests/security/error-codes.test.ts` |
| T-11.2 | 契約コード（`SLOT_UNAVAILABLE` 等）を誘発 | コードのみ通過（UI で日本語化） | ✅ `tests/security/error-codes.test.ts` |
| T-11.3 | ログ出力に PII/秘密値が含まれないこと | `sanitizeDetail` で除去・切詰め | ⚠️ 部分的（[lib/observability.ts](../../lib/observability.ts) 実装済み、ログ内容の実監査は手動） |

### 12. 冪等性・同時実行（返金 / 決済）

| ID | 手順 | 期待結果 | 自動テスト対応 |
|---|---|---|---|
| T-12.1 | 同一注文へ `finalize_order` を並行に2回実行 | 二重会計が発生しない | ❌ 未自動化 → 手動（DEFINER RPC 内のロック/状態遷移を要検証） |
| T-12.2 | 返金額が元決済額を超える `refund_order` | 業務エラーで拒否（過剰返金なし） | ❌ 未自動化 → 手動 |
| T-12.3 | `daily_closings` を直接 INSERT/UPDATE/DELETE で改ざん | RPC 専用書込のため拒否（`close_store_day` 経由のみ） | ✅ F6 は DELETE 遮断を検証。INSERT/UPDATE の否定側直叩きは手動 |
| T-12.4 | `payments`/`refunds` の DELETE | トリガーで拒否（`PAYMENTS_CANNOT_BE_DELETED`） | ⚠️ 部分的（[migration 00003](../../supabase/migrations/00003_rls.sql) 実装、直叩き検証は手動） |
| T-12.5 | 財務台帳（cash_transactions/stock_movements/daily_closings）の DELETE を authenticated で実行 | permission denied / immutable / 0件 | ✅ `verify-security-fortress.mjs` F6 |

---

## 未自動化・手動実施が必要な項目

以下は現状 **自動テストが無く、手動ペンテストで確認すべき**項目。優先度順:

1. **同時実行 / 冪等性（返金・決済）** — T-12.1/T-12.2。二重会計・過剰返金は金額直結のため最優先。
   `finalize_order`/`refund_order` の並行実行・境界値を手動または専用スクリプトで検証する。
2. **Storage 越境・MIME/サイズ・URL推測** — T-6.x。RLS ポリシー自体は
   [migration 00003](../../supabase/migrations/00003_rls.sql) にあるが、実 anon クライアントでの越境試行が未自動化。
3. **Realtime の購読越境** — T-7.x。`postgres_changes` はテーブル RLS を継承するが、
   コード上で Realtime チャネル認可の明示実装を確認できていない（broadcast/presence 使用時は要 Supabase 設定）。
4. **認証・セッションの UI 遷移** — T-4.1/T-4.3。proxy のリダイレクトと organization.status 遮断は
   e2e（Playwright 等）での回帰が望ましい（既存 `e2e/security-idor.spec.ts` を拡張）。
5. **レート制限の実効性** — T-8.x。in-memory 実装は多インスタンスで不完全（[lib/rate-limit.ts](../../lib/rate-limit.ts)）。
   共有ストア（Redis/Upstash）導入後に再検証。
6. **XSS の実ブラウザ検証** — T-9.3。React 自動エスケープに依存。`dangerouslySetInnerHTML` の
   使用箇所（JSON-LD）に外部入力が混入しないことを回帰で担保したい。
7. **CSP の実効性** — `script-src 'unsafe-inline'` のため厳密な XSS 緩和は限定的。
   nonce 方式移行の検討（[next.config.ts](../../next.config.ts) 参照）。
8. **cash_transactions / payments 改ざんの直叩き否定側** — T-9.5/T-12.4。トリガーは実装済みだが
   anon key + 本人JWT での否定側検証を `verify-security.mjs` へ追加すると回帰が固まる。

> 手動テストも本書冒頭の「禁止事項」を厳守すること（本番・実データ・第三者・大量負荷は不可）。
