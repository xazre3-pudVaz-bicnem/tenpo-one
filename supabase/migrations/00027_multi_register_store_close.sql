-- =============================================================
-- v0.4.3 REAL STORE PILOT HARDENING
-- 1) 複数レジ正式対応: レジ締め(session単位)と店舗日次締めの2段階へ分離
--    （複数レジが同じdaily_closingsを上書きする設計を廃止）
-- 2) 支払方法に 'other' を追加
-- 3) guest_count のvalidation（0..999・店内飲食は1名以上をトリガー強制）
-- 4) 客数KPIのテイクアウト包含を企業設定化（organizations.kpi_settings）
-- =============================================================

-- -------------------------------------------------------------
-- 2) 支払方法 'other'
-- -------------------------------------------------------------
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash','credit','qr','emoney','voucher','on_account','points','other'));
alter table public.refunds drop constraint if exists refunds_method_check;
alter table public.refunds add constraint refunds_method_check
  check (method in ('cash','credit','qr','emoney','voucher','on_account','points','other'));

-- -------------------------------------------------------------
-- 3) guest_count validation
-- -------------------------------------------------------------
alter table public.orders drop constraint if exists orders_guest_count_range;
alter table public.orders add constraint orders_guest_count_range
  check (guest_count >= 0 and guest_count <= 999);

-- 店内飲食（dine_in/course）は1名以上（テイクアウト/デリバリー/事前注文は0名可）
create or replace function public.enforce_guest_count()
returns trigger language plpgsql as $$
begin
  if new.order_type in ('dine_in','course') and new.guest_count < 1 then
    raise exception 'GUEST_COUNT_REQUIRED: 店内飲食の客数は1名以上で入力してください';
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_guest_count on public.orders;
create trigger trg_orders_guest_count
  before insert or update of guest_count, order_type on public.orders
  for each row execute function public.enforce_guest_count();

-- -------------------------------------------------------------
-- 4) 客数KPI設定（企業単位）
-- -------------------------------------------------------------
alter table public.organizations
  add column if not exists kpi_settings jsonb not null default '{}'::jsonb;
comment on column public.organizations.kpi_settings is
  '{"includeTakeoutGuests": boolean} 省略時true=テイクアウト/デリバリーの客数もKPIに含める';

-- -------------------------------------------------------------
-- 1) 2段階締め
-- -------------------------------------------------------------
-- daily_closings は「店舗日次締め」の記録となる。レジ別内訳を保持。
alter table public.daily_closings
  add column if not exists register_breakdown jsonb not null default '[]'::jsonb,
  add column if not exists sessions_count integer not null default 0;
comment on column public.daily_closings.register_breakdown is
  '[{register_id,register_name,session_id,opening_float,cash_sales,cash_refunds,cash_in,cash_out,expected_cash,counted_cash,difference,closed_by}]';

-- レジ締め v3: セッションを閉じるのみ（daily_closingsへは書かない。店舗日次締めは close_store_day）
create or replace function public.close_register_session(
  p_session_id uuid, p_counted_cash integer, p_difference_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_session public.register_sessions%rowtype;
  v_expected integer;
  v_diff integer;
  v_sales integer; v_refunds integer; v_deposit integer; v_withdrawal integer;
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

  perform public.log_audit(v_session.organization_id, v_session.store_id, 'register.close',
    'register_sessions', p_session_id::text, null,
    jsonb_build_object('expected', v_expected, 'counted', p_counted_cash, 'difference', v_diff,
                       'cash_sales', v_sales, 'cash_refunds', v_refunds),
    p_difference_reason);

  return jsonb_build_object('ok', true, 'session_id', p_session_id,
    'expected', v_expected, 'counted', p_counted_cash, 'difference', v_diff);
end $$;

-- 店舗日次締め: 全レジ締め後に店舗×営業日で集約して daily_closings を確定する
create or replace function public.close_store_day(
  p_store_id uuid, p_business_date date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_open_count integer;
  v_closing_id uuid;
  v_sales_total integer; v_orders_count integer; v_guests integer; v_discount integer;
  v_refund_total integer;
  v_breakdown jsonb;
  v_refund_breakdown jsonb;
  v_petty_in integer; v_petty_out integer;
  v_register_breakdown jsonb;
  v_sessions_count integer;
  v_expected_sum integer; v_counted_sum integer; v_diff_sum integer;
begin
  select * into v_store from public.stores where id = p_store_id;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;
  if not public.app_role_in(v_store.organization_id,
      array['org_owner','hq_admin','area_manager','store_manager','assistant_manager']) then
    raise exception 'FORBIDDEN';
  end if;

  -- 未締めレジがあれば拒否（件数付き）
  select count(*) into v_open_count from public.register_sessions
  where store_id = p_store_id and business_date = p_business_date and status = 'open';
  if v_open_count > 0 then
    raise exception 'OPEN_SESSIONS_REMAIN: %', v_open_count;
  end if;

  -- レジ別内訳（session単位。現金系はcash_transactionsから再集計）
  select coalesce(jsonb_agg(rb order by rb->>'register_name'), '[]'::jsonb),
         count(*),
         coalesce(sum((rb->>'expected_cash')::integer), 0),
         coalesce(sum((rb->>'counted_cash')::integer), 0),
         coalesce(sum((rb->>'difference')::integer), 0)
  into v_register_breakdown, v_sessions_count, v_expected_sum, v_counted_sum, v_diff_sum
  from (
    select jsonb_build_object(
      'register_id', rs.register_id,
      'register_name', r.name,
      'session_id', rs.id,
      'opening_float', rs.opening_float,
      'cash_sales', coalesce((select sum(amount) from public.cash_transactions ct
        where ct.register_session_id = rs.id and ct.status = 'active' and ct.kind = 'sale'), 0),
      'cash_refunds', coalesce((select sum(amount) from public.cash_transactions ct
        where ct.register_session_id = rs.id and ct.status = 'active' and ct.kind = 'refund'), 0),
      'cash_in', coalesce((select sum(amount) from public.cash_transactions ct
        where ct.register_session_id = rs.id and ct.status = 'active' and ct.kind in ('deposit','petty_in')), 0),
      'cash_out', coalesce((select sum(amount) from public.cash_transactions ct
        where ct.register_session_id = rs.id and ct.status = 'active' and ct.kind in ('withdrawal','petty_out')), 0),
      'expected_cash', rs.expected_cash,
      'counted_cash', rs.counted_cash,
      'difference', rs.difference,
      'closed_by', rs.closed_by
    ) as rb
    from public.register_sessions rs
    join public.registers r on r.id = rs.register_id
    where rs.store_id = p_store_id and rs.business_date = p_business_date
      and rs.status in ('closed','approved')
  ) t;

  if v_sessions_count = 0 then
    raise exception 'NO_CLOSED_SESSIONS';
  end if;

  -- 店舗日次サマリ（gross/refund/net）
  select coalesce(sum(total),0), count(*), coalesce(sum(guest_count),0), coalesce(sum(discount_total),0)
  into v_sales_total, v_orders_count, v_guests, v_discount
  from public.orders
  where store_id = p_store_id and business_date = p_business_date
    and status in ('paid','refunded');

  select coalesce(sum(amount),0) into v_refund_total
  from public.refunds
  where store_id = p_store_id and business_date = p_business_date;

  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) into v_breakdown
  from (
    select method, sum(amount) as amt from public.payments
    where store_id = p_store_id and business_date = p_business_date and status = 'completed'
    group by method) p;

  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) into v_refund_breakdown
  from (
    select method, sum(amount) as amt from public.refunds
    where store_id = p_store_id and business_date = p_business_date
    group by method) r;

  select
    coalesce(sum(amount) filter (where kind in ('deposit','petty_in')), 0),
    coalesce(sum(amount) filter (where kind in ('withdrawal','petty_out')), 0)
  into v_petty_in, v_petty_out
  from public.cash_transactions
  where store_id = p_store_id and business_date = p_business_date and status = 'active';

  insert into public.daily_closings
    (organization_id, store_id, business_date, register_session_id,
     sales_total, orders_count, guests_count, discount_total, refund_total, net_sales,
     payment_breakdown, refund_breakdown, petty_in_total, petty_out_total,
     expected_cash, counted_cash, cash_difference,
     register_breakdown, sessions_count, closed_by, created_by)
  values
    (v_store.organization_id, p_store_id, p_business_date, null,
     v_sales_total, v_orders_count, v_guests, v_discount, v_refund_total,
     v_sales_total - v_refund_total,
     v_breakdown, v_refund_breakdown, v_petty_in, v_petty_out,
     v_expected_sum, v_counted_sum, v_diff_sum,
     v_register_breakdown, v_sessions_count, auth.uid(), auth.uid())
  on conflict (store_id, business_date) do update
  set sales_total = excluded.sales_total,
      orders_count = excluded.orders_count,
      guests_count = excluded.guests_count,
      discount_total = excluded.discount_total,
      refund_total = excluded.refund_total,
      net_sales = excluded.net_sales,
      payment_breakdown = excluded.payment_breakdown,
      refund_breakdown = excluded.refund_breakdown,
      petty_in_total = excluded.petty_in_total,
      petty_out_total = excluded.petty_out_total,
      expected_cash = excluded.expected_cash,
      counted_cash = excluded.counted_cash,
      cash_difference = excluded.cash_difference,
      register_breakdown = excluded.register_breakdown,
      sessions_count = excluded.sessions_count,
      register_session_id = null,
      status = 'closed', closed_by = auth.uid(), updated_by = auth.uid()
  returning id into v_closing_id;

  perform public.log_audit(v_store.organization_id, p_store_id, 'store.day_close',
    'daily_closings', v_closing_id::text, null,
    jsonb_build_object('business_date', p_business_date, 'sessions', v_sessions_count,
                       'sales_total', v_sales_total, 'refund_total', v_refund_total,
                       'net_sales', v_sales_total - v_refund_total,
                       'expected_cash', v_expected_sum, 'counted_cash', v_counted_sum,
                       'difference', v_diff_sum), null);

  return jsonb_build_object('ok', true, 'closing_id', v_closing_id,
    'sessions_count', v_sessions_count,
    'sales_total', v_sales_total, 'refund_total', v_refund_total,
    'net_sales', v_sales_total - v_refund_total,
    'expected_cash', v_expected_sum, 'counted_cash', v_counted_sum,
    'cash_difference', v_diff_sum);
end $$;

-- 店舗日次締めの再オープン（管理者・理由必須・audit）
create or replace function public.reopen_store_day(
  p_store_id uuid, p_business_date date, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
begin
  select * into v_store from public.stores where id = p_store_id;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;
  if not public.app_role_in(v_store.organization_id, array['org_owner','hq_admin','area_manager']) then
    raise exception 'FORBIDDEN';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'REASON_REQUIRED'; end if;

  update public.daily_closings
  set status = 'reopened', updated_by = auth.uid()
  where store_id = p_store_id and business_date = p_business_date;
  if not found then raise exception 'CLOSING_NOT_FOUND'; end if;

  perform public.log_audit(v_store.organization_id, p_store_id, 'store.day_reopen',
    'daily_closings', p_business_date::text, null,
    jsonb_build_object('reason', p_reason), p_reason);
  return jsonb_build_object('ok', true);
end $$;
