# マルチテナント分離の実装

概要は `docs/security-design.md`、権限は `docs/permissions.md` を参照。本書はRLSヘルパー関数の
実装詳細と検証方法に絞る。

## 分離モデル

TENPO ONEは2階層のスコープを持つ:

1. **組織（organization）分離** — 契約企業間は完全に不可視。URLに他社のIDを直接指定しても
   0件が返る（エラーではなくRLSによる無言のフィルタ）
2. **店舗（store）分離** — 同一組織内でも、店舗系ロール（`area_manager`未満を除く実質は
   `store_manager/assistant_manager/staff/part_time`）は`membership_stores`に登録された店舗のみ
   アクセス可能。HQ系ロール（`org_owner/hq_admin/hq_accounting/external_accountant`）は登録不要で
   全店舗にアクセスできる

`customers`テーブルは例外的に**組織単位で全店共有**（`store_id`を持たない）。これは仕様
（`docs/open-questions.md`項目11）であり、店舗を跨いだ顧客体験の一貫性を優先した設計。

## RLSヘルパー関数（`supabase/migrations/00002_functions.sql`）

すべて `security definer stable set search_path = public`。全RLSポリシーはこれらの組み合わせで
構成される。

```sql
-- CYPRESS運営サポートアクセス判定
app_is_cypress_admin() returns boolean
  -- profiles.is_cypress_admin を auth.uid() で参照するだけ。organization_idに依存しない

-- 組織メンバーか（アクティブなmembershipsの存在確認）
app_is_org_member(p_org uuid) returns boolean

-- 呼び出し中ユーザーの当該組織でのロール文字列
app_role(p_org uuid) returns text

-- ロールが指定集合に含まれるか
app_role_in(p_org uuid, p_roles text[]) returns boolean

-- 店舗アクセス可否: HQ系ロールは全店舗 / それ以外は membership_stores 登録店舗のみ
app_has_store_access(p_org uuid, p_store uuid) returns boolean

-- 給与閲覧可否（org_owner, hq_admin, hq_accounting, external_accountant）
app_can_view_payroll(p_org uuid) returns boolean

-- 顧客PII閲覧可否（org_owner, hq_admin, area_manager, store_manager, assistant_manager, staff）
app_can_view_customer_pii(p_org uuid) returns boolean
```

`app_has_store_access`の実体:

```sql
select case
  when p_store is null then public.app_is_org_member(p_org)
  when public.app_role_in(p_org, array['org_owner','hq_admin','hq_accounting','external_accountant'])
    then true
  else exists (
    select 1 from public.memberships m
    join public.membership_stores ms on ms.membership_id = m.id
    where m.profile_id = auth.uid() and m.organization_id = p_org
      and m.status = 'active' and ms.store_id = p_store)
end;
```

## ポリシーの構成パターン

`00003_rls.sql`は39テーブルに対し、`store_id`列の有無を動的検出しながらtier別（`ops`/`mgmt`/
`money`/`hq`）にSELECT/INSERT/UPDATE/DELETEポリシーを一括生成する（詳細は`docs/database.md`）。
共通パターン:

```sql
-- SELECT
using (
  app_is_cypress_admin()
  or (app_is_org_member(organization_id) and app_has_store_access(organization_id, store_id))
)

-- INSERT/UPDATE/DELETE（tierごとに許可ロール集合が変わる）
using / with check (
  app_is_cypress_admin()
  or (app_role_in(organization_id, <tier roles>) and app_has_store_access(organization_id, store_id))
)
```

**重要**: `app_is_cypress_admin()`が全ポリシーの先頭でOR結合されているため、`is_cypress_admin=true`の
ユーザーは対象組織に`memberships`行が一切なくても、全テーブル・全店舗のデータへ読み書きできる。
これがCYPRESS運営のサポートアクセス実装そのもの。

## cypress_admin サポートアクセスの監査

サポートアクセスはRLSバイパスにより**技術的には無制限**だが、運用上は必ず記録する設計。
`app/admin/support/actions.ts`の`logSupportAccess(organizationId, reason)`が
`log_audit(p_action: 'support_access', ...)`をRPC経由で呼び、理由（`reason`）を伴った
`audit_logs`行を残す。RLSレベルでこの記録を強制する仕組み（トリガー等）は無い —
支援担当者が`/admin/support`のUIフローを使わずSupabase Studioなどから直接操作すれば記録が
残らない点は運用ルールで担保する必要がある（`docs/known-limitations.md`）。

`audit_logs`のSELECTは cypress_admin、HQ系ロール、または`app_has_store_access`を満たす
`area_manager/store_manager`に限定（`00003_rls.sql`）。INSERTポリシーは存在せず、
書込は`log_audit()`（SECURITY DEFINER）経由のみに限定している。

## 例外的に緩い/厳しいポリシー

- `00005_fix_cash_rls.sql` — `staff`がレジ連動の`deposit`/`withdrawal`を記録できるよう追加ポリシー
  （既存ポリシーとOR結合されるため安全に追加可能）
- `00006_payroll_rls_tighten.sql` — `payroll_rules`/`commission_rules`/`payroll_runs`の
  SELECTを引き締め、一般スタッフが他人の給与・歩合設定を見られないようにした
- `payments`/`refunds`は`prevent_payment_delete()`トリガーでRLSに関係なく**常に**削除禁止
- `orders`は`prevent_paid_mutation()`トリガーで`status in ('paid','refunded')`の行の削除を禁止
  （未会計の`open`な注文はRLS許可があれば削除可）

## Storageのテナント分離

`documents`バケット（非公開、`00003_rls.sql`）はパスの先頭セグメントを`organization_id`とする
規約。SELECTは`app_is_org_member(folder[1]::uuid)`、INSERTは経理系ロール、DELETEはHQ系ロールに限定。

## 検証方法（`scripts/verify-flow.mjs`）

実環境（デモ組織のSupabase Auth経由ログイン、RLSが完全に効いた状態）でテナント分離を検証する
唯一のスクリプト。関連セクション:

- **セクション9: 店舗間分離** — 横浜店長が渋谷店の予約/注文/レジセッションをID直指定で取得できない
  ことを確認。HQ系アカウントは全店舗の注文を閲覧できる。`external_accountant`は閲覧可・書込不可を確認
- **セクション10: 企業間完全分離** — サービスロールで使い捨ての別組織（org2）・店舗・顧客を作成し、
  渋谷店長がorg2の`organizations`行を読めない、HQ管理者ですらorg2の`stores`行を読めない
  （HQ系でも他組織にはアクセスできないことの確認）、渋谷店長がorg2の顧客をID指定で読めない、
  org2顧客への更新が0行影響であることを確認。検証後は使い捨てデータをクリーンアップ
- **セクション11: ロール別アクセス制御** — アルバイト・本社経理が顧客PIIを閲覧できない、
  アルバイトが他人の`payroll_rules`/`payroll_items`を閲覧できない（00006の修正対象）、
  本社経理は全員の`payroll_rules`を閲覧できることを確認
- **セクション7: 物理削除防止** — `payments`/`orders`へのDELETEが拒否されることを確認
- **セクション13: 二重会計防止** — 同一注文への`finalize_order`の2回目呼び出しが`ORDER_NOT_OPEN`で
  拒否され、`payments`行が1件のみであることを確認

実行方法・本番での注意点は`docs/operations.md`を参照。
