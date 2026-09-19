-- 厨房伝票を英語で印字するため、claim_kitchen_items が商品の英語名とカナを返すようにする。
-- 表示側は 英語名(name_en) → 無ければカナからローマ字 → それも無ければ日本語、の順で選ぶ。
-- 変更点は返却列 item_name_en / item_name_kana の追加のみ（差分確定ロジックは 00057 と同じ）。
-- 戻り値の型が変わるため drop してから作り直す。
drop function if exists public.claim_kitchen_items(uuid, integer, integer);

create or replace function public.claim_kitchen_items(
  p_printer uuid,
  p_batch_delay_seconds integer default 3,
  p_window_minutes integer default 30
)
returns table (
  order_item_id uuid,
  order_id uuid,
  order_no bigint,
  table_name text,
  guest_count integer,
  clerk_name text,
  item_name text,
  item_name_en text,
  item_name_kana text,
  modifiers jsonb,
  memo text,
  station text,
  delta integer,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_stations text[];
begin
  select pc.store_id, pc.kitchen_stations
    into v_store, v_stations
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
     where oi.store_id = v_store
       and greatest(oi.updated_at, o.updated_at) >= now() - make_interval(mins => p_window_minutes)
       and oi.updated_at <= now() - make_interval(secs => p_batch_delay_seconds)
       and coalesce(mc.station, 'kitchen') = any(v_stations)
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
  select oi.id, o.id, o.order_no, rt.name, o.guest_count, o.clerk_name,
         oi.name, diff.name_en, diff.kana, oi.modifiers, oi.memo, diff.st, diff.d, oi.updated_at
    from diff
    join upd on upd.id = diff.id
    join public.order_items oi on oi.id = diff.id
    join public.orders o on o.id = oi.order_id
    left join public.restaurant_tables rt on rt.id = o.table_id
   order by o.order_no, oi.created_at;
end $$;

-- プリンタのエンドポイント（サービスロール）からのみ呼ぶ
revoke all on function public.claim_kitchen_items(uuid, integer, integer) from public;
revoke all on function public.claim_kitchen_items(uuid, integer, integer) from anon, authenticated;
grant execute on function public.claim_kitchen_items(uuid, integer, integer) to service_role;
