-- =============================================================
-- ダイナミックプライシング（2026-09-23。全店舗共通）
--
-- 曜日・時間帯で商品の値段を自動で変える（ハッピーアワー・深夜料金など）。
-- 設定は store_settings.settings.dynamicPricing.rules（JSON。テーブル・列の追加なし）。
-- 上から順に見て、最初に当てはまった有効なルールを使う。計算は lib/dynamic-pricing.ts と同じ。
--
-- 1) public.dynamic_menu_price: 店舗・商品・その時刻の値段
-- 2) create_qr_order: お客様QRの注文に 1) の値段を使う（00043 と同じ本体で、単価の行だけ変更）
-- ルールが無い店舗は今まで通りの値段。
-- =============================================================

create or replace function public.dynamic_menu_price(
  p_store uuid,
  p_item_id uuid,
  p_category_id uuid,
  p_item_type text,
  p_price integer,
  p_at timestamptz default now()
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rules jsonb;
  r jsonb;
  v_local timestamp := p_at at time zone 'Asia/Tokyo';
  v_min integer := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_dow integer := extract(dow from v_local)::integer;
  s integer;
  e integer;
  d integer;
  v_target text;
  v_kind text;
  v_val integer;
  v_round boolean;
  v_days jsonb;
  n numeric;
  v_next integer;
begin
  select ss.settings -> 'dynamicPricing' -> 'rules' into v_rules
    from public.store_settings ss
   where ss.store_id = p_store;
  if v_rules is null or jsonb_typeof(v_rules) <> 'array' then
    return p_price;
  end if;

  for r in select value from jsonb_array_elements(v_rules) loop
    begin
      if coalesce((r ->> 'enabled')::boolean, true) = false then
        continue;
      end if;

      -- 対象の商品
      v_target := r ->> 'target';
      if v_target = 'all' then
        if coalesce(p_item_type, '') not in ('food', 'drink') then continue; end if;
      elsif v_target = 'categories' then
        if p_category_id is null or not (coalesce(r -> 'categoryIds', '[]'::jsonb) ? p_category_id::text) then continue; end if;
      elsif v_target = 'items' then
        if not (coalesce(r -> 'itemIds', '[]'::jsonb) ? p_item_id::text) then continue; end if;
      else
        continue;
      end if;

      -- 時間帯（start = end は終日、end < start は日またぎ。日またぎの 0 時以降は前日の曜日）
      s := split_part(r ->> 'start', ':', 1)::integer * 60 + split_part(r ->> 'start', ':', 2)::integer;
      e := split_part(r ->> 'end', ':', 1)::integer * 60 + split_part(r ->> 'end', ':', 2)::integer;
      d := v_dow;
      if s = e then
        null;
      elsif s < e then
        if v_min < s or v_min >= e then continue; end if;
      else
        if v_min >= e and v_min < s then continue; end if;
        if v_min < e then d := (v_dow + 6) % 7; end if;
      end if;

      -- 曜日（空は毎日）
      v_days := coalesce(r -> 'days', '[]'::jsonb);
      if jsonb_typeof(v_days) = 'array' and jsonb_array_length(v_days) > 0
         and not exists (select 1 from jsonb_array_elements_text(v_days) x where x::integer = d) then
        continue;
      end if;

      -- 値段
      v_kind := r ->> 'kind';
      v_val := (r ->> 'value')::integer;
      v_round := coalesce((r ->> 'roundTo10')::boolean, false);
      if v_kind = 'fixed' then
        if v_val < 0 then continue; end if;
        v_next := v_val;
      elsif v_kind = 'amount' then
        v_next := p_price + v_val;
      elsif v_kind = 'percent' then
        if v_val <= -100 or v_val > 1000 then continue; end if;
        n := p_price::numeric * (100 + v_val);
        if v_round then
          v_next := (round(n / 1000) * 10)::integer;
        else
          v_next := round(n / 100)::integer;
        end if;
      else
        continue;
      end if;
      if v_round and v_kind <> 'percent' then
        v_next := (round(v_next::numeric / 10) * 10)::integer;
      end if;
      return greatest(0, least(10000000, v_next));
    exception when others then
      -- 壊れたルールは飛ばす（注文は止めない）
      continue;
    end;
  end loop;

  return p_price;
end $$;

revoke all on function public.dynamic_menu_price(uuid, uuid, uuid, text, integer, timestamptz) from public;
revoke all on function public.dynamic_menu_price(uuid, uuid, uuid, text, integer, timestamptz) from anon, authenticated;

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

    -- ダイナミックプライシング（曜日・時間帯の値段。レジ・ハンディの lib/dynamic-pricing.ts と同じ計算）
    v_price := public.dynamic_menu_price(v_store.id, v_menu.id, v_menu.category_id, v_menu.item_type, v_menu.price, now());

    insert into public.order_items
      (organization_id, store_id, order_id, menu_item_id, name, unit_price, quantity,
       tax_rate, tax_included, line_total, memo, modifiers, kitchen_status)
    values
      (v_store.organization_id, v_store.id, v_order.id, v_menu.id, v_menu.name, v_price,
       v_qty, coalesce((select tr.rate from public.tax_rates tr where tr.id = v_menu.tax_rate_id), 10),
       true, (v_price + v_mods_total) * v_qty, nullif(trim(v_item->>'memo'), ''),
       v_mods, 'pending');
    v_count := v_count + 1;
  end loop;

  perform public.recalc_order_totals(v_order.id);

  return jsonb_build_object('ok', true, 'order_id', v_order.id,
    'items_added', v_count, 'table_name', v_table.name);
end $$;

-- 公開QR-RPCは意図どおり anon 実行可（CREATE OR REPLACEで既定権限へ戻るため明示GRANT）
grant execute on function public.create_qr_order(text, text, jsonb) to anon, authenticated;
