-- =============================================================
-- TENPO ONE — 00010 PHASE 4: レシピ・原価管理
-- 商品×構成食材（レシピ）。販売時に構成食材の理論在庫を自動減算する。
-- =============================================================

create table public.menu_item_ingredients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity numeric(12,3) not null check (quantity > 0), -- 1商品あたりの使用量（品目の単位で）
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (menu_item_id, inventory_item_id)
);
create index idx_menu_item_ingredients_item on public.menu_item_ingredients(menu_item_id);
create index idx_menu_item_ingredients_inv on public.menu_item_ingredients(inventory_item_id);

create trigger trg_menu_item_ingredients_updated_at
  before update on public.menu_item_ingredients
  for each row execute function public.set_updated_at();

alter table public.menu_item_ingredients enable row level security;
create policy menu_item_ingredients_select on public.menu_item_ingredients for select
  using (public.app_is_cypress_admin() or public.app_is_org_member(organization_id));
create policy menu_item_ingredients_write on public.menu_item_ingredients for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','area_manager','store_manager']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','area_manager','store_manager']));

-- finalize_order 再定義: レシピ構成食材の理論在庫を自動減算
-- （menu_item_id 直結の商品在庫減算に加えて、レシピがある商品は食材を減算）
create or replace function public.finalize_order(
  p_order_id uuid,
  p_payments jsonb,
  p_register_session_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_pay jsonb;
  v_sum integer := 0;
  v_cash integer := 0;
  v_method text;
  v_amount integer;
  v_tendered integer;
  v_change integer;
  v_bd date := (now() at time zone 'Asia/Tokyo')::date;
  v_inv record;
  v_ing record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'open' then raise exception 'ORDER_NOT_OPEN'; end if;
  if not public.app_has_store_access(v_order.organization_id, v_order.store_id) then
    raise exception 'FORBIDDEN';
  end if;

  perform public.recalc_order_totals(p_order_id);
  select * into v_order from public.orders where id = p_order_id;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_sum := v_sum + (v_pay->>'amount')::integer;
  end loop;
  if v_sum <> v_order.total then
    raise exception 'PAYMENT_MISMATCH: total=% payments=%', v_order.total, v_sum;
  end if;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_method := v_pay->>'method';
    v_amount := (v_pay->>'amount')::integer;
    v_tendered := nullif(v_pay->>'tendered','')::integer;
    v_change := case when v_method = 'cash' and v_tendered is not null
                     then greatest(0, v_tendered - v_amount) else null end;

    insert into public.payments
      (organization_id, store_id, order_id, register_session_id, method, amount,
       tendered, change_amount, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, p_order_id, p_register_session_id,
       v_method, v_amount, v_tendered, v_change, v_bd, auth.uid());

    if v_method = 'cash' then
      v_cash := v_cash + v_amount;
    end if;
  end loop;

  if v_cash > 0 and p_register_session_id is not null then
    insert into public.cash_transactions
      (organization_id, store_id, register_session_id, kind, amount, purpose,
       order_id, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, p_register_session_id, 'sale', v_cash,
       '売上（注文 #' || v_order.order_no || '）', p_order_id, v_bd, auth.uid());
  end if;

  update public.orders
  set status = 'paid', closed_at = now(), business_date = v_bd,
      register_session_id = coalesce(p_register_session_id, register_session_id),
      updated_by = auth.uid()
  where id = p_order_id;

  if v_order.customer_id is not null then
    update public.customers
    set visit_count = visit_count + 1,
        total_spent = total_spent + v_order.total,
        last_visit_at = now(),
        first_visit_at = coalesce(first_visit_at, now())
    where id = v_order.customer_id;
  end if;

  if v_order.reservation_id is not null then
    update public.reservations set status = 'completed'
    where id = v_order.reservation_id
      and status in ('confirmed','waiting','arrived','seated','billing');
  end if;

  if v_order.table_id is not null then
    update public.restaurant_tables set current_status = 'cleaning'
    where id = v_order.table_id;
  end if;

  -- ① menu_item 直結の商品在庫（ドリンク樽等）
  for v_inv in
    select ii.id as inventory_item_id, oi.quantity
    from public.order_items oi
    join public.inventory_items ii
      on ii.menu_item_id = oi.menu_item_id and ii.store_id = v_order.store_id and ii.status = 'active'
    where oi.order_id = p_order_id and oi.status = 'active' and oi.menu_item_id is not null
  loop
    insert into public.stock_movements
      (organization_id, store_id, inventory_item_id, movement_type, quantity,
       ref_order_id, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, v_inv.inventory_item_id, 'sale',
       -v_inv.quantity, p_order_id, v_bd, auth.uid());
    update public.inventory_items
    set current_quantity = current_quantity - v_inv.quantity
    where id = v_inv.inventory_item_id;
  end loop;

  -- ② レシピ構成食材の理論在庫減算（PHASE 4）
  --    使用量 = レシピ量 × 注文数量。当店の同名食材（inventory_item）を減算する
  for v_ing in
    select st.id as store_item_id, (mii.quantity * oi.quantity) as use_qty
    from public.order_items oi
    join public.menu_item_ingredients mii on mii.menu_item_id = oi.menu_item_id
    join public.inventory_items ii_recipe on ii_recipe.id = mii.inventory_item_id
    join lateral (
      -- 当店の対応食材を1件だけ選ぶ（レシピ登録品目と同一店舗ならそれを最優先、
      -- 他店舗品目で登録されたレシピは同名品目へフォールバック）
      select ii.id from public.inventory_items ii
      where ii.organization_id = v_order.organization_id
        and ii.store_id = v_order.store_id
        and ii.status = 'active'
        and (ii.id = mii.inventory_item_id or ii.name = ii_recipe.name)
      order by (ii.id = mii.inventory_item_id) desc
      limit 1
    ) st on true
    where oi.order_id = p_order_id and oi.status = 'active' and oi.menu_item_id is not null
  loop
    insert into public.stock_movements
      (organization_id, store_id, inventory_item_id, movement_type, quantity,
       ref_order_id, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, v_ing.store_item_id, 'sale',
       -v_ing.use_qty, p_order_id, v_bd, auth.uid());
    update public.inventory_items
    set current_quantity = current_quantity - v_ing.use_qty
    where id = v_ing.store_item_id;
  end loop;

  perform public.log_audit(v_order.organization_id, v_order.store_id, 'order.finalize',
    'orders', p_order_id::text, null,
    jsonb_build_object('total', v_order.total, 'payments', p_payments), null);

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'total', v_order.total);
end $$;
