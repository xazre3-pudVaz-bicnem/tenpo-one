-- =============================================================
-- POS担当者（名前のみの台帳）
--   スタッフアカウント（auth.users）を作らずに、会計・伝票で「担当者名」を選べるようにする。
--   dinii 等からの移行で、権限管理は不要だが誰が会計したかは残したい、という運用に対応する。
--   伝票には clerk_id（参照）と clerk_name（発行時点のスナップショット）の両方を持たせ、
--   後から担当者名を変更・非表示にしても過去のレシート・履歴の表示が変わらないようにする。
-- =============================================================

create table if not exists public.pos_clerks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  name text not null,
  sort_order integer not null default 0,
  -- hidden: 退職等で選択肢から外すが、過去伝票の参照は壊さない（削除ではなく非表示）
  status text not null default 'active' check (status in ('active', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- 同一店舗内で担当者名は一意（重複登録の防止）
create unique index if not exists idx_pos_clerks_store_name on public.pos_clerks(store_id, name);
create index if not exists idx_pos_clerks_store on public.pos_clerks(store_id, status, sort_order);

drop trigger if exists trg_pos_clerks_updated_at on public.pos_clerks;
create trigger trg_pos_clerks_updated_at before update on public.pos_clerks
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- 伝票の担当者
-- -------------------------------------------------------------
alter table public.orders
  add column if not exists clerk_id uuid references public.pos_clerks(id),
  add column if not exists clerk_name text;

-- -------------------------------------------------------------
-- RLS（00003の標準ポリシーと同じ形。参照は店舗アクセスを持つ組織メンバー、
--      更新は店長以上＝mgmt相当に限定する）
-- -------------------------------------------------------------
alter table public.pos_clerks enable row level security;

drop policy if exists pos_clerks_select on public.pos_clerks;
create policy pos_clerks_select on public.pos_clerks for select using (
  public.app_is_cypress_admin()
  or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id))
);

drop policy if exists pos_clerks_insert on public.pos_clerks;
create policy pos_clerks_insert on public.pos_clerks for insert with check (
  public.app_is_cypress_admin()
  or (
    public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager','assistant_manager'])
    and public.app_has_store_access(organization_id, store_id)
  )
);

drop policy if exists pos_clerks_update on public.pos_clerks;
create policy pos_clerks_update on public.pos_clerks for update using (
  public.app_is_cypress_admin()
  or (
    public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager','assistant_manager'])
    and public.app_has_store_access(organization_id, store_id)
  )
) with check (
  public.app_is_cypress_admin()
  or (
    public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager','assistant_manager'])
    and public.app_has_store_access(organization_id, store_id)
  )
);

drop policy if exists pos_clerks_delete on public.pos_clerks;
create policy pos_clerks_delete on public.pos_clerks for delete using (
  public.app_is_cypress_admin()
  or (
    public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager','assistant_manager'])
    and public.app_has_store_access(organization_id, store_id)
  )
);
