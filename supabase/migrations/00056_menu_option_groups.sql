-- =============================================================
-- メニュー選択肢グループ（必須・最小/最大・追加料金）
--
-- 「ライスの大きさ」「トッピング」のように、商品に紐づく選択肢をグループ単位で定義する。
--   menu_option_groups      … グループ（必須か / 何個選べるか）
--   menu_option_items       … グループ内の選択肢（追加料金つき）
--   menu_item_option_groups … 商品とグループの紐付け（多対多）
--
-- 選択結果は order_items.modifiers(jsonb) に [{name, price}] として保存し、
-- 追加料金は order_items.unit_price に加算する（レシートは modifiers を既に描画できる）。
--
-- RLS は 00003 の標準ポリシーと同形にするため、3テーブルとも organization_id と
-- store_id を持たせる（join先を辿らずに済み、ポリシーが単純になる）。
-- =============================================================

create table if not exists public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  name text not null,
  -- 必須グループは最低1つ選ばないと注文に追加できない
  is_required boolean not null default false,
  min_select integer not null default 0,
  max_select integer not null default 1,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint menu_option_groups_range check (min_select >= 0 and max_select >= 1 and min_select <= max_select)
);
create index if not exists idx_menu_option_groups_store on public.menu_option_groups(store_id, status, sort_order);

create table if not exists public.menu_option_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  group_id uuid not null references public.menu_option_groups(id) on delete cascade,
  name text not null,
  -- 追加料金（0なら無料。税率は親商品に従う）
  price integer not null default 0,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index if not exists idx_menu_option_items_group on public.menu_option_items(group_id, status, sort_order);

create table if not exists public.menu_item_option_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  group_id uuid not null references public.menu_option_groups(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (menu_item_id, group_id)
);
create index if not exists idx_menu_item_option_groups_item on public.menu_item_option_groups(menu_item_id, sort_order);

-- updated_at 自動更新（00001と同じ関数を使う）
do $$
declare t text;
begin
  foreach t in array array['menu_option_groups', 'menu_option_items', 'menu_item_option_groups'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- -------------------------------------------------------------
-- RLS（参照=店舗アクセスを持つ組織メンバー / 更新=店長以上）
-- -------------------------------------------------------------
do $$
declare
  t text;
  v_roles text := $q$array['org_owner','hq_admin','area_manager','store_manager','assistant_manager']$q$;
  v_sel text;
  v_wr text;
begin
  foreach t in array array['menu_option_groups', 'menu_option_items', 'menu_item_option_groups'] loop
    execute format('alter table public.%I enable row level security', t);

    v_sel := 'public.app_is_cypress_admin() or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id))';
    v_wr := format(
      'public.app_is_cypress_admin() or (public.app_role_in(organization_id, %s) and public.app_has_store_access(organization_id, store_id))',
      v_roles);

    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select using (%s)', t, t, v_sel);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (%s)', t, t, v_wr);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update using (%s) with check (%s)', t, t, v_wr, v_wr);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete using (%s)', t, t, v_wr);
  end loop;
end $$;
