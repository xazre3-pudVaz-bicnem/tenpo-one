-- =============================================================
-- 店舗のアクセス制限（契約時に運営が設定する）— 2026-09-23 要望
--
--   - レジ（iPad）とハンディは「お店の回線（IP）」からだけ使えるようにする
--   - レジとして使える iPad の台数を契約で決める（既定2台）
--
-- 設定できるのは TENPO ONE の運営（cypress管理者）だけ。店舗の店長・オーナーは見えるが変更できない
-- （店舗側で緩められると意味がないため）。
-- 回線が未登録の店舗は、今まで通り制限なし（既存店をいきなり止めない）。
-- =============================================================

create table if not exists public.store_access_policies (
  store_id uuid primary key references public.stores(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  /** 許可する回線。[{ "key": "203.0.113.5", "label": "店舗光回線" }]。IPv6 は上位64ビット */
  networks jsonb not null default '[]'::jsonb,
  /** レジとして登録できる端末（iPad）の台数 */
  register_limit integer not null default 2 check (register_limit between 0 and 20),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table public.store_access_policies is '店舗のアクセス制限（運営が契約時に設定: 許可する回線・レジ端末の台数）';

-- レジ端末（iPad）。1台につき1行。ブラウザのCookieのトークンで識別する。
create table if not exists public.register_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  /** Cookie に入れるトークンのハッシュ（平文は保存しない） */
  token_hash text not null,
  name text not null default 'レジ端末',
  user_agent text,
  first_ip text,
  last_seen_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists idx_register_devices_token on public.register_devices(token_hash);
create index if not exists idx_register_devices_store on public.register_devices(store_id, status);

comment on table public.register_devices is 'レジとして使っている端末（iPad）。台数の上限は store_access_policies.register_limit';

alter table public.store_access_policies enable row level security;
alter table public.register_devices enable row level security;

-- 店舗の人は見えるだけ（変更は運営＝サービスロールから）
drop policy if exists store_access_policies_select on public.store_access_policies;
create policy store_access_policies_select on public.store_access_policies for select
  using (
    public.app_is_cypress_admin()
    or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id))
  );

drop policy if exists store_access_policies_write on public.store_access_policies;
create policy store_access_policies_write on public.store_access_policies for all
  using (public.app_is_cypress_admin())
  with check (public.app_is_cypress_admin());

drop policy if exists register_devices_select on public.register_devices;
create policy register_devices_select on public.register_devices for select
  using (
    public.app_is_cypress_admin()
    or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id))
  );

-- 解除（status の変更）は店長以上。作成はサーバー側（サービスロール）から。
drop policy if exists register_devices_update on public.register_devices;
create policy register_devices_update on public.register_devices for update
  using (
    public.app_is_cypress_admin()
    or (
      public.app_is_org_member(organization_id)
      and public.app_has_store_access(organization_id, store_id)
      and public.app_role_in(organization_id, array['org_owner', 'hq_admin', 'area_manager', 'store_manager'])
    )
  )
  with check (
    public.app_is_cypress_admin()
    or (
      public.app_is_org_member(organization_id)
      and public.app_has_store_access(organization_id, store_id)
      and public.app_role_in(organization_id, array['org_owner', 'hq_admin', 'area_manager', 'store_manager'])
    )
  );
