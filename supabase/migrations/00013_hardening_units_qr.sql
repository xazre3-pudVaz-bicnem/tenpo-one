-- =============================================================
-- TENPO ONE — 00013 商用品質化: 単位変換・QR強化・KDSステーション・
-- 企業プロフィール・オンボーディング
-- =============================================================

-- ---- 在庫の単位変換（仕入単位 → 在庫単位） ----
-- 例: 鶏肉は kg で仕入れ g で在庫管理（係数1000）。レシピは在庫単位で記述。
alter table public.inventory_items
  add column purchase_unit text,
  add column purchase_to_stock_factor numeric(12,4) not null default 1
    check (purchase_to_stock_factor > 0);

-- ---- KDSステーション（カテゴリ単位の厨房振り分け） ----
alter table public.menu_categories
  add column station text not null default 'kitchen'
    check (station in ('kitchen','drink','dessert'));

-- ---- QRメニュー表示強化 ----
alter table public.menu_items
  add column is_recommended boolean not null default false,
  add column allergy_info text; -- 「えび・かに使用」等の注意文

-- ---- 企業プロフィール・オンボーディング ----
alter table public.organizations
  add column postal_code text,
  add column address text,
  add column phone text,
  add column logo_path text,
  add column billing_info jsonb not null default '{}'::jsonb,
  add column onboarding jsonb not null default '{}'::jsonb; -- {step: n, completed: bool, data: {...}}

-- ---- 店舗の勤怠既定設定（STEP23: DB直接変更を減らす） ----
alter table public.store_settings
  add column attendance_settings jsonb not null default '{}'::jsonb;
  -- {break_auto_minutes, overtime_threshold_minutes, night_start, night_end, closing_day}

-- =============================================================
-- get_qr_menu 再定義: 販売時間帯・オプション・画像・おすすめ・アレルギー注意
-- =============================================================
create or replace function public.get_qr_menu(p_slug text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_table public.restaurant_tables%rowtype;
  v_store public.stores%rowtype;
  v_now time := (now() at time zone 'Asia/Tokyo')::time;
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
            'price', mi.price, 'is_sold_out', mi.is_sold_out,
            'is_recommended', mi.is_recommended,
            'allergy_info', mi.allergy_info,
            'image_path', mi.image_path,
            'modifiers', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', mm.id, 'name', mm.name, 'price', mm.price) order by mm.sort_order), '[]'::jsonb)
              from public.menu_item_modifiers mim
              join public.menu_modifiers mm on mm.id = mim.modifier_id and mm.status = 'active'
              where mim.menu_item_id = mi.id))
            order by mi.is_recommended desc, mi.sort_order), '[]'::jsonb)
          from public.menu_items mi
          where mi.category_id = mc.id
            and mi.organization_id = v_store.organization_id
            and (mi.store_id is null or mi.store_id = v_store.id)
            and mi.status = 'active'
            and mi.item_type in ('food','drink')
            -- 販売時間帯: 未設定=終日。深夜跨ぎ（start>end）にも対応
            and (
              mi.sell_start_time is null or mi.sell_end_time is null
              or (mi.sell_start_time <= mi.sell_end_time
                  and v_now between mi.sell_start_time and mi.sell_end_time)
              or (mi.sell_start_time > mi.sell_end_time
                  and (v_now >= mi.sell_start_time or v_now <= mi.sell_end_time))
            )
        )) order by mc.sort_order), '[]'::jsonb)
      from public.menu_categories mc
      where mc.organization_id = v_store.organization_id
        and (mc.store_id is null or mc.store_id = v_store.id)
        and mc.status = 'active')
  );
end $$;

-- =============================================================
-- create_qr_order 再定義: オプション（modifier）対応・販売時間帯検証
-- p_items: [{"menu_item_id":"...","quantity":2,"memo":"...","modifier_ids":["..."]}]
-- =============================================================
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
  v_now time := (now() at time zone 'Asia/Tokyo')::time;
  v_mod_ids uuid[];
  v_mods jsonb;
  v_mods_total integer;
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

  select count(*) into v_recent from public.orders
  where table_id = v_table.id and order_source = 'qr'
    and created_at > now() - interval '1 minute';
  if v_recent >= 5 then raise exception 'RATE_LIMITED'; end if;

  select * into v_order from public.orders
  where table_id = v_table.id and status = 'open'
  order by created_at desc limit 1;

  if not found then
    insert into public.orders
      (organization_id, store_id, table_id, order_type, order_source, status, guest_count)
    values
      (v_store.organization_id, v_store.id, v_table.id, 'dine_in', 'qr', 'open', 1)
    returning * into v_order;
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
      and item_type in ('food','drink')
      and (
        sell_start_time is null or sell_end_time is null
        or (sell_start_time <= sell_end_time and v_now between sell_start_time and sell_end_time)
        or (sell_start_time > sell_end_time and (v_now >= sell_start_time or v_now <= sell_end_time))
      );
    if not found then raise exception 'ITEM_UNAVAILABLE'; end if;

    -- オプション: この商品に紐付く有効なmodifierのみ許可し、名称・価格をスナップショット
    v_mod_ids := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_item->'modifier_ids', '[]'::jsonb)) x),
      '{}');
    if array_length(v_mod_ids, 1) > 5 then raise exception 'TOO_MANY_MODIFIERS'; end if;

    select coalesce(jsonb_agg(jsonb_build_object('name', mm.name, 'price', mm.price)), '[]'::jsonb),
           coalesce(sum(mm.price), 0)::integer
    into v_mods, v_mods_total
    from public.menu_modifiers mm
    join public.menu_item_modifiers mim on mim.modifier_id = mm.id and mim.menu_item_id = v_menu.id
    where mm.id = any(v_mod_ids) and mm.status = 'active';

    if array_length(v_mod_ids, 1) is not null
       and jsonb_array_length(v_mods) <> array_length(v_mod_ids, 1) then
      raise exception 'INVALID_MODIFIER';
    end if;

    insert into public.order_items
      (organization_id, store_id, order_id, menu_item_id, name, unit_price, quantity,
       tax_rate, tax_included, line_total, memo, modifiers, kitchen_status)
    values
      (v_store.organization_id, v_store.id, v_order.id, v_menu.id, v_menu.name, v_menu.price,
       v_qty, (select coalesce(tr.rate, 10) from public.tax_rates tr where tr.id = v_menu.tax_rate_id),
       true, (v_menu.price + v_mods_total) * v_qty, nullif(trim(v_item->>'memo'), ''),
       v_mods, 'pending');
    v_count := v_count + 1;
  end loop;

  perform public.recalc_order_totals(v_order.id);

  return jsonb_build_object('ok', true, 'order_id', v_order.id,
    'items_added', v_count, 'table_name', v_table.name);
end $$;
