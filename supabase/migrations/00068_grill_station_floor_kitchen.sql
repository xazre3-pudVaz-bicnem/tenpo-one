-- =============================================================
-- 焼き場（焼き鳥）ステーション・厨房/ドリンク伝票の担当フロア・ドリンク機から会計伝票
--
-- 背景（SHUNKA 新宿、3フロア）:
--   4F: キッチン機2台（焼き鳥専用＋その他）、ドリンク・バー機、レジ（会計）機
--   3F・5F: ドリンク・バー機 各1台。その階の卓のドリンク伝票と会計伝票をここから出し、
--           会計伝票を持って 4F のレジで会計する。
--
-- 1) ステーション 'grill'（焼き場）を追加。カテゴリを「焼き場」にすると焼き場のプリンターにだけ出る。
-- 2) 厨房プリンターにも担当フロア（00067 の floor_ids）を効かせる（claim_kitchen_items）。
--    同じステーションを複数台で持つとき、卓のフロアで1台に振り分ける。担当フロア無し＝既定。
-- 3) printer_configs.bill_slips: 厨房（ドリンク）機からも会計伝票（中間伝票・QRのお会計伝票）を出す。
-- 既存データはすべて今まで通りの動き（grill 未使用・floor_ids 空・bill_slips false）。
-- =============================================================

-- 00013 で列定義に付けた check（自動命名）を名前に頼らず外す
do $$
declare r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public'
       and rel.relname = 'menu_categories'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%station%'
  loop
    execute format('alter table public.menu_categories drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.menu_categories
  add constraint menu_categories_station_check
  check (station in ('kitchen', 'drink', 'dessert', 'grill'));

alter table public.printer_configs drop constraint if exists printer_configs_kitchen_stations_check;
alter table public.printer_configs
  add constraint printer_configs_kitchen_stations_check
  check (kitchen_stations <@ array['kitchen', 'drink', 'dessert', 'grill']::text[]);

alter table public.printer_configs
  add column if not exists bill_slips boolean not null default false;

comment on column public.printer_configs.bill_slips is
  '厨房（ドリンク）機から会計伝票も出す（担当フロアの卓の中間伝票・QRのお会計伝票）。レシート機は常に出せる';

-- -------------------------------------------------------------
-- claim_kitchen_items: 00066 と同じ＋担当フロアの条件。戻り値・権限は変わらない。
-- -------------------------------------------------------------
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
       and greatest(oi.updated_at, o.updated_at) >= now() - make_interval(mins => p_window_minutes)
       and oi.updated_at <= now() - make_interval(secs => p_batch_delay_seconds)
       and coalesce(mc.station, 'kitchen') = any(v_stations)
       -- 担当フロア: 担当フロアのあるプリンターはそのフロアの卓だけ。
       -- 担当フロアの無いプリンターは、同じステーションを担当する他のプリンターが受け持っていないフロアの卓
       -- （フロア未割当の卓・卓なしの注文を含む）。lib/printer-floors.ts の printerServesFloor と同じ規則。
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
