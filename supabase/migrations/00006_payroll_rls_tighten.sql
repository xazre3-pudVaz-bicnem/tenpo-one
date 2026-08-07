-- =============================================================
-- TENPO ONE — 00006 fix
-- 給与関連テーブルの閲覧制限を強化する。
-- 00003の自動生成ポリシーでは payroll_rules / commission_rules /
-- payroll_runs のSELECTが「組織メンバー全員」になっており、
-- 一般スタッフ・アルバイトが他人の基本給・歩合設定を閲覧できた。
--
-- 修正後の閲覧範囲:
--   payroll_rules    … 給与閲覧ロール + 店長系（人件費予測用・権限マトリクスの自店R近似）+ 本人の行
--   commission_rules … 同上（profile_id null の全体ルールは対象スタッフも閲覧可）
--   payroll_runs     … 給与閲覧ロールのみ（明細 payroll_items は既存ポリシーで本人+給与閲覧者）
-- =============================================================

drop policy if exists payroll_rules_select on public.payroll_rules;
create policy payroll_rules_select on public.payroll_rules for select
  using (
    public.app_is_cypress_admin()
    or public.app_can_view_payroll(organization_id)
    or public.app_role_in(organization_id, array['area_manager','store_manager'])
    or profile_id = auth.uid()
  );

drop policy if exists commission_rules_select on public.commission_rules;
create policy commission_rules_select on public.commission_rules for select
  using (
    public.app_is_cypress_admin()
    or public.app_can_view_payroll(organization_id)
    or public.app_role_in(organization_id, array['area_manager','store_manager'])
    or profile_id = auth.uid()
    or (profile_id is null and public.app_is_org_member(organization_id))
  );

drop policy if exists payroll_runs_select on public.payroll_runs;
create policy payroll_runs_select on public.payroll_runs for select
  using (
    public.app_is_cypress_admin()
    or public.app_can_view_payroll(organization_id)
  );
