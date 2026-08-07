-- =============================================================
-- TENPO ONE — 00015 v0.3: 会員ポイント・クーポン・営業日境界・
-- 予約同時実行制御・清掃バッファ・KDS設定
-- =============================================================

-- ---- 店舗設定の追加 ----
alter table public.store_settings
  add column business_day_start_hour integer not null default 0
    check (business_day_start_hour between 0 and 12), -- 例:5 → 深夜5時までを前営業日扱い
  add column cleaning_buffer_minutes integer not null default 0
    check (cleaning_buffer_minutes between 0 and 120),
  add column allow_negative_stock boolean not null default true,
  add column kds_settings jsonb not null default '{}'::jsonb; -- {warn1,warn2,warn3,aggregate,sound}

-- ---- 営業日算出（深夜営業対応。全ての売上日付の基準） ----
create or replace function public.app_business_date(p_store_id uuid)
returns date language sql stable security definer set search_path = public as $$
  select ((now() at time zone 'Asia/Tokyo')
          - make_interval(hours => coalesce(
              (select business_day_start_hour from public.store_settings where store_id = p_store_id), 0)))::date;
$$;

-- =============================================================
-- 会員・ポイント（feature flag 'loyalty' でOFF可能）
-- =============================================================
create table public.loyalty_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id),
  enabled boolean not null default false,
  yen_per_point integer not null default 100 check (yen_per_point > 0), -- 100円=1pt
  point_value integer not null default 1 check (point_value > 0),       -- 1pt=1円
  expiry_months integer, -- null=無期限（失効バッチは将来。設計のみ）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create trigger trg_loyalty_settings_updated_at before update on public.loyalty_settings
  for each row execute function public.set_updated_at();

alter table public.customers
  add column member_no text,
  add column member_rank text not null default 'regular'
    check (member_rank in ('regular','silver','gold','vip')),
  add column point_balance integer not null default 0 check (point_balance >= 0);
create unique index idx_customers_member_no on public.customers(organization_id, member_no)
  where member_no is not null;

create table public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id),
  customer_id uuid not null references public.customers(id),
  order_id uuid references public.orders(id),
  kind text not null check (kind in ('earn','redeem','revoke','refund_return','adjust','expire')),
  points integer not null, -- 符号付き（earn:+ / redeem:- / revoke:- / refund_return:+）
  balance_after integer not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index idx_point_tx_customer on public.point_transactions(customer_id, created_at);
create index idx_point_tx_order on public.point_transactions(order_id);

alter table public.loyalty_settings enable row level security;
create policy loyalty_settings_select on public.loyalty_settings for select
  using (public.app_is_cypress_admin() or public.app_is_org_member(organization_id));
create policy loyalty_settings_write on public.loyalty_settings for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id, array['org_owner','hq_admin']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id, array['org_owner','hq_admin']));

alter table public.point_transactions enable row level security;
create policy point_transactions_select on public.point_transactions for select
  using (public.app_is_cypress_admin() or public.app_can_view_customer_pii(organization_id));
-- 書込は finalize_order / refund_order / adjust action（definer）経由のみを想定し、直接insertは管理ロールに限定
create policy point_transactions_write on public.point_transactions for insert
  with check (public.app_is_cypress_admin()
    or public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager']));

-- 支払方法にポイントを追加
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash','credit','qr','emoney','voucher','on_account','points'));
alter table public.refunds drop constraint refunds_method_check;
alter table public.refunds add constraint refunds_method_check
  check (method in ('cash','credit','qr','emoney','voucher','on_account','points'));

-- =============================================================
-- クーポン
-- =============================================================
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id), -- null=全店
  code text not null,
  name text not null,
  kind text not null check (kind in ('fixed','percent')),
  value integer not null check (value > 0), -- fixed:円 / percent:%（1-100）
  target_category_id uuid references public.menu_categories(id), -- null=全体
  target_menu_item_id uuid references public.menu_items(id),
  min_total integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  time_from time,
  time_to time,
  max_uses integer,          -- null=無制限
  per_customer_limit integer, -- null=無制限
  first_visit_only boolean not null default false,
  stackable boolean not null default false, -- 他の値引きとの併用可否
  status text not null default 'active' check (status in ('active','paused','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (organization_id, code)
);
create trigger trg_coupons_updated_at before update on public.coupons
  for each row execute function public.set_updated_at();

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  coupon_id uuid not null references public.coupons(id),
  order_id uuid not null references public.orders(id),
  customer_id uuid references public.customers(id),
  discount_amount integer not null,
  created_at timestamptz not null default now(),
  unique (coupon_id, order_id) -- 同一注文への二重適用防止
);
create index idx_coupon_redemptions_coupon on public.coupon_redemptions(coupon_id);
create index idx_coupon_redemptions_customer on public.coupon_redemptions(customer_id);

alter table public.orders add column coupon_id uuid references public.coupons(id);
alter table public.orders add column coupon_code text;

alter table public.coupons enable row level security;
create policy coupons_select on public.coupons for select
  using (public.app_is_cypress_admin() or public.app_is_org_member(organization_id));
create policy coupons_write on public.coupons for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','area_manager','store_manager']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','area_manager','store_manager']));
alter table public.coupon_redemptions enable row level security;
create policy coupon_redemptions_select on public.coupon_redemptions for select
  using (public.app_is_cypress_admin() or public.app_is_org_member(organization_id));
create policy coupon_redemptions_write on public.coupon_redemptions for insert
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id,
    array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff','part_time']));

-- =============================================================
-- 空席判定 v3: 清掃バッファ（予約の占有時間を end + buffer まで延長）
-- =============================================================
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
  v_buffer integer;
begin
  select * into v_store from public.stores
  where slug = p_slug and status = 'active' and booking_enabled;
  if not found then return null; end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;
  v_buffer := coalesce(v_settings.cleaning_buffer_minutes, 0);

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
  where store_id = v_store.id and status = 'active' and current_status <> 'unavailable';
  if v_capacity <= 0 or p_party > v_capacity then
    return '[]'::jsonb;
  end if;

  v_stay := coalesce(v_settings.default_stay_minutes, 120);
  v_last := coalesce(v_bh.last_entry_time, v_bh.close_time - interval '60 minutes');
  v_cutoff := now() + make_interval(mins => coalesce(v_settings.booking_cutoff_minutes, 120));

  v_slot := v_bh.open_time;
  while v_slot <= v_last loop
    v_slot_start := (p_date::text || ' ' || v_slot::text)::timestamp at time zone 'Asia/Tokyo';
    v_slot_end := v_slot_start + make_interval(mins => v_stay + v_buffer);

    if v_slot_start >= v_cutoff then
      select count(*) into v_private
      from public.reservations
      where store_id = v_store.id and is_private_hire
        and status in ('pending','confirmed','waiting','arrived','seated','billing')
        and start_at < v_slot_end
        and end_at + make_interval(mins => v_buffer) > v_slot_start;
      if v_private > 0 then
        v_slots := v_slots || jsonb_build_object('time', to_char(v_slot, 'HH24:MI'), 'available', false);
      else
        select coalesce(sum(party_size), 0) into v_used
        from public.reservations
        where store_id = v_store.id
          and status in ('pending','confirmed','waiting','arrived','seated','billing')
          and start_at < v_slot_end
          and end_at + make_interval(mins => v_buffer) > v_slot_start;
        v_slots := v_slots || jsonb_build_object(
          'time', to_char(v_slot, 'HH24:MI'),
          'available', (v_used + p_party) <= v_capacity);
      end if;
    else
      v_slots := v_slots || jsonb_build_object('time', to_char(v_slot, 'HH24:MI'), 'available', false);
    end if;

    v_slot := v_slot + make_interval(mins => coalesce(v_settings.slot_minutes, 30));
  end loop;
  return v_slots;
end $$;

-- =============================================================
-- 公開予約 v2: advisory lock でダブルブッキングの競合窓を排除
-- （同一店舗×同一日の予約作成を直列化してから空席再判定する）
-- =============================================================
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
  if not p_consent then raise exception 'CONSENT_REQUIRED'; end if;
  if p_name is null or length(trim(p_name)) = 0 or p_phone is null or length(trim(p_phone)) < 10 then
    raise exception 'INVALID_INPUT';
  end if;
  if p_party < 1 or p_party > 99 then raise exception 'INVALID_PARTY'; end if;

  select * into v_store from public.stores
  where slug = p_slug and status = 'active' and booking_enabled;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;

  select count(*) into v_recent from public.booking_request_logs
  where phone = p_phone and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'RATE_LIMITED'; end if;
  insert into public.booking_request_logs (phone, store_id) values (p_phone, v_store.id);

  -- 同一店舗×同一日の予約確定を直列化（トランザクション終了で自動解放）
  perform pg_advisory_xact_lock(hashtext(v_store.id::text || ':' || p_date::text));

  v_avail := public.get_booking_availability(p_slug, p_date, p_party);
  for v_slot in select * from jsonb_array_elements(coalesce(v_avail, '[]'::jsonb)) loop
    if v_slot->>'time' = p_time and (v_slot->>'available')::boolean then
      v_ok := true;
    end if;
  end loop;
  if not v_ok then raise exception 'SLOT_UNAVAILABLE'; end if;

  v_stay := coalesce(v_settings.default_stay_minutes, 120);
  if p_course_id is not null then
    select coalesce(duration_minutes, v_stay) into v_stay
    from public.menu_items where id = p_course_id;
  end if;
  v_start := (p_date::text || ' ' || p_time)::timestamp at time zone 'Asia/Tokyo';
  v_end := v_start + make_interval(mins => v_stay);

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

-- =============================================================
-- finalize_order v4: 営業日境界・クーポン記録・ポイント（利用/付与）
-- =============================================================
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
  v_points_used integer := 0;
  v_method text;
  v_amount integer;
  v_tendered integer;
  v_change integer;
  v_bd date;
  v_inv record;
  v_ing record;
  v_loyalty public.loyalty_settings%rowtype;
  v_earn integer := 0;
  v_balance integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'open' then raise exception 'ORDER_NOT_OPEN'; end if;
  if not public.app_has_store_access(v_order.organization_id, v_order.store_id) then
    raise exception 'FORBIDDEN';
  end if;

  v_bd := public.app_business_date(v_order.store_id);

  perform public.recalc_order_totals(p_order_id);
  select * into v_order from public.orders where id = p_order_id;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_sum := v_sum + (v_pay->>'amount')::integer;
    if (v_pay->>'method') = 'points' then
      v_points_used := v_points_used + (v_pay->>'amount')::integer;
    end if;
  end loop;
  if v_sum <> v_order.total then
    raise exception 'PAYMENT_MISMATCH: total=% payments=%', v_order.total, v_sum;
  end if;

  -- ポイント利用の検証（1pt=point_value円。残高不足を拒否）
  if v_points_used > 0 then
    if v_order.customer_id is null then raise exception 'POINTS_REQUIRE_CUSTOMER'; end if;
    select * into v_loyalty from public.loyalty_settings
    where organization_id = v_order.organization_id and enabled;
    if not found then raise exception 'LOYALTY_DISABLED'; end if;
    select point_balance into v_balance from public.customers
    where id = v_order.customer_id for update;
    if v_balance * v_loyalty.point_value < v_points_used then
      raise exception 'INSUFFICIENT_POINTS';
    end if;
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
    if v_method = 'cash' then v_cash := v_cash + v_amount; end if;
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

  -- クーポン利用の記録（同一注文への二重適用はUNIQUEで防止）
  if v_order.coupon_id is not null then
    insert into public.coupon_redemptions
      (organization_id, coupon_id, order_id, customer_id, discount_amount)
    values
      (v_order.organization_id, v_order.coupon_id, p_order_id, v_order.customer_id,
       v_order.discount_total)
    on conflict (coupon_id, order_id) do nothing;
  end if;

  if v_order.customer_id is not null then
    update public.customers
    set visit_count = visit_count + 1,
        total_spent = total_spent + v_order.total,
        last_visit_at = now(),
        first_visit_at = coalesce(first_visit_at, now())
    where id = v_order.customer_id;

    -- ポイント: 利用分を減算 → 現金相当額（ポイント払い除く）に対して付与
    if v_loyalty.id is null then
      select * into v_loyalty from public.loyalty_settings
      where organization_id = v_order.organization_id and enabled;
    end if;
    if v_loyalty.id is not null then
      if v_points_used > 0 then
        update public.customers
        set point_balance = point_balance - (v_points_used / v_loyalty.point_value)
        where id = v_order.customer_id
        returning point_balance into v_balance;
        insert into public.point_transactions
          (organization_id, store_id, customer_id, order_id, kind, points, balance_after, created_by)
        values
          (v_order.organization_id, v_order.store_id, v_order.customer_id, p_order_id,
           'redeem', -(v_points_used / v_loyalty.point_value), v_balance, auth.uid());
      end if;
      v_earn := floor((v_order.total - v_points_used)::numeric / v_loyalty.yen_per_point)::integer;
      if v_earn > 0 then
        update public.customers
        set point_balance = point_balance + v_earn
        where id = v_order.customer_id
        returning point_balance into v_balance;
        insert into public.point_transactions
          (organization_id, store_id, customer_id, order_id, kind, points, balance_after, created_by)
        values
          (v_order.organization_id, v_order.store_id, v_order.customer_id, p_order_id,
           'earn', v_earn, v_balance, auth.uid());
      end if;
    end if;
  end if;

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

  for v_ing in
    select st.id as store_item_id, (mii.quantity * oi.quantity) as use_qty
    from public.order_items oi
    join public.menu_item_ingredients mii on mii.menu_item_id = oi.menu_item_id
    join public.inventory_items ii_recipe on ii_recipe.id = mii.inventory_item_id
    join lateral (
      select ii.id from public.inventory_items ii
      where ii.organization_id = v_order.organization_id
        and ii.store_id = v_order.store_id and ii.status = 'active'
        and (ii.id = mii.inventory_item_id or ii.name = ii_recipe.name)
      order by (ii.id = mii.inventory_item_id) desc
      limit 1
    ) st on true
    where oi.order_id = p_order_id and oi.status = 'active' and oi.menu_item_id is not null
  loop
    insert into public.stock_movements
      (organization_id, store_id, inventory_item_id, movement_type, quantity,
       ref_order_id, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, v_ing.store_item_id, 'sale',
       -v_ing.use_qty, p_order_id, v_bd, auth.uid());
    update public.inventory_items
    set current_quantity = current_quantity - v_ing.use_qty
    where id = v_ing.store_item_id;
  end loop;

  perform public.log_audit(v_order.organization_id, v_order.store_id, 'order.finalize',
    'orders', p_order_id::text, null,
    jsonb_build_object('total', v_order.total, 'payments', p_payments,
                       'points_used', v_points_used, 'points_earned', v_earn), null);

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'total', v_order.total,
    'points_earned', v_earn);
end $$;

-- =============================================================
-- refund_order v2: ポイント戻し（付与分の取消・利用分の返還を比例配分）
-- =============================================================
create or replace function public.refund_order(
  p_order_id uuid, p_amount integer, p_method text, p_reason text,
  p_register_session_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_refund_id uuid;
  v_paid integer;
  v_refunded integer;
  v_loyalty public.loyalty_settings%rowtype;
  v_earned integer;
  v_revoked integer;
  v_revoke integer := 0;
  v_used integer;
  v_returned integer;
  v_return integer := 0;
  v_balance integer;
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

    -- ポイント戻し（比例配分・上限は元取引の残高）
    select * into v_loyalty from public.loyalty_settings
    where organization_id = v_order.organization_id and enabled;
    if found then
      -- 付与済み（earn）から既取消（revoke）を引いた残りを上限に、返金割合分を取消
      select coalesce(sum(points) filter (where kind = 'earn'), 0),
             coalesce(-sum(points) filter (where kind = 'revoke'), 0)
      into v_earned, v_revoked
      from public.point_transactions where order_id = p_order_id;
      v_revoke := least(v_earned - v_revoked,
                        floor(v_earned::numeric * p_amount / greatest(v_paid,1))::integer);
      if v_revoke > 0 then
        update public.customers
        set point_balance = greatest(0, point_balance - v_revoke)
        where id = v_order.customer_id
        returning point_balance into v_balance;
        insert into public.point_transactions
          (organization_id, store_id, customer_id, order_id, kind, points, balance_after, note, created_by)
        values
          (v_order.organization_id, v_order.store_id, v_order.customer_id, p_order_id,
           'revoke', -v_revoke, v_balance, '返金に伴う付与取消', auth.uid());
      end if;
      -- ポイント払い分（redeem）の返還
      select coalesce(-sum(points) filter (where kind = 'redeem'), 0),
             coalesce(sum(points) filter (where kind = 'refund_return'), 0)
      into v_used, v_returned
      from public.point_transactions where order_id = p_order_id;
      v_return := least(v_used - v_returned,
                        floor(v_used::numeric * p_amount / greatest(v_paid,1))::integer);
      if v_return > 0 then
        update public.customers
        set point_balance = point_balance + v_return
        where id = v_order.customer_id
        returning point_balance into v_balance;
        insert into public.point_transactions
          (organization_id, store_id, customer_id, order_id, kind, points, balance_after, note, created_by)
        values
          (v_order.organization_id, v_order.store_id, v_order.customer_id, p_order_id,
           'refund_return', v_return, v_balance, '返金に伴うポイント返還', auth.uid());
      end if;
    end if;
  end if;

  perform public.log_audit(v_order.organization_id, v_order.store_id, 'order.refund',
    'orders', p_order_id::text,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('refund_amount', p_amount, 'method', p_method,
                       'points_revoked', v_revoke, 'points_returned', v_return), p_reason);

  return jsonb_build_object('ok', true, 'refund_id', v_refund_id,
    'points_revoked', v_revoke, 'points_returned', v_return);
end $$;

-- レジ開局も営業日境界を使用
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
     public.app_business_date(p_store_id), auth.uid(), p_opening_float, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'session_id', v_id);
end $$;
