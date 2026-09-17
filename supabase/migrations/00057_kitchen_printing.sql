-- =============================================================
-- キッチンプリンター（CloudPRNT）で厨房伝票を印刷する
--
-- 方式: 明細ごとに「厨房へ伝えた数量」(kitchen_printed_qty) を持ち、
--       現在の有効数量との差分だけを伝票にする。
--         新規追加        … 0 → 2       ⇒ 「2」を印字
--         数量を増やした  … 2 → 3       ⇒ 「追加 +1」
--         取消・注文取消  … 3 → 0       ⇒ 「取消 -3」
--       プリンタがポーリングした時点で差分を確定（claim）し、伝票ジョブにする。
--       端末（iPad等）が起動していなくても、QR注文の伝票がプリンタから出る。
--
-- 既存明細は「伝達済み」として埋めておく（有効化した瞬間に過去の注文が全部出ないように）。
-- =============================================================

-- プリンタが担当する厨房ステーション（menu_categories.station と対応）
alter table public.printer_configs
  add column if not exists kitchen_stations text[] not null default array['kitchen']::text[];

alter table public.printer_configs drop constraint if exists printer_configs_kitchen_stations_check;
alter table public.printer_configs
  add constraint printer_configs_kitchen_stations_check
  check (kitchen_stations <@ array['kitchen', 'drink', 'dessert']::text[]);

-- 厨房へ伝えた数量
alter table public.order_items
  add column if not exists kitchen_printed_qty integer not null default 0;

-- 既存明細は伝達済みにする（有効な明細＝現数量、取消済み＝0）
-- 過去明細の updated_at を書き換えないよう、この更新の間だけ自動更新トリガーを止める
alter table public.order_items disable trigger trg_order_items_updated_at;
update public.order_items oi
   set kitchen_printed_qty = case
         when oi.status = 'active' and o.status not in ('cancelled', 'void') then oi.quantity
         else 0
       end
  from public.orders o
 where o.id = oi.order_id;
alter table public.order_items enable trigger trg_order_items_updated_at;

-- ポーリング時の差分検出（店舗×更新時刻）
create index if not exists idx_order_items_store_updated on public.order_items(store_id, updated_at);

-- -------------------------------------------------------------
-- 伝票にする差分を確定して返す（ポーリング毎に呼ぶ・サービスロール専用）
--   p_batch_delay_seconds: 直近この秒数以内に変わった明細は待つ（連続タップを1枚にまとめる）
--   p_window_minutes     : これより古い変更は印刷しない（オフライン後に昔の伝票が出ないように）
-- 同じ明細を2回確定しないよう行ロック（SKIP LOCKED）を取ってから数量を更新する。
-- -------------------------------------------------------------
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
           coalesce(mc.station, 'kitchen') as st
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
    select c.id, c.eff, c.eff - c.printed as d, c.st
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
         oi.name, oi.modifiers, oi.memo, diff.st, diff.d, oi.updated_at
    from diff
    join upd on upd.id = diff.id
    join public.order_items oi on oi.id = diff.id
    join public.orders o on o.id = oi.order_id
    left join public.restaurant_tables rt on rt.id = o.table_id
   order by o.order_no, oi.created_at;
end $$;

-- プリンタのエンドポイント（サービスロール）からのみ呼ぶ
revoke all on function public.claim_kitchen_items(uuid, integer, integer) from public;
grant execute on function public.claim_kitchen_items(uuid, integer, integer) to service_role;
