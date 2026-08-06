-- =============================================================
-- TENPO ONE — 00002 functions
-- RLSヘルパー / 公開予約RPC / 会計確定 / レジ締め / 勤怠 / 監査
-- =============================================================

-- -------------------------------------------------------------
-- RLSヘルパー（SECURITY DEFINER・STABLE）
-- -------------------------------------------------------------

create or replace function public.app_is_cypress_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_cypress_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.app_is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where profile_id = auth.uid() and organization_id = p_org and status = 'active');
$$;

create or replace function public.app_role(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.memberships
  where profile_id = auth.uid() and organization_id = p_org and status = 'active'
  limit 1;
$$;

create or replace function public.app_role_in(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where profile_id = auth.uid() and organization_id = p_org
      and status = 'active' and role = any(p_roles));
$$;

-- 店舗アクセス: HQ系は全店 / 店舗系は membership_stores 登録店のみ
create or replace function public.app_has_store_access(p_org uuid, p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_store is null then public.app_is_org_member(p_org)
    when public.app_role_in(p_org, array['org_owner','hq_admin','hq_accounting','external_accountant'])
      then true
    else exists (
      select 1
      from public.memberships m
      join public.membership_stores ms on ms.membership_id = m.id
      where m.profile_id = auth.uid() and m.organization_id = p_org
        and m.status = 'active' and ms.store_id = p_store)
  end;
$$;

create or replace function public.app_can_view_payroll(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role_in(p_org, array['org_owner','hq_admin','hq_accounting','external_accountant']);
$$;

create or replace function public.app_can_view_customer_pii(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role_in(p_org, array
    ['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff']);
$$;

-- -------------------------------------------------------------
-- 監査ログ
-- -------------------------------------------------------------

create or replace function public.log_audit(
  p_org uuid, p_store uuid, p_action text,
  p_target_table text, p_target_id text,
  p_before jsonb default null, p_after jsonb default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.audit_logs
    (organization_id, store_id, actor_id, actor_role, action, target_table, target_id,
     before_data, after_data, note)
  values
    (p_org, p_store, auth.uid(),
     coalesce(public.app_role(p_org), case when public.app_is_cypress_admin() then 'cypress_admin' end),
     p_action, p_target_table, p_target_id, p_before, p_after, p_note)
  returning id into v_id;
  return v_id;
end $$;

-- -------------------------------------------------------------
-- 公開予約（anon から呼ぶRPC群）
-- -------------------------------------------------------------

-- 店舗の予約ページ表示情報
create or replace function public.get_booking_store(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_settings public.store_settings%rowtype;
begin
  select * into v_store from public.stores
  where slug = p_slug and status = 'active' and booking_enabled;
  if not found then return null; end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;

  return jsonb_build_object(
    'id', v_store.id,
    'slug', v_store.slug,
    'name', v_store.name,
    'address', v_store.address,
    'phone', v_store.phone,
    'description', v_store.description,
    'max_party_size', coalesce(v_settings.max_party_size, 12),
    'booking_window_days', coalesce(v_settings.booking_window_days, 90),
    'slot_minutes', coalesce(v_settings.slot_minutes, 30),
    'cancel_deadline_hours', coalesce(v_settings.cancel_deadline_hours, 24),
    'business_hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day_of_week', bh.day_of_week, 'is_closed', bh.is_closed,
        'open_time', bh.open_time, 'close_time', bh.close_time,
        'last_entry_time', bh.last_entry_time) order by bh.day_of_week), '[]'::jsonb)
      from public.business_hours bh where bh.store_id = v_store.id),
    'courses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mi.id, 'name', mi.name, 'price', mi.price,
        'description', mi.description, 'duration_minutes', mi.duration_minutes)
        order by mi.sort_order), '[]'::jsonb)
      from public.menu_items mi
      where mi.organization_id = v_store.organization_id
        and (mi.store_id is null or mi.store_id = v_store.id)
        and mi.item_type = 'course' and mi.status = 'active' and not mi.is_sold_out)
  );
end $$;

-- 指定日の空席スロット判定
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
  v_stay integer;
  v_cutoff timestamptz;
begin
  select * into v_store from public.stores
  where slug = p_slug and status = 'active' and booking_enabled;
  if not found then return null; end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;

  -- 受付期間チェック
  if p_date < (now() at time zone 'Asia/Tokyo')::date
     or p_date > (now() at time zone 'Asia/Tokyo')::date + coalesce(v_settings.booking_window_days, 90) then
    return '[]'::jsonb;
  end if;

  -- 休業日
  if exists (select 1 from public.holidays where store_id = v_store.id and holiday_date = p_date) then
    return '[]'::jsonb;
  end if;

  select * into v_bh from public.business_hours
  where store_id = v_store.id and day_of_week = extract(dow from p_date)::int;
  if not found or v_bh.is_closed or v_bh.open_time is null then
    return '[]'::jsonb;
  end if;

  -- 総収容能力（利用可能テーブルの最大席数合計）
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
      select coalesce(sum(party_size), 0) into v_used
      from public.reservations
      where store_id = v_store.id
        and status in ('pending','confirmed','seated')
        and start_at < v_slot_end and end_at > v_slot_start;

      v_slots := v_slots || jsonb_build_object(
        'time', to_char(v_slot, 'HH24:MI'),
        'available', (v_used + p_party) <= v_capacity);
    else
      v_slots := v_slots || jsonb_build_object(
        'time', to_char(v_slot, 'HH24:MI'), 'available', false);
    end if;

    v_slot := v_slot + make_interval(mins => coalesce(v_settings.slot_minutes, 30));
  end loop;

  return v_slots;
end $$;

-- 予約コード生成
create or replace function public.generate_reservation_code()
returns text language sql volatile as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' ||
               substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
$$;

-- 公開予約の作成
create or replace function public.create_public_reservation(
  p_slug text, p_date date, p_time text, p_party integer,
  p_adults integer, p_children integer,
  p_name text, p_kana text, p_phone text, p_email text,
  p_course_id uuid default null, p_seat_type text default null, p_purpose text default null,
  p_allergy text default null, p_request text default null,
  p_source_code text default 'web', p_consent boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_settings public.store_settings%rowtype;
  v_customer_id uuid;
  v_code text;
  v_start timestamptz;
  v_end timestamptz;
  v_stay integer;
  v_avail jsonb;
  v_slot jsonb;
  v_ok boolean := false;
  v_res_id uuid;
  v_source_id uuid;
  v_recent integer;
begin
  if not p_consent then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or p_phone is null or length(trim(p_phone)) < 10 then
    raise exception 'INVALID_INPUT';
  end if;
  if p_party < 1 or p_party > 99 then
    raise exception 'INVALID_PARTY';
  end if;

  select * into v_store from public.stores
  where slug = p_slug and status = 'active' and booking_enabled;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;

  -- 簡易レート制限: 同一電話番号で1時間に5件まで
  select count(*) into v_recent from public.booking_request_logs
  where phone = p_phone and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'RATE_LIMITED'; end if;
  insert into public.booking_request_logs (phone, store_id) values (p_phone, v_store.id);

  -- 空席再判定
  v_avail := public.get_booking_availability(p_slug, p_date, p_party);
  for v_slot in select * from jsonb_array_elements(coalesce(v_avail, '[]'::jsonb)) loop
    if v_slot->>'time' = p_time and (v_slot->>'available')::boolean then
      v_ok := true;
    end if;
  end loop;
  if not v_ok then raise exception 'SLOT_UNAVAILABLE'; end if;

  -- コース所要時間 > 既定滞在時間
  v_stay := coalesce(v_settings.default_stay_minutes, 120);
  if p_course_id is not null then
    select coalesce(duration_minutes, v_stay) into v_stay
    from public.menu_items where id = p_course_id;
  end if;

  v_start := (p_date::text || ' ' || p_time)::timestamp at time zone 'Asia/Tokyo';
  v_end := v_start + make_interval(mins => v_stay);

  -- 顧客: 電話番号で同定（企業単位）
  select id into v_customer_id from public.customers
  where organization_id = v_store.organization_id and phone = p_phone and status = 'active'
  limit 1;
  if v_customer_id is null then
    insert into public.customers
      (organization_id, primary_store_id, name, name_kana, phone, email, allergy_note)
    values (v_store.organization_id, v_store.id, p_name, p_kana, p_phone, p_email, p_allergy)
    returning id into v_customer_id;
  end if;

  insert into public.customer_consents (organization_id, customer_id, consent_type, granted, granted_at, source)
  values (v_store.organization_id, v_customer_id, 'privacy', true, now(), 'web_booking')
  on conflict (customer_id, consent_type)
  do update set granted = true, granted_at = now(), source = 'web_booking';

  select id into v_source_id from public.reservation_sources
  where code = coalesce(p_source_code, 'web') and organization_id is null limit 1;

  v_code := public.generate_reservation_code();

  insert into public.reservations
    (organization_id, store_id, customer_id, code, reserved_date, start_at, end_at,
     party_size, adults, children, course_id, seat_type, purpose,
     guest_name, guest_name_kana, guest_phone, guest_email,
     allergy_note, request_note, status, source_id, created_via, consent_accepted)
  values
    (v_store.organization_id, v_store.id, v_customer_id, v_code, p_date, v_start, v_end,
     p_party, coalesce(p_adults, p_party), coalesce(p_children, 0), p_course_id, p_seat_type, p_purpose,
     p_name, p_kana, p_phone, p_email,
     p_allergy, p_request, 'confirmed', v_source_id, 'web', true)
  returning id into v_res_id;

  return jsonb_build_object('id', v_res_id, 'code', v_code);
end $$;

-- 公開予約の照会（予約コード + 電話番号）
create or replace function public.get_public_reservation(p_code text, p_phone text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', r.code, 'store_name', s.name, 'store_slug', s.slug, 'store_phone', s.phone,
    'reserved_date', r.reserved_date, 'time', to_char(r.start_at at time zone 'Asia/Tokyo', 'HH24:MI'),
    'party_size', r.party_size, 'guest_name', r.guest_name, 'status', r.status,
    'course_name', (select name from public.menu_items where id = r.course_id),
    'request_note', r.request_note,
    'cancel_deadline_hours', coalesce(ss.cancel_deadline_hours, 24))
  from public.reservations r
  join public.stores s on s.id = r.store_id
  left join public.store_settings ss on ss.store_id = s.id
  where r.code = upper(p_code) and r.guest_phone = p_phone
  limit 1;
$$;

-- 公開予約のキャンセル
create or replace function public.cancel_public_reservation(p_code text, p_phone text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_res public.reservations%rowtype;
begin
  select * into v_res from public.reservations
  where code = upper(p_code) and guest_phone = p_phone;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_res.status not in ('pending','confirmed') then raise exception 'NOT_CANCELLABLE'; end if;

  update public.reservations
  set status = 'cancelled', cancel_reason = coalesce(p_reason, 'お客様都合'), cancelled_at = now()
  where id = v_res.id;

  update public.customers set cancel_count = cancel_count + 1
  where id = v_res.customer_id;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function
  public.get_booking_store(text),
  public.get_booking_availability(text, date, integer),
  public.create_public_reservation(text, date, text, integer, integer, integer, text, text, text, text, uuid, text, text, text, text, text, boolean),
  public.get_public_reservation(text, text),
  public.cancel_public_reservation(text, text, text)
to anon, authenticated;

-- -------------------------------------------------------------
-- 注文金額の再計算
-- 税込価格を基本とし、税額 = 税込額 - floor(税込額 / (1 + 税率))
-- -------------------------------------------------------------

create or replace function public.recalc_order_totals(p_order_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_gross integer := 0;
  v_tax integer := 0;
  v_item record;
  v_line_gross integer;
  v_line_tax integer;
  v_order public.orders%rowtype;
  v_service integer := 0;
  v_rate numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  for v_item in
    select * from public.order_items where order_id = p_order_id and status = 'active'
  loop
    v_line_gross := v_item.line_total;
    if v_item.tax_included then
      v_line_tax := v_line_gross - floor(v_line_gross / (1 + v_item.tax_rate / 100.0))::integer;
    else
      v_line_tax := floor(v_line_gross * v_item.tax_rate / 100.0)::integer;
      v_line_gross := v_line_gross + v_line_tax;
    end if;
    v_gross := v_gross + v_line_gross;
    v_tax := v_tax + v_line_tax;
  end loop;

  select coalesce(ss.service_charge_rate, 0) into v_rate
  from public.store_settings ss where ss.store_id = v_order.store_id;
  if coalesce(v_rate, 0) > 0 then
    v_service := floor(v_gross * v_rate / 100.0)::integer;
  end if;

  update public.orders
  set subtotal = v_gross - v_tax,
      tax_total = v_tax,
      service_charge = v_service,
      total = greatest(0, v_gross + v_service - discount_total + rounding_adjustment)
  where id = p_order_id;
end $$;

-- -------------------------------------------------------------
-- 会計確定（トランザクション・全連動）
-- p_payments: [{"method":"cash","amount":3000,"tendered":5000}]
-- -------------------------------------------------------------

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
  -- 権限: 対象店舗のPOS操作権限
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'open' then raise exception 'ORDER_NOT_OPEN'; end if;
  if not public.app_has_store_access(v_order.organization_id, v_order.store_id) then
    raise exception 'FORBIDDEN';
  end if;

  perform public.recalc_order_totals(p_order_id);
  select * into v_order from public.orders where id = p_order_id;

  -- 支払合計チェック
  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_sum := v_sum + (v_pay->>'amount')::integer;
  end loop;
  if v_sum <> v_order.total then
    raise exception 'PAYMENT_MISMATCH: total=% payments=%', v_order.total, v_sum;
  end if;

  -- 支払記録
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

  -- 現金分をレジへ
  if v_cash > 0 and p_register_session_id is not null then
    insert into public.cash_transactions
      (organization_id, store_id, register_session_id, kind, amount, purpose,
       order_id, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, p_register_session_id, 'sale', v_cash,
       '売上（注文 #' || v_order.order_no || '）', p_order_id, v_bd, auth.uid());
  end if;

  -- 注文確定
  update public.orders
  set status = 'paid', closed_at = now(), business_date = v_bd,
      register_session_id = coalesce(p_register_session_id, register_session_id),
      updated_by = auth.uid()
  where id = p_order_id;

  -- 顧客履歴
  if v_order.customer_id is not null then
    update public.customers
    set visit_count = visit_count + 1,
        total_spent = total_spent + v_order.total,
        last_visit_at = now(),
        first_visit_at = coalesce(first_visit_at, now())
    where id = v_order.customer_id;
  end if;

  -- 予約連動
  if v_order.reservation_id is not null then
    update public.reservations set status = 'completed'
    where id = v_order.reservation_id and status in ('confirmed','seated');
  end if;

  -- テーブルを清掃中へ
  if v_order.table_id is not null then
    update public.restaurant_tables set current_status = 'cleaning'
    where id = v_order.table_id;
  end if;

  -- 在庫連動（menu_item に紐付く商品在庫のみ）
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

-- -------------------------------------------------------------
-- 返金・取消（元取引に紐付け・物理削除しない）
-- -------------------------------------------------------------

create or replace function public.refund_order(
  p_order_id uuid, p_amount integer, p_method text, p_reason text,
  p_register_session_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_refund_id uuid;
  v_paid integer;
  v_refunded integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status not in ('paid','refunded') then raise exception 'ORDER_NOT_PAID'; end if;
  if not public.app_role_in(v_order.organization_id,
      array['org_owner','hq_admin','area_manager','store_manager']) then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select coalesce(sum(amount),0) into v_paid from public.payments
  where order_id = p_order_id and status = 'completed';
  select coalesce(sum(amount),0) into v_refunded from public.refunds
  where order_id = p_order_id;
  if p_amount + v_refunded > v_paid then raise exception 'REFUND_EXCEEDS_PAID'; end if;

  insert into public.refunds
    (organization_id, store_id, order_id, register_session_id, amount, method, reason,
     approved_by, created_by)
  values
    (v_order.organization_id, v_order.store_id, p_order_id, p_register_session_id,
     p_amount, p_method, p_reason, auth.uid(), auth.uid())
  returning id into v_refund_id;

  if p_method = 'cash' and p_register_session_id is not null then
    insert into public.cash_transactions
      (organization_id, store_id, register_session_id, kind, amount, purpose,
       order_id, refund_id, created_by)
    values
      (v_order.organization_id, v_order.store_id, p_register_session_id, 'refund', p_amount,
       '返金（注文 #' || v_order.order_no || '）', p_order_id, v_refund_id, auth.uid());
  end if;

  if p_amount + v_refunded >= v_paid then
    update public.orders set status = 'refunded', updated_by = auth.uid() where id = p_order_id;
  end if;

  if v_order.customer_id is not null then
    update public.customers set total_spent = greatest(0, total_spent - p_amount)
    where id = v_order.customer_id;
  end if;

  perform public.log_audit(v_order.organization_id, v_order.store_id, 'order.refund',
    'orders', p_order_id::text,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('refund_amount', p_amount, 'method', p_method), p_reason);

  return jsonb_build_object('ok', true, 'refund_id', v_refund_id);
end $$;

-- -------------------------------------------------------------
-- レジ開局・閉局
-- -------------------------------------------------------------

create or replace function public.open_register_session(
  p_store_id uuid, p_register_id uuid, p_opening_float integer)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_id uuid;
begin
  select * into v_store from public.stores where id = p_store_id;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;
  if not public.app_role_in(v_store.organization_id,
      array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff']) then
    raise exception 'FORBIDDEN';
  end if;
  if exists (select 1 from public.register_sessions
             where register_id = p_register_id and status = 'open') then
    raise exception 'SESSION_ALREADY_OPEN';
  end if;

  insert into public.register_sessions
    (organization_id, store_id, register_id, business_date, opened_by, opening_float, created_by)
  values
    (v_store.organization_id, p_store_id, p_register_id,
     (now() at time zone 'Asia/Tokyo')::date, auth.uid(), p_opening_float, auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'session_id', v_id);
end $$;

create or replace function public.close_register_session(
  p_session_id uuid, p_counted_cash integer, p_difference_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_session public.register_sessions%rowtype;
  v_expected integer;
  v_diff integer;
  v_sales integer; v_refunds integer; v_deposit integer; v_withdrawal integer;
  v_closing_id uuid;
  v_sales_total integer; v_orders_count integer; v_guests integer; v_discount integer;
  v_refund_total integer;
  v_breakdown jsonb;
begin
  select * into v_session from public.register_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.status <> 'open' then raise exception 'SESSION_NOT_OPEN'; end if;
  if not public.app_role_in(v_session.organization_id,
      array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff']) then
    raise exception 'FORBIDDEN';
  end if;

  select
    coalesce(sum(amount) filter (where kind = 'sale'), 0),
    coalesce(sum(amount) filter (where kind = 'refund'), 0),
    coalesce(sum(amount) filter (where kind in ('deposit','petty_in')), 0),
    coalesce(sum(amount) filter (where kind in ('withdrawal','petty_out')), 0)
  into v_sales, v_refunds, v_deposit, v_withdrawal
  from public.cash_transactions
  where register_session_id = p_session_id and status = 'active';

  v_expected := v_session.opening_float + v_sales - v_refunds + v_deposit - v_withdrawal;
  v_diff := p_counted_cash - v_expected;

  update public.register_sessions
  set status = 'closed', closed_by = auth.uid(), closed_at = now(),
      expected_cash = v_expected, counted_cash = p_counted_cash,
      difference = v_diff, difference_reason = p_difference_reason,
      updated_by = auth.uid()
  where id = p_session_id;

  -- 日次サマリ
  select coalesce(sum(total),0), count(*), coalesce(sum(guest_count),0), coalesce(sum(discount_total),0)
  into v_sales_total, v_orders_count, v_guests, v_discount
  from public.orders
  where store_id = v_session.store_id and business_date = v_session.business_date
    and status in ('paid','refunded');

  select coalesce(sum(amount),0) into v_refund_total
  from public.refunds
  where store_id = v_session.store_id and business_date = v_session.business_date;

  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) into v_breakdown
  from (
    select method, sum(amount) as amt from public.payments
    where store_id = v_session.store_id and business_date = v_session.business_date
      and status = 'completed'
    group by method) p;

  insert into public.daily_closings
    (organization_id, store_id, business_date, register_session_id,
     sales_total, orders_count, guests_count, discount_total, refund_total,
     payment_breakdown, cash_difference, closed_by, created_by)
  values
    (v_session.organization_id, v_session.store_id, v_session.business_date, p_session_id,
     v_sales_total, v_orders_count, v_guests, v_discount, v_refund_total,
     v_breakdown, v_diff, auth.uid(), auth.uid())
  on conflict (store_id, business_date) do update
  set sales_total = excluded.sales_total,
      orders_count = excluded.orders_count,
      guests_count = excluded.guests_count,
      discount_total = excluded.discount_total,
      refund_total = excluded.refund_total,
      payment_breakdown = excluded.payment_breakdown,
      cash_difference = excluded.cash_difference,
      register_session_id = excluded.register_session_id,
      status = 'closed', closed_by = auth.uid(), updated_by = auth.uid()
  returning id into v_closing_id;

  perform public.log_audit(v_session.organization_id, v_session.store_id, 'register.close',
    'register_sessions', p_session_id::text, null,
    jsonb_build_object('expected', v_expected, 'counted', p_counted_cash, 'difference', v_diff),
    p_difference_reason);

  return jsonb_build_object('ok', true, 'closing_id', v_closing_id,
    'expected', v_expected, 'difference', v_diff);
end $$;

-- -------------------------------------------------------------
-- 勤怠打刻
-- -------------------------------------------------------------

create or replace function public.apply_punch(
  p_store_id uuid, p_profile_id uuid, p_event_type text,
  p_source text default 'personal', p_via_pin boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_entry public.time_entries%rowtype;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_last_break public.time_entry_events%rowtype;
  v_break_min integer;
begin
  select * into v_store from public.stores where id = p_store_id;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;

  -- 本人打刻 or PIN経由（サーバー側で照合済み）を許可
  if p_profile_id <> auth.uid() and not p_via_pin
     and not public.app_role_in(v_store.organization_id,
       array['org_owner','hq_admin','area_manager','store_manager']) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_entry from public.time_entries
  where profile_id = p_profile_id and store_id = p_store_id
    and work_date = v_today and status = 'open'
  order by created_at desc limit 1;

  if p_event_type = 'clock_in' then
    if found and v_entry.clock_out_at is null then raise exception 'ALREADY_CLOCKED_IN'; end if;
    insert into public.time_entries
      (organization_id, store_id, profile_id, work_date, clock_in_at, source, created_by)
    values (v_store.organization_id, p_store_id, p_profile_id, v_today, now(), p_source, auth.uid())
    returning * into v_entry;

  elsif p_event_type = 'clock_out' then
    if not found or v_entry.clock_in_at is null then raise exception 'NOT_CLOCKED_IN'; end if;
    update public.time_entries
    set clock_out_at = now(), status = 'closed', updated_by = auth.uid()
    where id = v_entry.id;

  elsif p_event_type = 'break_start' then
    if not found then raise exception 'NOT_CLOCKED_IN'; end if;

  elsif p_event_type = 'break_end' then
    if not found then raise exception 'NOT_CLOCKED_IN'; end if;
    select * into v_last_break from public.time_entry_events
    where profile_id = p_profile_id and store_id = p_store_id
      and event_type = 'break_start' and occurred_at::date = v_today
    order by occurred_at desc limit 1;
    if found then
      v_break_min := ceil(extract(epoch from (now() - v_last_break.occurred_at)) / 60)::integer;
      update public.time_entries
      set break_minutes = break_minutes + v_break_min, updated_by = auth.uid()
      where id = v_entry.id;
    end if;
  else
    raise exception 'INVALID_EVENT';
  end if;

  insert into public.time_entry_events
    (organization_id, store_id, profile_id, time_entry_id, event_type, source, via_pin)
  values
    (v_store.organization_id, p_store_id, p_profile_id, v_entry.id, p_event_type, p_source, p_via_pin);

  return jsonb_build_object('ok', true, 'entry_id', v_entry.id, 'event', p_event_type);
end $$;

-- -------------------------------------------------------------
-- 顧客集計の再計算（保守用）
-- -------------------------------------------------------------

create or replace function public.recalc_customer_stats(p_customer_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.customers c
  set visit_count = s.cnt,
      total_spent = s.spent,
      first_visit_at = s.first_at,
      last_visit_at = s.last_at
  from (
    select
      count(*) filter (where o.status in ('paid','refunded')) as cnt,
      coalesce(sum(o.total) filter (where o.status = 'paid'), 0) as spent,
      min(o.closed_at) as first_at,
      max(o.closed_at) as last_at
    from public.orders o
    where o.customer_id = p_customer_id
  ) s
  where c.id = p_customer_id;
end $$;
