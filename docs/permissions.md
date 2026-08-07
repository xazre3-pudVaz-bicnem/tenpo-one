# 権限マトリクス

役割階層・スコープの詳細は `docs/user-roles.md`、RLS実装は `docs/tenant-isolation.md` を参照。
本書は `lib/permissions.ts` の内容をそのまま転記した権限マトリクスと、機能フラグとの関係を扱う。
旧 `docs/permissions-matrix.md` も残しているが、実装との対応が必要な場合は本書を正とする。

## ロール一覧（10種）

`lib/permissions.ts` の `Role`型が定義する org内ロール9種 + プラットフォーム側の`cypress_admin`
（`profiles.is_cypress_admin`、org非依存）で計10種。

| ロール値 | 表示名 | スコープ |
|---|---|---|
| `org_owner` | 契約企業オーナー | 全店舗（HQ系） |
| `hq_admin` | 本社管理者 | 全店舗（HQ系） |
| `hq_accounting` | 本社経理担当 | 全店舗（HQ系） |
| `area_manager` | エリアマネージャー | `membership_stores`登録店舗のみ |
| `store_manager` | 店長 | `membership_stores`登録店舗のみ |
| `assistant_manager` | 副店長 | `membership_stores`登録店舗のみ |
| `staff` | 一般スタッフ | `membership_stores`登録店舗のみ |
| `part_time` | アルバイト | `membership_stores`登録店舗のみ |
| `external_accountant` | 外部税理士・会計担当 | 全店舗（HQ系、閲覧中心） |
| `cypress_admin`（`is_cypress_admin=true`） | CYPRESS運営 | 全組織横断（サポートアクセス） |

`HQ_ROLES = ['org_owner', 'hq_admin', 'hq_accounting', 'external_accountant']`
（`lib/permissions.ts`）が全店舗アクセスの判定基準。RLS側の `app_has_store_access()` も同じロール集合を使う。

## 権限アクション一覧と許可ロール（`lib/permissions.ts` 転記）

`can(role, action)` が単一の判定関数。UI・Server Action・RLSの3層すべてが同じ発想を実装する
（RLS側は `app_role_in()` 等のSQL関数として別実装だが、ロール集合は一致させる運用）。

| アクション | 許可ロール |
|---|---|
| `dashboard.view` | org_owner, hq_admin, hq_accounting, area_manager, store_manager, assistant_manager, staff, external_accountant |
| `reservations.view` | org_owner, hq_admin, hq_accounting, area_manager, store_manager, assistant_manager, staff, part_time |
| `reservations.write` | org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff |
| `reservations.cancel` | org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff |
| `tables.operate` | org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff, part_time |
| `pos.order` | org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff, part_time |
| `pos.checkout` | org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff, part_time |
| `pos.discount` | org_owner, hq_admin, area_manager, store_manager, assistant_manager |
| `pos.refund` | org_owner, hq_admin, area_manager, store_manager |
| `register.operate` | org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff |
| `register.approve` | org_owner, hq_admin, hq_accounting, area_manager, store_manager |
| `cash.write` | org_owner, hq_admin, hq_accounting, area_manager, store_manager, assistant_manager |
| `cash.approve` | org_owner, hq_admin, hq_accounting, area_manager, store_manager |
| `customers.view` | org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff |
| `customers.write` | org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff |
| `customers.delete` | org_owner, hq_admin, area_manager, store_manager |
| `documents.write` | org_owner, hq_admin, hq_accounting, area_manager, store_manager, assistant_manager |
| `invoices.approve` | org_owner, hq_admin, hq_accounting, area_manager |
| `vendors.manage` | org_owner, hq_admin, area_manager, store_manager, assistant_manager |
| `inventory.view` | org_owner, hq_admin, hq_accounting, area_manager, store_manager, assistant_manager, staff, external_accountant |
| `inventory.write` | org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff |
| `attendance.punch` | org_owner, hq_admin, hq_accounting, area_manager, store_manager, assistant_manager, staff, part_time |
| `attendance.approve` | org_owner, hq_admin, area_manager, store_manager, assistant_manager |
| `shifts.manage` | org_owner, hq_admin, area_manager, store_manager, assistant_manager |
| `payroll.manage` | org_owner, hq_admin, hq_accounting |
| `payroll.view_all` | org_owner, hq_admin, hq_accounting, external_accountant |
| `reports.view` | org_owner, hq_admin, hq_accounting, area_manager, store_manager, assistant_manager, external_accountant |
| `csv.export` | org_owner, hq_admin, hq_accounting, area_manager, store_manager, external_accountant |
| `menu.manage` | org_owner, hq_admin, area_manager, store_manager |
| `store.settings` | org_owner, hq_admin, area_manager, store_manager |
| `staff.manage` | org_owner, hq_admin, area_manager, store_manager |
| `org.settings` | org_owner, hq_admin |
| `audit.view` | org_owner, hq_admin, hq_accounting, area_manager, store_manager, external_accountant |

注目すべき境界:
- `part_time`（アルバイト）は `reservations.view`, `tables.operate`, `pos.order`, `pos.checkout`,
  `attendance.punch` のみ許可。`pos.discount`/`pos.refund`はNG（`scripts/verify-flow.mjs`セクション6で
  アルバイトの返金操作が拒否されることを検証）
- `assistant_manager`（副店長）と `part_time` は `dashboard.view` から除外
- `hq_accounting`は現場操作系（`pos.*`, `tables.operate`, `reservations.write`）を一切持たず、
  経理・給与・レポート・監査に限定
- `external_accountant`は書込系をほぼ持たず、`payroll.view_all` / `reports.view` / `csv.export` /
  `audit.view` / `inventory.view` の閲覧中心

## 実装方式（3層適用）

1. **UI表示制御** — `lib/nav.ts` がサイドバー項目を `can(role, action)` でフィルタ
2. **Server Action検証** — `lib/auth.ts` の `requirePermission(action)` が `requireMember()` 後に
   `can(ctx.role, action)` をチェックし、falseなら `権限がありません: ${action}` を throw
3. **RLS（最終防衛）** — `supabase/migrations/00003_rls.sql` のtierベース自動生成ポリシー
   （`ops`/`mgmt`/`money`/`hq`の4層）+ 個別テーブルの手書きポリシー。`lib/permissions.ts`の
   ロール集合と役割は対応させているが、SQL側は独立した`app_role_in()`実装であり、自動同期の
   しくみはない（変更時は両方を手動で揃える必要がある — `docs/known-limitations.md`参照）

## `requireFeature` / feature flagsとの関係

権限（誰が）と機能フラグ（何が有効か）は独立した軸。両方を満たして初めて画面・操作が使える。

- 権限判定: `can(role, action)`（`lib/permissions.ts`）— ロールに紐づく静的なアクション許可
- 機能フラグ判定: `isFeatureEnabled(disabledFeatures, feature)`（`lib/features.ts`）— 組織単位の
  ON/OFF。`FEATURE_KEYS`は`reservations, pos, kds, qr_order, crm, inventory, costing, accounting,
  attendance, payroll, reports`の11種
- Server Actionでは `requirePermission(action)` と `requireFeature(feature)` を両方呼ぶ画面がある
  （例: `app/app/kitchen/actions.ts` は `requireFeature('kds')` + `requirePermission('pos.order')`）
- 機能が無効な組織では、権限があってもそのルートへ直接アクセスすると
  `/app/dashboard?feature_disabled=1` にリダイレクトされる（`requireFeature`の実装）
- ナビ非表示は `lib/nav.ts` の `ROUTE_FEATURES`（ルートprefix→FeatureKeyの対応表）を使い、
  権限フィルタと同じ箇所で適用される

## 給与・個人情報のカラム/行レベル制御

`payroll_rules`/`commission_rules`/`payroll_runs`は`00006_payroll_rls_tighten.sql`で
SELECTポリシーを引き締め済み（`docs/database.md`参照）。`payroll_items`（個人明細）は
「本人の行 or `app_can_view_payroll`ロール」のみSELECT可（`00003_rls.sql`から変更なし）。
顧客PIIは`app_can_view_customer_pii()`（`org_owner/hq_admin/area_manager/store_manager/
assistant_manager/staff`）で閲覧可否を制御し、`hq_accounting`と`part_time`は顧客個人情報を
閲覧できない（`scripts/verify-flow.mjs`セクション11で検証）。
