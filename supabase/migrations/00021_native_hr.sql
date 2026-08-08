-- =============================================================
-- TENPO ONE — 00021 ネイティブ労務（従業員台帳・有給・賞与・年調WF・社保構造）
-- 方針: 外部勤怠/給与SaaSを必須にしない。法定値はlegal_rule_versions参照
--（専門家レビュー前に投入しない）。給与計算は既存payroll_runsを拡張。
-- =============================================================

-- ---- 従業員台帳（ログインユーザー(profiles)の人事情報。機密は給与権限のみ） ----
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  employee_no text,
  legal_name text, -- 戸籍名（表示名と別管理）
  legal_name_kana text,
  postal_code text,
  address text,
  birth_date date,
  hired_on date,
  terminated_on date,
  employment_type text not null default 'part_time' check (employment_type in
    ('full_time','contract','part_time','outsourced')),
  position text,
  primary_store_id uuid references public.stores(id),
  bank_transfer_info jsonb, -- {bank, branch, type, last4, holder} 全桁口座番号は保存しない
  emergency_contact jsonb,  -- {name, relation, phone}
  note text,
  status text not null default 'active' check (status in ('active','retired','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (organization_id, profile_id)
);
create unique index idx_employees_no on public.employees(organization_id, employee_no)
  where employee_no is not null;
create trigger trg_employees_updated_at before update on public.employees
  for each row execute function public.set_updated_at();

-- ---- 社会保険（構造のみ。料率は legal_rule_versions を参照し専門家確認後に投入） ----
create table public.employee_insurance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  health_insurance boolean not null default false,
  pension boolean not null default false,
  employment_insurance boolean not null default false,
  care_insurance boolean not null default false,
  standard_monthly_remuneration integer, -- 標準報酬月額
  acquired_on date,  -- 資格取得日
  lost_on date,      -- 資格喪失日
  region text,       -- 都道府県（健保料率の地域差用）
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create trigger trg_employee_insurance_updated_at before update on public.employee_insurance
  for each row execute function public.set_updated_at();

-- ---- 有給休暇（付与ルールは会社設定・適用期間管理） ----
create table public.leave_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  granted_on date not null,
  days numeric(5,2) not null check (days > 0), -- 半休(0.5)・時間換算に対応
  expires_on date not null,
  reason text not null default 'annual', -- annual=年次付与 / adjustment=調整
  note text,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index idx_leave_grants_profile on public.leave_grants(profile_id, expires_on);

-- 有給取得の単位（1.0=全休 / 0.5=半休 / 時間休は minutes/所定で換算した端数）
alter table public.time_entries
  add column leave_fraction numeric(4,2) check (leave_fraction is null or (leave_fraction > 0 and leave_fraction <= 1));

-- 会社の有給付与ルール（法定初期値は入れない。企業が設定 or 専門家確認後にテンプレ提供）
alter table public.store_settings
  add column leave_settings jsonb not null default '{}'::jsonb;
alter table public.organizations
  add column leave_policy jsonb not null default '{}'::jsonb; -- {annual_grant_table:[...], expiry_years:2}

-- ---- 給与runの拡張: 賞与run・計算ルールversion ----
alter table public.payroll_runs
  add column run_type text not null default 'salary' check (run_type in ('salary','bonus')),
  add column rule_version text not null default 'v2', -- 計算エンジンversion（過去runの再現性）
  add column payment_date date;

-- ---- 年末調整ワークフロー（データモデルと状態遷移のみ。計算は専門家レビュー後） ----
create table public.nencho_declarations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  profile_id uuid not null references public.profiles(id),
  year integer not null,
  status text not null default 'draft' check (status in
    ('draft','submitted','reviewing','needs_fix','confirmed')),
  -- 申告データ（扶養・配偶者・保険料・住宅ローン・前職源泉等）。スキーマはUI側zodで管理
  data jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (organization_id, profile_id, year)
);
create trigger trg_nencho_updated_at before update on public.nencho_declarations
  for each row execute function public.set_updated_at();

-- =============================================================
-- RLS（機密度が高いため厳格に）
-- =============================================================

-- employees: 本人=自分の行を閲覧可（銀行情報等は含むが本人情報のため可）。
-- 管理=給与閲覧ロール。店長は自店従業員の基本情報のみ（bank/emergencyはUI層で制御し、
-- RLSでは行アクセスまで。列レベル制御はビュー化が必要なためUI+action層で担保）
alter table public.employees enable row level security;
create policy employees_select on public.employees for select
  using (
    profile_id = auth.uid()
    or public.app_is_cypress_admin()
    or public.app_can_view_payroll(organization_id)
    or (public.app_role_in(organization_id, array['area_manager','store_manager'])
        and public.app_has_store_access(organization_id, primary_store_id)));
create policy employees_write on public.employees for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','hq_accounting']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','hq_accounting']));

alter table public.employee_insurance enable row level security;
create policy employee_insurance_select on public.employee_insurance for select
  using (
    public.app_is_cypress_admin()
    or public.app_can_view_payroll(organization_id)
    or exists (select 1 from public.employees e
               where e.id = employee_id and e.profile_id = auth.uid()));
create policy employee_insurance_write on public.employee_insurance for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','hq_accounting']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','hq_accounting']));

alter table public.leave_grants enable row level security;
create policy leave_grants_select on public.leave_grants for select
  using (
    profile_id = auth.uid()
    or public.app_is_cypress_admin()
    or public.app_role_in(organization_id,
      array['org_owner','hq_admin','hq_accounting','area_manager','store_manager','assistant_manager']));
create policy leave_grants_write on public.leave_grants for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','hq_accounting','area_manager','store_manager']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','hq_accounting','area_manager','store_manager']));

alter table public.nencho_declarations enable row level security;
-- 本人: 自分の申告を作成・編集（draft/needs_fixのみ実質。状態はaction層で制御）
create policy nencho_self on public.nencho_declarations for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.app_is_org_member(organization_id));
create policy nencho_admin_select on public.nencho_declarations for select
  using (public.app_is_cypress_admin() or public.app_can_view_payroll(organization_id));
create policy nencho_admin_write on public.nencho_declarations for update
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','hq_accounting']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','hq_accounting']));
