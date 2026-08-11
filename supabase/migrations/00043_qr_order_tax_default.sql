-- =============================================================
-- create_qr_order の税率フォールバック修正（全店舗共通）
-- 既存: (select coalesce(tr.rate,10) from tax_rates where id = v_menu.tax_rate_id)
--   → menu_items.tax_rate_id が null の場合、サブクエリが0行を返し結果がNULLになり、
--     order_items.tax_rate(NOT NULL)違反でQR注文が失敗する。
-- 修正: coalesce((select tr.rate ...), 10) と外側で既定10%へフォールバック。
-- これにより、税率未紐付けのメニュー（新規導入店舗等）でもモバイルオーダーが成立する。
-- 本体ロジックは 00013 と同一（税率行のみ変更）。
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
       v_qty, coalesce((select tr.rate from public.tax_rates tr where tr.id = v_menu.tax_rate_id), 10),
       true, (v_menu.price + v_mods_total) * v_qty, nullif(trim(v_item->>'memo'), ''),
       v_mods, 'pending');
    v_count := v_count + 1;
  end loop;

  perform public.recalc_order_totals(v_order.id);

  return jsonb_build_object('ok', true, 'order_id', v_order.id,
    'items_added', v_count, 'table_name', v_table.name);
end $$;

-- 公開QR-RPCは意図どおり anon 実行可（CREATE OR REPLACEで既定権限へ戻るため明示GRANT）
grant execute on function public.create_qr_order(text, text, jsonb) to anon, authenticated;
