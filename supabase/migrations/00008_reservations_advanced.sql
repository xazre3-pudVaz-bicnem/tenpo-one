-- =============================================================
-- TENPO ONE — 00008 PHASE 1: 予約管理の本格化
-- ステータス拡張（来店待ち/来店/会計待ち）・担当者・貸切設定
-- 貸切予約は空席判定で全容量をブロックする
-- =============================================================

-- ステータス拡張:
-- pending(仮予約) confirmed(予約確定) waiting(来店待ち) arrived(来店)
-- seated(着席) billing(会計待ち) completed(会計済み)
-- cancelled(キャンセル) no_show(無断キャンセル) waitlisted(キャンセル待ち)
alter table public.reservations drop constraint reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check (status in ('pending','confirmed','waiting','arrived','seated','billing',
                    'completed','cancelled','no_show','waitlisted'));

-- 担当者・貸切
alter table public.reservations
  add column staff_id uuid references public.profiles(id),
  add column is_private_hire boolean not null default false;
create index idx_reservations_staff on public.reservations(staff_id);

-- 空席判定を更新: 新ステータスを占有扱いに含め、貸切予約は全容量ブロック
create or replace function public.get_booking_availability(
  p_slug text, p_date date, p_party integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_settings public.store_settings%rowtype;
  v_bh public.business_hours%rowtype;
  v_capacity integer;
  v_slots jsonb := '[]'::jsonb;
  v_slot time;
  v_last time;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_used integer;
  v_private integer;
  v_stay integer;
  v_cutoff timestamptz;
begin
  select * into v_store from public.stores
  where slug = p_slug and status = 'active' and booking_enabled;
  if not found then return null; end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;

  if p_date < (now() at time zone 'Asia/Tokyo')::date
     or p_date > (now() at time zone 'Asia/Tokyo')::date + coalesce(v_settings.booking_window_days, 90) then
    return '[]'::jsonb;
  end if;

  if exists (select 1 from public.holidays where store_id = v_store.id and holiday_date = p_date) then
    return '[]'::jsonb;
  end if;

  select * into v_bh from public.business_hours
  where store_id = v_store.id and day_of_week = extract(dow from p_date)::int;
  if not found or v_bh.is_closed or v_bh.open_time is null then
    return '[]'::jsonb;
  end if;

  select coalesce(sum(capacity_max), 0) into v_capacity
  from public.restaurant_tables
  where store_id = v_store.id and status = 'active'
    and current_status <> 'unavailable';
  if v_capacity <= 0 or p_party > v_capacity then
    return '[]'::jsonb;
  end if;

  v_stay := coalesce(v_settings.default_stay_minutes, 120);
  v_last := coalesce(v_bh.last_entry_time, v_bh.close_time - interval '60 minutes');
  v_cutoff := now() + make_interval(mins => coalesce(v_settings.booking_cutoff_minutes, 120));

  v_slot := v_bh.open_time;
  while v_slot <= v_last loop
    v_slot_start := (p_date::text || ' ' || v_slot::text)::timestamp at time zone 'Asia/Tokyo';
    v_slot_end := v_slot_start + make_interval(mins => v_stay);

    if v_slot_start >= v_cutoff then
      -- 貸切予約が重複する時間帯は満席扱い
      select count(*) into v_private
      from public.reservations
      where store_id = v_store.id
        and is_private_hire
        and status in ('pending','confirmed','waiting','arrived','seated','billing')
        and start_at < v_slot_end and end_at > v_slot_start;

      if v_private > 0 then
        v_slots := v_slots || jsonb_build_object(
          'time', to_char(v_slot, 'HH24:MI'), 'available', false);
      else
        select coalesce(sum(party_size), 0) into v_used
        from public.reservations
        where store_id = v_store.id
          and status in ('pending','confirmed','waiting','arrived','seated','billing')
          and start_at < v_slot_end and end_at > v_slot_start;

        v_slots := v_slots || jsonb_build_object(
          'time', to_char(v_slot, 'HH24:MI'),
          'available', (v_used + p_party) <= v_capacity);
      end if;
    else
      v_slots := v_slots || jsonb_build_object(
        'time', to_char(v_slot, 'HH24:MI'), 'available', false);
    end if;

    v_slot := v_slot + make_interval(mins => coalesce(v_settings.slot_minutes, 30));
  end loop;

  return v_slots;
end $$;

-- finalize_order を再定義: 予約連動を新ステータス（waiting/arrived/billing含む）へ対応
create or replace function public.finalize_order(
  p_order_id uuid,
  p_payments jsonb,
  p_register_session_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_pay jsonb;
  v_sum integer := 0;
  v_cash integer := 0;
  v_method text;
  v_amount integer;
  v_tendered integer;
  v_change integer;
  v_bd date := (now() at time zone 'Asia/Tokyo')::date;
  v_inv record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'open' then raise exception 'ORDER_NOT_OPEN'; end if;
  if not public.app_has_store_access(v_order.organization_id, v_order.store_id) then
    raise exception 'FORBIDDEN';
  end if;

  perform public.recalc_order_totals(p_order_id);
  select * into v_order from public.orders where id = p_order_id;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_sum := v_sum + (v_pay->>'amount')::integer;
  end loop;
  if v_sum <> v_order.total then
    raise exception 'PAYMENT_MISMATCH: total=% payments=%', v_order.total, v_sum;
  end if;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_method := v_pay->>'method';
    v_amount := (v_pay->>'amount')::integer;
    v_tendered := nullif(v_pay->>'tendered','')::integer;
    v_change := case when v_method = 'cash' and v_tendered is not null
                     then greatest(0, v_tendered - v_amount) else null end;

    insert into public.payments
      (organization_id, store_id, order_id, register_session_id, method, amount,
       tendered, change_amount, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, p_order_id, p_register_session_id,
       v_method, v_amount, v_tendered, v_change, v_bd, auth.uid());

    if v_method = 'cash' then
      v_cash := v_cash + v_amount;
    end if;
  end loop;

  if v_cash > 0 and p_register_session_id is not null then
    insert into public.cash_transactions
      (organization_id, store_id, register_session_id, kind, amount, purpose,
       order_id, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, p_register_session_id, 'sale', v_cash,
       '売上（注文 #' || v_order.order_no || '）', p_order_id, v_bd, auth.uid());
  end if;

  update public.orders
  set status = 'paid', closed_at = now(), business_date = v_bd,
      register_session_id = coalesce(p_register_session_id, register_session_id),
      updated_by = auth.uid()
  where id = p_order_id;

  if v_order.customer_id is not null then
    update public.customers
    set visit_count = visit_count + 1,
        total_spent = total_spent + v_order.total,
        last_visit_at = now(),
        first_visit_at = coalesce(first_visit_at, now())
    where id = v_order.customer_id;
  end if;

  -- 予約連動（PHASE 1: waiting/arrived/billing も completed へ）
  if v_order.reservation_id is not null then
    update public.reservations set status = 'completed'
    where id = v_order.reservation_id
      and status in ('confirmed','waiting','arrived','seated','billing');
  end if;

  if v_order.table_id is not null then
    update public.restaurant_tables set current_status = 'cleaning'
    where id = v_order.table_id;
  end if;

  for v_inv in
    select ii.id as inventory_item_id, oi.quantity
    from public.order_items oi
    join public.inventory_items ii
      on ii.menu_item_id = oi.menu_item_id and ii.store_id = v_order.store_id and ii.status = 'active'
    where oi.order_id = p_order_id and oi.status = 'active' and oi.menu_item_id is not null
  loop
    insert into public.stock_movements
      (organization_id, store_id, inventory_item_id, movement_type, quantity,
       ref_order_id, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, v_inv.inventory_item_id, 'sale',
       -v_inv.quantity, p_order_id, v_bd, auth.uid());
    update public.inventory_items
    set current_quantity = current_quantity - v_inv.quantity
    where id = v_inv.inventory_item_id;
  end loop;

  perform public.log_audit(v_order.organization_id, v_order.store_id, 'order.finalize',
    'orders', p_order_id::text, null,
    jsonb_build_object('total', v_order.total, 'payments', p_payments), null);

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'total', v_order.total);
end $$;
