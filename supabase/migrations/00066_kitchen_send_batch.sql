-- =============================================================
-- レジ（POS）の注文を「まとめて厨房へ送る」方式にする
--
-- 背景: これまでは商品をタップした瞬間に厨房伝票が出ていた（claim_kitchen_items がポーリング毎に
--       数量差分を確定するため）。押し間違い・数量の直しがそのまま厨房に流れて現場が混乱するので、
--       伝票に品目を貯めて「厨房へオーダー」を押したときだけ厨房へ伝えるようにする。
--
-- 方式: order_items.kitchen_sent_at（厨房へ送った時刻）。null = 未送信。
--       - 既定値は now()（QR注文・伝票分割・再会計など、POS以外の経路はこれまで通り即時に厨房へ）
--       - POS の商品追加だけが null で入れ、「厨房へオーダー」で now() に更新する
--       - claim_kitchen_items は kitchen_sent_at が入っている明細だけを見る
--       - 未送信のまま取消した明細は printed=0 のまま対象外なので、取消伝票も出ない
-- =============================================================

-- null 許可・既定 now()。既存明細は追加時点の時刻で埋まる（＝送信済み扱い。厨房伝票は 00057 の
-- kitchen_printed_qty で管理しているので、これで過去分が出直すことはない）
alter table public.order_items
  add column if not exists kitchen_sent_at timestamptz default now();

comment on column public.order_items.kitchen_sent_at is
  '厨房へ送った時刻。null=未送信（POSで貯めている途中）。既定 now() なのでPOS以外の経路は即時送信';

-- 未送信明細の検索（POSの「未送信 n品」表示・厨房送信の一括更新）
create index if not exists idx_order_items_unsent
  on public.order_items(order_id) where kitchen_sent_at is null;

-- -------------------------------------------------------------
-- claim_kitchen_items: 未送信（kitchen_sent_at is null）の明細を対象外にする。
-- それ以外（差分確定ロジック・戻り値・権限）は 00059 と同じ。戻り値は変わらないが、
-- 同名関数の定義を丸ごと置き換えるため drop → create する。
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
       and oi.kitchen_sent_at is not null
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
