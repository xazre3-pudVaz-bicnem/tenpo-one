-- =============================================================
-- 即会計（電卓で入れた金額）の明細は厨房伝票に出さない（2026-09-30）
--
-- 即会計は、手書き伝票の合計などの金額を「メニューに無い明細」（menu_item_id なし）として伝票に入れる。
-- 入れるときに「送信済み・印刷済み」にしているので会計で厨房に出ることは無いが、あとで取り消したときに
-- 取消の厨房伝票が出ないよう、claim_kitchen_items はメニューの商品（menu_item_id あり）だけを見る。
-- 中身は 00091 と同じ（条件を1つ足しただけ）。
-- =============================================================

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
       and oi.menu_item_id is not null
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
