-- =============================================================
-- v0.4.1 NATIVE BACK OFFICE HARDENING
-- 1) 法定ルール: 根拠・確認者・確認日・有効化記録 + 状態遷移のDB強制
-- 2) 勤怠修正申請（締め後はスタッフ申請→管理者承認で修正）
-- 3) 有給申請（申請→承認→取得のワークフロー受け皿）
-- 4) 給与確定snapshot（使用ルールの不変保存）+ 確定後のDB層ロック
-- =============================================================

-- -------------------------------------------------------------
-- 1) legal_rule_versions 拡張
-- -------------------------------------------------------------
alter table public.legal_rule_versions
  add column if not exists basis text,             -- 根拠（法令名・通達・公的資料URL等）
  add column if not exists reviewed_by_name text,  -- 確認者（税理士・社労士等。システム外の人物のため氏名で保持）
  add column if not exists reviewed_at date,       -- 確認日
  add column if not exists activated_by uuid,      -- 有効化した運営管理者
  add column if not exists activated_at timestamptz;

-- 状態遷移の強制:
--   draft → reviewed（根拠・確認者・確認日が必須）
--   reviewed → active（activated_by/at を自動記録）/ reviewed → draft（差戻）
--   active → superseded
-- 未確認の数値が計算エンジン（status='active'参照）に到達する事故をDB層で防ぐ。
create or replace function public.enforce_legal_rule_transition()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'draft'    and new.status = 'reviewed') or
      (old.status = 'reviewed' and new.status in ('draft','active')) or
      (old.status = 'active'   and new.status = 'superseded')
    ) then
      raise exception 'INVALID_STATUS_TRANSITION: % -> %', old.status, new.status;
    end if;
    if new.status = 'reviewed' and (
      new.basis is null or length(trim(new.basis)) = 0
      or new.reviewed_by_name is null or length(trim(new.reviewed_by_name)) = 0
      or new.reviewed_at is null
    ) then
      raise exception 'REVIEW_INFO_REQUIRED';
    end if;
    if new.status = 'active' then
      new.activated_by := auth.uid();
      new.activated_at := now();
    end if;
  end if;
  -- 新規行はdraftのみ（reviewed/activeを直接insertさせない）
  if tg_op = 'INSERT' and new.status <> 'draft' then
    raise exception 'INSERT_MUST_BE_DRAFT';
  end if;
  return new;
end $$;

drop trigger if exists trg_legal_rule_transition on public.legal_rule_versions;
create trigger trg_legal_rule_transition
  before insert or update on public.legal_rule_versions
  for each row execute function public.enforce_legal_rule_transition();

-- active化されたルールのparameters改変を禁止（変更は新versionを起こす）
create or replace function public.prevent_active_legal_rule_mutation()
returns trigger language plpgsql as $$
begin
  if old.status in ('active','superseded') and new.status = old.status
     and new.parameters is distinct from old.parameters then
    raise exception 'ACTIVE_RULE_IMMUTABLE: 有効化済みルールの値は変更できません。新しいversionを作成してください';
  end if;
  return new;
end $$;

drop trigger if exists trg_legal_rule_immutable on public.legal_rule_versions;
create trigger trg_legal_rule_immutable
  before update on public.legal_rule_versions
  for each row execute function public.prevent_active_legal_rule_mutation();

-- -------------------------------------------------------------
-- 2) 勤怠修正申請（給与確定期間ロック後の唯一の修正経路）
-- -------------------------------------------------------------
create table if not exists public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  profile_id uuid not null references public.profiles(id),
  time_entry_id uuid references public.time_entries(id),
  work_date date not null,
  requested_changes jsonb not null, -- {clock_in_at, clock_out_at, break_minutes} 希望値
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_att_corr_org on public.attendance_correction_requests(organization_id, store_id, status);
create index if not exists idx_att_corr_profile on public.attendance_correction_requests(profile_id, work_date);
drop trigger if exists trg_att_corr_updated_at on public.attendance_correction_requests;
create trigger trg_att_corr_updated_at before update on public.attendance_correction_requests
  for each row execute function public.set_updated_at();

alter table public.attendance_correction_requests enable row level security;

-- 本人: 自分の申請の作成・閲覧・取下げ
create policy att_corr_self_insert on public.attendance_correction_requests for insert
  with check (profile_id = auth.uid() and public.app_is_org_member(organization_id));
create policy att_corr_select on public.attendance_correction_requests for select
  using (
    public.app_is_cypress_admin()
    or profile_id = auth.uid()
    or (public.app_has_store_access(organization_id, store_id)
        and public.app_role_in(organization_id,
          array['org_owner','hq_admin','hq_accounting','area_manager','store_manager']))
  );
-- 本人はpending中の取下げのみ、管理者は承認/却下
create policy att_corr_self_update on public.attendance_correction_requests for update
  using (profile_id = auth.uid() and status = 'pending')
  with check (profile_id = auth.uid() and status in ('pending','cancelled'));
create policy att_corr_admin_update on public.attendance_correction_requests for update
  using (
    public.app_has_store_access(organization_id, store_id)
    and public.app_role_in(organization_id,
      array['org_owner','hq_admin','area_manager','store_manager'])
  );

-- -------------------------------------------------------------
-- 3) 有給申請（付与→残数→申請→承認→取得）
--    取得の実体は承認時に time_entries.leave_fraction として記録される
-- -------------------------------------------------------------
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  profile_id uuid not null references public.profiles(id),
  leave_date date not null,
  fraction numeric(4,2) not null default 1 check (fraction > 0 and fraction <= 1), -- 1=全休 0.5=半休
  hours numeric(4,2) check (hours is null or hours > 0), -- 時間単位年休の受け皿（現UIは全休/半休）
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  time_entry_id uuid references public.time_entries(id), -- 承認時に作成された勤怠行
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, leave_date) -- 同日二重申請の防止（取下げ後の再申請はupdateで対応）
);
create index if not exists idx_leave_req_org on public.leave_requests(organization_id, store_id, status);
drop trigger if exists trg_leave_req_updated_at on public.leave_requests;
create trigger trg_leave_req_updated_at before update on public.leave_requests
  for each row execute function public.set_updated_at();

alter table public.leave_requests enable row level security;
create policy leave_req_self_insert on public.leave_requests for insert
  with check (profile_id = auth.uid() and public.app_is_org_member(organization_id));
create policy leave_req_select on public.leave_requests for select
  using (
    public.app_is_cypress_admin()
    or profile_id = auth.uid()
    or (public.app_has_store_access(organization_id, store_id)
        and public.app_role_in(organization_id,
          array['org_owner','hq_admin','hq_accounting','area_manager','store_manager']))
  );
create policy leave_req_self_update on public.leave_requests for update
  using (profile_id = auth.uid() and status = 'pending')
  with check (profile_id = auth.uid() and status in ('pending','cancelled'));
create policy leave_req_admin_update on public.leave_requests for update
  using (
    public.app_has_store_access(organization_id, store_id)
    and public.app_role_in(organization_id,
      array['org_owner','hq_admin','area_manager','store_manager'])
  );

-- -------------------------------------------------------------
-- 4) 給与確定の不変性
-- -------------------------------------------------------------
-- 確定時に使用した給与ルール（時給・歩合率・ルールversion等）のsnapshot。
-- 以後ルールを変更しても過去runの再現に必要な情報はここに固定される。
alter table public.payroll_runs
  add column if not exists rules_snapshot jsonb;

-- 確定(approved)後の明細改変をDB層で拒否（アプリ層ロックの防波堤）
create or replace function public.prevent_approved_payroll_mutation()
returns trigger language plpgsql as $$
declare
  v_run uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then v_run := old.payroll_run_id; else v_run := new.payroll_run_id; end if;
  select status into v_status from public.payroll_runs where id = v_run;
  if v_status = 'approved' then
    raise exception 'PAYROLL_RUN_LOCKED: 確定済みの給与明細は変更できません';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_payroll_items_lock on public.payroll_items;
create trigger trg_payroll_items_lock
  before update or delete on public.payroll_items
  for each row execute function public.prevent_approved_payroll_mutation();

-- 確定後のrun本体は snapshot/期間/種別の書き換えを拒否（statusの遷移とnoteのみ許可）
create or replace function public.prevent_approved_payroll_run_mutation()
returns trigger language plpgsql as $$
begin
  if old.status = 'approved' and (
    new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.rules_snapshot is distinct from old.rules_snapshot
  ) then
    raise exception 'PAYROLL_RUN_LOCKED: 確定済み給与の期間・計算根拠は変更できません';
  end if;
  return new;
end $$;

drop trigger if exists trg_payroll_runs_lock on public.payroll_runs;
create trigger trg_payroll_runs_lock
  before update on public.payroll_runs
  for each row execute function public.prevent_approved_payroll_run_mutation();
