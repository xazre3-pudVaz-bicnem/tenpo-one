-- =============================================================
-- お客様QR の選択肢グループを、設定 > メニュー選択肢 の「上へ・下へ」（menu_option_groups.sort_order）の順で出す
-- （2026-10-17 Ronnie「順番は店で決める。カレー → 辛さ → ナン/ライス → 飲み物」。レジ・ハンディ・厨房伝票と同じ順）
--
-- 00097 は紐付け（menu_item_option_groups.sort_order＝グループの中での商品の順番）を先に見ていたため、
-- 店が決めた順にならなかった。get_qr_menu の option_groups と、create_qr_order が明細に残す選択肢の並びを
-- グループの sort_order → 紐付けの順 に直す。それ以外のロジックは 00097 と同じ。
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
        'id', mc.id, 'name', mc.name, 'name_en', mc.name_en, 'color', mc.color,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', mi.id, 'name', mi.name, 'name_en', mi.name_en, 'description', mi.description,
            'price', mi.price, 'is_sold_out', mi.is_sold_out,
            'is_recommended', mi.is_recommended,
            'allergy_info', mi.allergy_info,
            'image_path', mi.image_path,
            'modifiers', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', mm.id, 'name', mm.name, 'price', mm.price) order by mm.sort_order), '[]'::jsonb)
              from public.menu_item_modifiers mim
              join public.menu_modifiers mm on mm.id = mim.modifier_id and mm.status = 'active'
              where mim.menu_item_id = mi.id),
            -- 選択肢グループ（レジ・ハンディと同じ 設定 > メニュー選択肢。必須・最小/最大・英語名・追加料金）
            'option_groups', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', g.id, 'name', g.name, 'is_required', g.is_required,
                'min_select', g.min_select, 'max_select', g.max_select,
                'items', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'id', oi.id, 'name', oi.name, 'name_en', oi.name_en, 'price', oi.price)
                    order by oi.sort_order, oi.name), '[]'::jsonb)
                  from public.menu_option_items oi
                  where oi.group_id = g.id and oi.status = 'active')
              ) order by g.sort_order, l.sort_order, g.name), '[]'::jsonb)
              from public.menu_item_option_groups l
              join public.menu_option_groups g on g.id = l.group_id and g.status = 'active'
              where l.menu_item_id = mi.id))
            order by mi.is_recommended desc, mi.sort_order), '[]'::jsonb)
          from public.menu_items mi
          where mi.category_id = mc.id
            and mi.organization_id = v_store.organization_id
            and (mi.store_id is null or mi.store_id = v_store.id)
            and mi.status = 'active'
            and mi.item_type in ('food','drink')
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


grant execute on function public.get_qr_menu(text, text) to anon, authenticated;

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
  v_price integer;
  v_opt_ids uuid[];
  v_opts jsonb;
  v_opts_total integer;
  v_opt_n integer;
  v_grp record;
  v_unit integer;
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

    -- 選択肢グループ（レジ・ハンディと同じ menu_option_groups。2026-10-17 Ronnie「QR にもレジと同じ選択肢を」）。
    -- 必須・最小/最大を確かめ、名前・英語名・追加料金をスナップショット。追加料金は単価に足す（レジの addItem と同じ）
    v_opt_ids := coalesce(
      (select array_agg(distinct x::uuid) from jsonb_array_elements_text(coalesce(v_item->'option_item_ids', '[]'::jsonb)) x),
      '{}');
    if array_length(v_opt_ids, 1) > 12 then raise exception 'TOO_MANY_MODIFIERS'; end if;

    for v_grp in
      select g.id, g.is_required, g.min_select, g.max_select
      from public.menu_item_option_groups l
      join public.menu_option_groups g on g.id = l.group_id and g.status = 'active'
      where l.menu_item_id = v_menu.id
    loop
      select count(*) into v_opt_n from public.menu_option_items oi
      where oi.group_id = v_grp.id and oi.status = 'active' and oi.id = any(v_opt_ids);
      if v_opt_n < (case when v_grp.is_required then greatest(1, v_grp.min_select) else v_grp.min_select end) then
        raise exception 'OPTION_REQUIRED';
      end if;
      if v_opt_n > v_grp.max_select then raise exception 'INVALID_MODIFIER'; end if;
    end loop;

    select coalesce(jsonb_agg(
             case when oi.name_en is not null and btrim(oi.name_en) <> '' and btrim(oi.name_en) <> btrim(oi.name)
                  then jsonb_build_object('name', oi.name, 'name_en', btrim(oi.name_en), 'price', oi.price)
                  else jsonb_build_object('name', oi.name, 'price', oi.price) end
             order by g.sort_order, l.sort_order, oi.sort_order, oi.name), '[]'::jsonb),
           coalesce(sum(oi.price), 0)::integer,
           count(*)
    into v_opts, v_opts_total, v_opt_n
    from public.menu_option_items oi
    join public.menu_item_option_groups l on l.group_id = oi.group_id and l.menu_item_id = v_menu.id
    join public.menu_option_groups g on g.id = oi.group_id
    where oi.id = any(v_opt_ids) and oi.status = 'active';
    if v_opt_n <> coalesce(array_length(v_opt_ids, 1), 0) then raise exception 'INVALID_MODIFIER'; end if;

    -- ダイナミックプライシング（曜日・時間帯の値段。レジ・ハンディの lib/dynamic-pricing.ts と同じ計算）
    v_price := public.dynamic_menu_price(v_store.id, v_menu.id, v_menu.category_id, v_menu.item_type, v_menu.price, now());
    v_unit := v_price + v_opts_total;

    insert into public.order_items
      (organization_id, store_id, order_id, menu_item_id, name, unit_price, quantity,
       tax_rate, tax_included, line_total, memo, modifiers, kitchen_status)
    values
      (v_store.organization_id, v_store.id, v_order.id, v_menu.id, v_menu.name, v_unit,
       v_qty, coalesce((select tr.rate from public.tax_rates tr where tr.id = v_menu.tax_rate_id), 10),
       true, (v_unit + v_mods_total) * v_qty, nullif(trim(v_item->>'memo'), ''),
       v_opts || v_mods, 'pending');
    v_count := v_count + 1;
  end loop;

  perform public.recalc_order_totals(v_order.id);

  return jsonb_build_object('ok', true, 'order_id', v_order.id,
    'items_added', v_count, 'table_name', v_table.name);
end $$;


-- 公開QR-RPCは意図どおり anon 実行可（CREATE OR REPLACEで既定権限へ戻るため明示GRANT）
grant execute on function public.create_qr_order(text, text, jsonb) to anon, authenticated;
