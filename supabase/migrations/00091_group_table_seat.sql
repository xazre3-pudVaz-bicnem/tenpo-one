-- =============================================================
-- テーブルグループの厨房伝票に「注文した卓」の番号を出す
-- （2026-09-29 FULL MOoN 御茶ノ水「テーブルをグループでまとめると、最初に注文を入れた卓の番号で
--   オーダーが出る。まとめた卓でも番号が分かれて出てほしい。全部同じ卓の番号だとスタッフが困る」）
--
-- グループの卓はどれも同じ伝票（orders.table_id は最初に伝票が立った卓）なので、
-- 厨房伝票の卓名はいつもその卓になっていた（T-2〜T-5 の QR 注文も T-1 で出る）。
--
--   order_items.ordered_table_id … その品を注文した卓（グループの別の卓から入れたときだけ入る。NULL＝伝票の卓）
--   create_qr_order_at_seat(slug, token, items, seat_token)
--       … QR を開いた卓（seat_token）が伝票の卓と同じグループなら、入れた品にその卓を残す。
--         中身は create_qr_order をそのまま呼ぶ（値段・在庫・時間の判定は同じ）
--   claim_kitchen_items … 卓名は ordered_table_id があればその卓、無ければ伝票の卓
-- =============================================================

alter table public.order_items
  add column if not exists ordered_table_id uuid references public.restaurant_tables(id) on delete set null;

comment on column public.order_items.ordered_table_id is
  'テーブルグループで、伝票の卓とは別の卓から注文した品の卓（厨房伝票の卓名に使う）。NULL は伝票の卓';

create or replace function public.create_qr_order_at_seat(p_slug text, p_token text, p_items jsonb, p_seat_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_host_table uuid;
  v_host_store uuid;
  v_seat_id uuid;
  v_seat_name text;
begin
  v_result := public.create_qr_order(p_slug, p_token, p_items);
  v_order_id := (v_result->>'order_id')::uuid;
  if v_order_id is null or p_seat_token is null or p_seat_token = p_token then
    return v_result;
  end if;

  select o.table_id, o.store_id into v_host_table, v_host_store
    from public.orders o where o.id = v_order_id;

  select t.id, t.name into v_seat_id, v_seat_name
    from public.restaurant_tables t
    join public.stores s on s.id = t.store_id
   where t.qr_token = p_seat_token and s.slug = p_slug and t.status = 'active'
     and t.store_id = v_host_store;

  -- 同じグループの卓のときだけ（店舗設定 store_settings.settings.tableGroups）
  if v_seat_id is null or v_host_table is null or v_seat_id = v_host_table
     or not exists (
       select 1
         from public.store_settings ss,
              jsonb_array_elements(
                case when jsonb_typeof(ss.settings->'tableGroups') = 'array'
                     then ss.settings->'tableGroups' else '[]'::jsonb end) g
        where ss.store_id = v_host_store
          and jsonb_typeof(g->'tableIds') = 'array'
          and g->'tableIds' ? v_seat_id::text
          and g->'tableIds' ? v_host_table::text
     ) then
    return v_result;
  end if;

  -- この呼び出しで入れた品（同じトランザクションなので created_at = now()）
  update public.order_items
     set ordered_table_id = v_seat_id
   where order_id = v_order_id
     and created_at = now()
     and ordered_table_id is null;

  return v_result || jsonb_build_object('table_name', v_seat_name);
end $$;

grant execute on function public.create_qr_order_at_seat(text, text, jsonb, text) to anon, authenticated, service_role;

-- 厨房伝票の卓名：注文した卓（グループの別の卓）があればその卓
create or replace function public.claim_kitchen_items(p_printer uuid, p_batch_delay_seconds integer default 3, p_window_minutes integer default 30)
returns table(order_item_id uuid, order_id uuid, order_no bigint, table_name text, guest_count integer, clerk_name text,
              item_name text, item_name_en text, item_name_kana text, modifiers jsonb, memo text, station text,
              delta integer, changed_at timestamp with time zone)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_store uuid;
  v_stations text[];
  v_floors uuid[];
begin
  select pc.store_id, pc.kitchen_stations, coalesce(pc.floor_ids, '{}'::uuid[])
    into v_store, v_stations, v_floors
    from public.printer_configs pc
   where pc.id = p_printer
     and pc.usage = 'kitchen'
     and pc.cloudprnt_enabled
     and pc.status = 'active';
  if v_store is null then
    return;
  end if;
  return query
  with cand as (
    select oi.id,
           oi.kitchen_printed_qty as printed,
           case when oi.status = 'active' and o.status not in ('cancelled', 'void')
                then oi.quantity else 0 end as eff,
           coalesce(mc.station, 'kitchen') as st,
           mi.name_en as name_en,
           mi.name_kana as kana
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join public.menu_items mi on mi.id = oi.menu_item_id
      left join public.menu_categories mc on mc.id = mi.category_id
      left join public.restaurant_tables rt on rt.id = o.table_id
     where oi.store_id = v_store
       and oi.kitchen_sent_at is not null
       and coalesce(o.kitchen_print_enabled, true)
       and greatest(oi.updated_at, o.updated_at) >= now() - make_interval(mins => p_window_minutes)
       and oi.updated_at <= now() - make_interval(secs => p_batch_delay_seconds)
       and coalesce(mc.station, 'kitchen') = any(v_stations)
       and (
         (cardinality(v_floors) > 0 and rt.floor_id = any(v_floors))
         or (
           cardinality(v_floors) = 0
           and (
             rt.floor_id is null
             or not exists (
               select 1
                 from public.printer_configs p2
                where p2.store_id = v_store
                  and p2.id <> p_printer
                  and p2.usage = 'kitchen'
                  and p2.cloudprnt_enabled
                  and p2.status = 'active'
                  and coalesce(mc.station, 'kitchen') = any(p2.kitchen_stations)
                  and rt.floor_id = any(p2.floor_ids)
             )
           )
         )
       )
     for update of oi skip locked
  ),
  diff as (
    select c.id, c.eff, c.eff - c.printed as d, c.st, c.name_en, c.kana
      from cand c
     where c.eff <> c.printed
  ),
  upd as (
    update public.order_items oi
       set kitchen_printed_qty = diff.eff
      from diff
     where oi.id = diff.id
    returning oi.id
  )
  select oi.id, o.id, o.order_no, coalesce(seat.name, rt.name), o.guest_count, o.clerk_name,
         oi.name, diff.name_en, diff.kana, oi.modifiers, oi.memo, diff.st, diff.d, oi.updated_at
    from diff
    join upd on upd.id = diff.id
    join public.order_items oi on oi.id = diff.id
    join public.orders o on o.id = oi.order_id
    left join public.restaurant_tables rt on rt.id = o.table_id
    left join public.restaurant_tables seat on seat.id = oi.ordered_table_id
   order by o.order_no, oi.created_at;
end $function$;

revoke execute on function public.claim_kitchen_items(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_kitchen_items(uuid, integer, integer) to service_role;
