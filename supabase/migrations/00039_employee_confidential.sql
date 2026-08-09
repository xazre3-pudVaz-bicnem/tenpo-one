-- =============================================================
-- SECURITY: 従業員の機密情報（銀行・緊急連絡先）をカラム分離（監査 G-1 / HIGH）
-- 従来 employees_select は area_manager/store_manager にも行全体を許可し、
-- PostgREST `?select=bank_transfer_info,emergency_contact` で店長が銀行情報・
-- 緊急連絡先を直接取得できた（行RLSはカラムを隠せない）。
-- authenticated ロール内で給与管理者と店長を区別できないため、機密2列を
-- 専用テーブルへ分離し、RLSで給与ロール（org_owner/hq_admin/hq_accounting）＋本人に限定する。
-- =============================================================

create table if not exists public.employee_confidential (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  profile_id uuid,  -- 本人閲覧判定用（employees.profile_id のコピー）
  bank_transfer_info jsonb,   -- 口座は下4桁のみ保持
  emergency_contact jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists idx_employee_confidential_org on public.employee_confidential(organization_id);

-- 既存データを移行
insert into public.employee_confidential (employee_id, organization_id, profile_id, bank_transfer_info, emergency_contact)
select id, organization_id, profile_id, bank_transfer_info, emergency_contact
from public.employees
where bank_transfer_info is not null or emergency_contact is not null
on conflict (employee_id) do nothing;

alter table public.employee_confidential enable row level security;
-- 閲覧: 給与ロール + 本人 + cypress
create policy emp_conf_select on public.employee_confidential for select
  using (
    public.app_is_cypress_admin()
    or public.app_role_in(organization_id, array['org_owner','hq_admin','hq_accounting'])
    or profile_id = auth.uid()
  );
-- 書込: 給与ロール + cypress（本人は編集不可）
create policy emp_conf_write on public.employee_confidential for all
  using (
    public.app_is_cypress_admin()
    or public.app_role_in(organization_id, array['org_owner','hq_admin','hq_accounting'])
  )
  with check (
    public.app_is_cypress_admin()
    or public.app_role_in(organization_id, array['org_owner','hq_admin','hq_accounting'])
  );

-- employees 本体から機密列を削除（店長ロールへのカラム露出を根絶）
alter table public.employees drop column if exists bank_transfer_info;
alter table public.employees drop column if exists emergency_contact;
