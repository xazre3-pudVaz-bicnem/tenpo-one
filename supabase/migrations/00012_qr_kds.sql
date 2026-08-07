-- =============================================================
-- TENPO ONE — 00012 PHASE 10/11: QRオーダー・KDS基盤
-- テーブルQRトークン（推測不能）・注文経路・厨房ステータス
-- =============================================================

-- テーブルごとのQRトークン（URLに table_id を出さない）
alter table public.restaurant_tables
  add column qr_token text unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

-- 注文経路（POS / QR / オンライン）
alter table public.orders
  add column order_source text not null default 'pos' check (order_source in ('pos','qr','online'));

-- 厨房ステータス（KDS）: 未着手→調理中→完成→提供済
alter table public.order_items
  add column kitchen_status text not null default 'pending'
    check (kitchen_status in ('pending','preparing','ready','served')),
  add column kitchen_started_at timestamptz,
  add column kitchen_ready_at timestamptz,
  add column served_at timestamptz;
create index idx_order_items_kitchen on public.order_items(store_id, kitchen_status, created_at);

-- -------------------------------------------------------------
-- QRオーダー用の公開RPC（anon・SECURITY DEFINER）
-- テーブル直接アクセスは与えず、トークン検証をRPC内で行う
-- -------------------------------------------------------------

-- QRメニュー取得（店舗情報・カテゴリ・商品）
create or replace function public.get_qr_menu(p_slug text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_table public.restaurant_tables%rowtype;
  v_store public.stores%rowtype;
begin
  select t.* into v_table
  from public.restaurant_tables t
  join public.stores s on s.id = t.store_id
  where t.qr_token = p_token and s.slug = p_slug
    and t.status = 'active';
  if not found then return null; end if;

  select * into v_store from public.stores where id = v_table.store_id and status = 'active';
  if not found then return null; end if;

  return jsonb_build_object(
    'store_name', v_store.name,
    'table_name', v_table.name,
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mc.id, 'name', mc.name, 'color', mc.color,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', mi.id, 'name', mi.name, 'description', mi.description,
            'price', mi.price, 'is_sold_out', mi.is_sold_out)
            order by mi.sort_order), '[]'::jsonb)
          from public.menu_items mi
          where mi.category_id = mc.id
            and mi.organization_id = v_store.organization_id
            and (mi.store_id is null or mi.store_id = v_store.id)
            and mi.status = 'active'
            and mi.item_type in ('food','drink')
        )) order by mc.sort_order), '[]'::jsonb)
      from public.menu_categories mc
      where mc.organization_id = v_store.organization_id
        and (mc.store_id is null or mc.store_id = v_store.id)
        and mc.status = 'active')
  );
end $$;

-- QR注文の作成（既存openオーダーへ追加 or 新規作成 → POS/KDSへ即時反映）
-- p_items: [{"menu_item_id":"...","quantity":2,"memo":"ネギ抜き"}]
create or replace function public.create_qr_order(p_slug text, p_token text, p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_table public.restaurant_tables%rowtype;
  v_store public.stores%rowtype;
  v_order public.orders%rowtype;
  v_item jsonb;
  v_menu public.menu_items%rowtype;
  v_qty integer;
  v_count integer := 0;
  v_recent integer;
begin
  select t.* into v_table
  from public.restaurant_tables t
  join public.stores s on s.id = t.store_id
  where t.qr_token = p_token and s.slug = p_slug and t.status = 'active';
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  select * into v_store from public.stores where id = v_table.store_id;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'TOO_MANY_ITEMS';
  end if;

  -- 簡易レート制限: 同一テーブルで1分に5回まで
  select count(*) into v_recent from public.orders
  where table_id = v_table.id and order_source = 'qr'
    and created_at > now() - interval '1 minute';
  if v_recent >= 5 then raise exception 'RATE_LIMITED'; end if;

  -- 当テーブルの open な注文へ追加、なければ新規作成
  select * into v_order from public.orders
  where table_id = v_table.id and status = 'open'
  order by created_at desc limit 1;

  if not found then
    insert into public.orders
      (organization_id, store_id, table_id, order_type, order_source, status, guest_count)
    values
      (v_store.organization_id, v_store.id, v_table.id, 'dine_in', 'qr', 'open', 1)
    returning * into v_order;
    -- テーブルを着席状態へ
    update public.restaurant_tables set current_status = 'seated'
    where id = v_table.id and current_status in ('available','reserved','waiting');
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::integer, 1);
    if v_qty < 1 or v_qty > 20 then raise exception 'INVALID_QUANTITY'; end if;

    select * into v_menu from public.menu_items
    where id = (v_item->>'menu_item_id')::uuid
      and organization_id = v_store.organization_id
      and (store_id is null or store_id = v_store.id)
      and status = 'active' and not is_sold_out
      and item_type in ('food','drink');
    if not found then raise exception 'ITEM_UNAVAILABLE'; end if;

    insert into public.order_items
      (organization_id, store_id, order_id, menu_item_id, name, unit_price, quantity,
       tax_rate, tax_included, line_total, memo, kitchen_status)
    values
      (v_store.organization_id, v_store.id, v_order.id, v_menu.id, v_menu.name, v_menu.price,
       v_qty, (select coalesce(tr.rate, 10) from public.tax_rates tr where tr.id = v_menu.tax_rate_id),
       true, v_menu.price * v_qty, nullif(trim(v_item->>'memo'), ''), 'pending');
    v_count := v_count + 1;
  end loop;

  perform public.recalc_order_totals(v_order.id);

  return jsonb_build_object('ok', true, 'order_id', v_order.id,
    'items_added', v_count, 'table_name', v_table.name);
end $$;

-- QR注文の履歴表示（自テーブルの注文内容のみ）
create or replace function public.get_qr_order_status(p_slug text, p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'table_name', t.name,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', oi.name, 'quantity', oi.quantity, 'kitchen_status', oi.kitchen_status,
        'ordered_at', to_char(oi.created_at at time zone 'Asia/Tokyo', 'HH24:MI'))
        order by oi.created_at desc)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.table_id = t.id and o.status = 'open' and oi.status = 'active'), '[]'::jsonb),
    'total', coalesce((
      select o.total from public.orders o
      where o.table_id = t.id and o.status = 'open'
      order by o.created_at desc limit 1), 0))
  from public.restaurant_tables t
  join public.stores s on s.id = t.store_id
  where t.qr_token = p_token and s.slug = p_slug and t.status = 'active';
$$;

grant execute on function
  public.get_qr_menu(text, text),
  public.create_qr_order(text, text, jsonb),
  public.get_qr_order_status(text, text)
to anon, authenticated;
