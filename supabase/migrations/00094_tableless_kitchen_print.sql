-- =============================================================
-- 卓なしの伝票（即会計の「メニュー選択」・テイクアウト）の商品も、キッチン・バーのプリンターに出す（2026-10-05）
-- （2026-09-30 Ronnie「ここ（即会計）から入れたものもキッチン・バーに行くように」、2026-10-05「即会計で入れた商品の厨房伝票が出ない」）
--
-- これまで：プリンターにフロアを決めている店（SHUNKA は全部のプリンターが 3F/4F/5F 指定、高田馬場も 1F 指定）では、
--   卓なしの伝票はフロアが無いので、どのプリンターにも出なかった。
-- これから：
--   1) 卓なしの伝票は、レジの「最初に出すフロア」（store_settings.settings.floorBoard.defaultFloorId）の卓と同じ扱い
--   2) それでもどのプリンターにも当たらない明細は、その持ち場（キッチン・ドリンク…）のいちばん最初に登録した
--      プリンターに出す
--   3) 即会計の伝票は、厨房伝票の見出し（卓名）に「即会計」と出す（テイクアウトと区別）
-- 卓のある伝票の出し先は今までと同じ（1・2 は、今まで出ていなかった明細にだけ効く）。
-- 中身は 00093 と同じ（フロアの決め方と卓名だけ変えた）。
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
  v_default_floor uuid;
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
  -- レジの最初のフロア（設定 > テーブル・フロア の「最初に出すフロア」）。卓なしの伝票はこのフロアの扱い
  select case when (ss.settings->'floorBoard'->>'defaultFloorId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (ss.settings->'floorBoard'->>'defaultFloorId')::uuid end
    into v_default_floor
    from public.store_settings ss
   where ss.store_id = v_store;
  return query
  with cand as (
    select oi.id,
           oi.kitchen_printed_qty as printed,
           case when oi.status = 'active' and o.status not in ('cancelled', 'void')
                then oi.quantity else 0 end as eff,
           x.st as st,
           mi.name_en as name_en,
           mi.name_kana as kana
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join public.menu_items mi on mi.id = oi.menu_item_id
      left join public.menu_categories mc on mc.id = mi.category_id
      left join public.restaurant_tables rt on rt.id = o.table_id
      -- 明細のフロア：卓のフロア。卓なし（即会計・テイクアウト）はレジの最初のフロア
      cross join lateral (
        select coalesce(rt.floor_id, case when o.table_id is null then v_default_floor end) as ef,
               coalesce(mc.station, 'kitchen') as st
      ) x
     where oi.store_id = v_store
       and oi.menu_item_id is not null
       and oi.kitchen_sent_at is not null
       and coalesce(o.kitchen_print_enabled, true)
       and greatest(oi.updated_at, o.updated_at) >= now() - make_interval(mins => p_window_minutes)
       and oi.updated_at <= now() - make_interval(secs => p_batch_delay_seconds)
       and x.st = any(v_stations)
       and (
         (cardinality(v_floors) > 0 and x.ef = any(v_floors))
         or (
           cardinality(v_floors) = 0
           and (
             x.ef is null
             or not exists (
               select 1
                 from public.printer_configs p2
                where p2.store_id = v_store
                  and p2.id <> p_printer
                  and p2.usage = 'kitchen'
                  and p2.cloudprnt_enabled
                  and p2.status = 'active'
                  and x.st = any(p2.kitchen_stations)
                  and x.ef = any(p2.floor_ids)
             )
           )
         )
         -- どのプリンターにも当たらない明細（全部のプリンターがフロア指定で、そのフロアのプリンターが無い）は、
         -- その持ち場のいちばん最初に登録したプリンターへ（出ないまま厨房が知らない、を無くす）
         or (
           not exists (
             select 1
               from public.printer_configs p3
              where p3.store_id = v_store
                and p3.usage = 'kitchen'
                and p3.cloudprnt_enabled
                and p3.status = 'active'
                and x.st = any(p3.kitchen_stations)
                and (cardinality(coalesce(p3.floor_ids, '{}'::uuid[])) = 0 or x.ef = any(p3.floor_ids))
           )
           and p_printer = (
             select p4.id
               from public.printer_configs p4
              where p4.store_id = v_store
                and p4.usage = 'kitchen'
                and p4.cloudprnt_enabled
                and p4.status = 'active'
                and x.st = any(p4.kitchen_stations)
              order by p4.created_at, p4.id
              limit 1
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
  -- 卓名：卓なしの即会計の伝票は「即会計」（厨房伝票の見出し。テイクアウトは null のまま → TAKEOUT）
  select oi.id, o.id, o.order_no,
         coalesce(seat.name, rt.name,
                  case when o.table_id is null and o.order_type = 'dine_in' and o.memo like '即会計%' then '即会計' end),
         o.guest_count, o.clerk_name,
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
