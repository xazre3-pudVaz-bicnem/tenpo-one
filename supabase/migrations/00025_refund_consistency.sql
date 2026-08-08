-- =============================================================
-- v0.4.2 TRANSACTION & ACCOUNTING CONSISTENCY
-- 1) refunds: VOID/REFUND区分・仕訳リンク・不変性（改変/削除禁止）
-- 2) refund_items: 商品単位返金（数量・金額・在庫戻し選択・二重戻し防止）
-- 3) refund_order v3: 明細返金・在庫戻し・営業日境界・二重/超過返金拒否（FOR UPDATE直列化）
-- 4) daily_closings: gross/refund/net・支払方法別返金・小口入出金・理論/実現金のsnapshot
-- 5) journal_entries.source_type に 'pos_refund' を追加（返金仕訳の自動生成用）
-- =============================================================

-- -------------------------------------------------------------
-- 1) refunds 拡張
-- -------------------------------------------------------------
alter table public.refunds
  add column if not exists kind text not null default 'refund' check (kind in ('refund','void')),
  add column if not exists journal_entry_id uuid references public.journal_entries(id);

comment on column public.refunds.kind is
  'refund=成立済み取引への返金 / void=取引取消（全額のみ。会計直後の誤会計等）';

-- 返金レコードの不変性: 金額・方法・対象・区分・営業日は作成後変更不可。物理削除は禁止。
-- （journal_entry_id の後付けリンクのみ許可）
create or replace function public.prevent_refund_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'REFUND_IMMUTABLE: 返金記録は削除できません';
  end if;
  if new.amount is distinct from old.amount
     or new.method is distinct from old.method
     or new.order_id is distinct from old.order_id
     or new.kind is distinct from old.kind
     or new.business_date is distinct from old.business_date then
    raise exception 'REFUND_IMMUTABLE: 返金記録の金額・方法・区分は変更できません';
  end if;
  return new;
end $$;

drop trigger if exists trg_refunds_immutable on public.refunds;
create trigger trg_refunds_immutable
  before update or delete on public.refunds
  for each row execute function public.prevent_refund_mutation();

-- -------------------------------------------------------------
-- 2) refund_items（商品単位返金）
-- -------------------------------------------------------------
create table if not exists public.refund_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  refund_id uuid not null references public.refunds(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  quantity numeric(8,2) not null check (quantity > 0),
  amount integer not null check (amount > 0),
  restock boolean not null default false, -- 在庫戻しを実施したか（実施はRPC内で1回のみ）
  created_at timestamptz not null default now(),
  unique (refund_id, order_item_id)
);
create index if not exists idx_refund_items_order_item on public.refund_items(order_item_id);

alter table public.refund_items enable row level security;
-- 閲覧のみ（作成はSECURITY DEFINERのrefund_order経由のみ。直接書込ポリシーは定義しない）
create policy refund_items_select on public.refund_items for select
  using (public.app_is_cypress_admin() or public.app_has_store_access(organization_id, store_id));

-- -------------------------------------------------------------
-- 3) refund_order v3
-- 旧シグネチャを置き換え（オーバーロード曖昧化を避けるためdrop）
-- -------------------------------------------------------------
drop function if exists public.refund_order(uuid, integer, text, text, uuid);

create function public.refund_order(
  p_order_id uuid, p_amount integer, p_method text, p_reason text,
  p_register_session_id uuid default null,
  p_kind text default 'refund',
  p_items jsonb default null) -- [{order_item_id, quantity, amount, restock}]
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_refund_id uuid;
  v_paid integer;
  v_refunded integer;
  v_bd date;
  v_item jsonb;
  v_oi public.order_items%rowtype;
  v_prev_qty numeric;
  v_prev_amount integer;
  v_items_sum integer := 0;
  v_ing record;
  v_restock_qty numeric;
  v_restocked jsonb := '[]'::jsonb;
  v_loyalty public.loyalty_settings%rowtype;
  v_earned integer; v_revoked integer; v_revoke integer := 0;
  v_used integer; v_returned integer; v_return integer := 0;
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
  if p_kind not in ('refund','void') then raise exception 'INVALID_KIND'; end if;

  -- 超過返金の拒否（注文行ロックにより同時実行でも合計が上限を超えない）
  select coalesce(sum(amount),0) into v_paid from public.payments
  where order_id = p_order_id and status = 'completed';
  select coalesce(sum(amount),0) into v_refunded from public.refunds
  where order_id = p_order_id;
  if p_amount + v_refunded > v_paid then raise exception 'REFUND_EXCEEDS_PAID'; end if;

  -- VOID（取引取消）は残額全額のみ
  if p_kind = 'void' and p_amount + v_refunded <> v_paid then
    raise exception 'VOID_MUST_BE_FULL';
  end if;

  -- 返金の営業日（深夜営業の境界に従う。過去のレジ締めは書き換えず返金発生日側へ計上）
  v_bd := public.app_business_date(v_order.store_id);

  -- 商品単位返金の検証（数量・金額が元明細の未返金分を超えないこと）
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    for v_item in select * from jsonb_array_elements(p_items) loop
      select * into v_oi from public.order_items
      where id = (v_item->>'order_item_id')::uuid and order_id = p_order_id and status = 'active';
      if not found then raise exception 'REFUND_ITEM_INVALID'; end if;

      select coalesce(sum(quantity),0), coalesce(sum(amount),0)
      into v_prev_qty, v_prev_amount
      from public.refund_items where order_item_id = v_oi.id;

      if (v_item->>'quantity')::numeric <= 0
         or (v_item->>'quantity')::numeric + v_prev_qty > v_oi.quantity then
        raise exception 'REFUND_ITEM_QTY_EXCEEDED';
      end if;
      if (v_item->>'amount')::integer <= 0
         or (v_item->>'amount')::integer + v_prev_amount > v_oi.line_total then
        raise exception 'REFUND_ITEM_AMOUNT_EXCEEDED';
      end if;
      v_items_sum := v_items_sum + (v_item->>'amount')::integer;
    end loop;
    if v_items_sum <> p_amount then raise exception 'REFUND_ITEMS_AMOUNT_MISMATCH'; end if;
  end if;

  insert into public.refunds
    (organization_id, store_id, order_id, register_session_id, amount, method, reason,
     kind, business_date, approved_by, created_by)
  values
    (v_order.organization_id, v_order.store_id, p_order_id, p_register_session_id,
     p_amount, p_method, p_reason, p_kind, v_bd, auth.uid(), auth.uid())
  returning id into v_refund_id;

  -- 商品明細と在庫戻し（restock=trueの明細のみ。UNIQUE(refund_id,order_item_id)で二重登録不可）
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    for v_item in select * from jsonb_array_elements(p_items) loop
      insert into public.refund_items
        (organization_id, store_id, refund_id, order_item_id, quantity, amount, restock)
      values
        (v_order.organization_id, v_order.store_id, v_refund_id,
         (v_item->>'order_item_id')::uuid, (v_item->>'quantity')::numeric,
         (v_item->>'amount')::integer, coalesce((v_item->>'restock')::boolean, false));

      if coalesce((v_item->>'restock')::boolean, false) then
        -- finalize_orderの理論在庫減算（'sale'）を鏡写しに 'return' で戻す
        for v_ing in
          select st.id as store_item_id, (mii.quantity * (v_item->>'quantity')::numeric) as back_qty
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
          where oi.id = (v_item->>'order_item_id')::uuid and oi.menu_item_id is not null
        loop
          insert into public.stock_movements
            (organization_id, store_id, inventory_item_id, movement_type, quantity,
             reason, ref_order_id, business_date, created_by)
          values
            (v_order.organization_id, v_order.store_id, v_ing.store_item_id, 'return',
             v_ing.back_qty, '返金返品（refund ' || v_refund_id || '）', p_order_id, v_bd, auth.uid());
          update public.inventory_items
          set current_quantity = current_quantity + v_ing.back_qty
          where id = v_ing.store_item_id;
        end loop;
        v_restocked := v_restocked || jsonb_build_object(
          'order_item_id', v_item->>'order_item_id', 'quantity', v_item->>'quantity');
      end if;
    end loop;
  end if;

  -- 現金返金はレジ台帳へ（クレジット/QR等は現金残高へ影響させない）
  if p_method = 'cash' and p_register_session_id is not null then
    insert into public.cash_transactions
      (organization_id, store_id, register_session_id, kind, amount, purpose,
       order_id, refund_id, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, p_register_session_id, 'refund', p_amount,
       '返金（注文 #' || v_order.order_no || '）', p_order_id, v_refund_id, v_bd, auth.uid());
  end if;

  -- 全額返金で refunded へ（元取引のtotalは上書きしない = gross保持）
  if p_amount + v_refunded >= v_paid then
    update public.orders set status = 'refunded', updated_by = auth.uid() where id = p_order_id;
  end if;

  if v_order.customer_id is not null then
    update public.customers set total_spent = greatest(0, total_spent - p_amount)
    where id = v_order.customer_id;

    select * into v_loyalty from public.loyalty_settings
    where organization_id = v_order.organization_id and enabled;
    if found then
      -- 付与済みポイントの比例取消
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
      -- ポイント払い分の比例返還
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
    jsonb_build_object('status', v_order.status, 'paid', v_paid, 'refunded_before', v_refunded),
    jsonb_build_object('refund_id', v_refund_id, 'refund_amount', p_amount, 'method', p_method,
                       'kind', p_kind, 'business_date', v_bd, 'items', p_items,
                       'restocked', v_restocked,
                       'points_revoked', v_revoke, 'points_returned', v_return), p_reason);

  return jsonb_build_object('ok', true, 'refund_id', v_refund_id, 'kind', p_kind,
    'business_date', v_bd, 'points_revoked', v_revoke, 'points_returned', v_return,
    'restocked', v_restocked);
end $$;

-- -------------------------------------------------------------
-- 4) daily_closings: gross/net・返金内訳・小口・理論/実現金のsnapshot
-- -------------------------------------------------------------
alter table public.daily_closings
  add column if not exists net_sales integer not null default 0,
  add column if not exists refund_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists petty_in_total integer not null default 0,
  add column if not exists petty_out_total integer not null default 0,
  add column if not exists expected_cash integer,
  add column if not exists counted_cash integer;

comment on column public.daily_closings.sales_total is '総売上（gross。paid+refunded注文のtotal合計。返金は控除しない）';
comment on column public.daily_closings.net_sales is '純売上（net = sales_total − 当営業日のrefund_total）';

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
  v_refund_breakdown jsonb;
  v_petty_in integer; v_petty_out integer;
begin
  select * into v_session from public.register_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.status <> 'open' then raise exception 'SESSION_NOT_OPEN'; end if;
  if not public.app_role_in(v_session.organization_id,
      array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff']) then
    raise exception 'FORBIDDEN';
  end if;

  -- 理論現金 = 開始現金 + 現金売上 + その他現金入金 − 現金返金 − 小口出金（現金のみ。カード/QR返金は影響しない）
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

  -- 日次サマリ（締め時点snapshot。以後の返金は返金発生日の営業日側へ計上される）
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

  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) into v_refund_breakdown
  from (
    select method, sum(amount) as amt from public.refunds
    where store_id = v_session.store_id and business_date = v_session.business_date
    group by method) r;

  select
    coalesce(sum(amount) filter (where kind in ('deposit','petty_in')), 0),
    coalesce(sum(amount) filter (where kind in ('withdrawal','petty_out')), 0)
  into v_petty_in, v_petty_out
  from public.cash_transactions
  where store_id = v_session.store_id and business_date = v_session.business_date
    and status = 'active';

  insert into public.daily_closings
    (organization_id, store_id, business_date, register_session_id,
     sales_total, orders_count, guests_count, discount_total, refund_total, net_sales,
     payment_breakdown, refund_breakdown, petty_in_total, petty_out_total,
     expected_cash, counted_cash, cash_difference, closed_by, created_by)
  values
    (v_session.organization_id, v_session.store_id, v_session.business_date, p_session_id,
     v_sales_total, v_orders_count, v_guests, v_discount, v_refund_total,
     v_sales_total - v_refund_total,
     v_breakdown, v_refund_breakdown, v_petty_in, v_petty_out,
     v_expected, p_counted_cash, v_diff, auth.uid(), auth.uid())
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
      register_session_id = excluded.register_session_id,
      status = 'closed', closed_by = auth.uid(), updated_by = auth.uid()
  returning id into v_closing_id;

  perform public.log_audit(v_session.organization_id, v_session.store_id, 'register.close',
    'register_sessions', p_session_id::text, null,
    jsonb_build_object('expected', v_expected, 'counted', p_counted_cash, 'difference', v_diff,
                       'sales_total', v_sales_total, 'refund_total', v_refund_total,
                       'net_sales', v_sales_total - v_refund_total),
    p_difference_reason);

  return jsonb_build_object('ok', true, 'closing_id', v_closing_id,
    'expected', v_expected, 'difference', v_diff,
    'sales_total', v_sales_total, 'refund_total', v_refund_total,
    'net_sales', v_sales_total - v_refund_total);
end $$;

-- -------------------------------------------------------------
-- 5) 仕訳source_typeに pos_refund を追加
-- -------------------------------------------------------------
alter table public.journal_entries drop constraint if exists journal_entries_source_type_check;
alter table public.journal_entries add constraint journal_entries_source_type_check
  check (source_type in
    ('manual','pos_sales','pos_refund','purchase','expense','petty_cash','payroll','bank',
     'fixed_asset','correction','opening'));
