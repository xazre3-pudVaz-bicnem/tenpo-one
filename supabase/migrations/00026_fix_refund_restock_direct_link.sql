-- =============================================================
-- 00025の修正: 返金の在庫戻しが finalize_order の2つの減算経路のうち
-- ②レシピ（menu_item_ingredients）だけを鏡写しにしており、
-- ①menu_item直結の商品在庫（inventory_items.menu_item_id・ドリンク等）を戻していなかった。
-- restock=true の明細について①②両経路とも 'return' で戻すよう修正。
-- （検証スクリプト verify-accounting-consistency.mjs が検出したバグ）
-- =============================================================

create or replace function public.refund_order(
  p_order_id uuid, p_amount integer, p_method text, p_reason text,
  p_register_session_id uuid default null,
  p_kind text default 'refund',
  p_items jsonb default null)
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

  select coalesce(sum(amount),0) into v_paid from public.payments
  where order_id = p_order_id and status = 'completed';
  select coalesce(sum(amount),0) into v_refunded from public.refunds
  where order_id = p_order_id;
  if p_amount + v_refunded > v_paid then raise exception 'REFUND_EXCEEDS_PAID'; end if;

  if p_kind = 'void' and p_amount + v_refunded <> v_paid then
    raise exception 'VOID_MUST_BE_FULL';
  end if;

  v_bd := public.app_business_date(v_order.store_id);

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

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    for v_item in select * from jsonb_array_elements(p_items) loop
      insert into public.refund_items
        (organization_id, store_id, refund_id, order_item_id, quantity, amount, restock)
      values
        (v_order.organization_id, v_order.store_id, v_refund_id,
         (v_item->>'order_item_id')::uuid, (v_item->>'quantity')::numeric,
         (v_item->>'amount')::integer, coalesce((v_item->>'restock')::boolean, false));

      if coalesce((v_item->>'restock')::boolean, false) then
        -- ① menu_item直結の商品在庫（ドリンク等。finalize_orderの①を鏡写し）
        for v_ing in
          select ii.id as store_item_id, (v_item->>'quantity')::numeric as back_qty
          from public.order_items oi
          join public.inventory_items ii
            on ii.menu_item_id = oi.menu_item_id
           and ii.store_id = v_order.store_id and ii.status = 'active'
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

        -- ② レシピ理論在庫（finalize_orderの②を鏡写し）
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

  if p_method = 'cash' and p_register_session_id is not null then
    insert into public.cash_transactions
      (organization_id, store_id, register_session_id, kind, amount, purpose,
       order_id, refund_id, business_date, created_by)
    values
      (v_order.organization_id, v_order.store_id, p_register_session_id, 'refund', p_amount,
       '返金（注文 #' || v_order.order_no || '）', p_order_id, v_refund_id, v_bd, auth.uid());
  end if;

  if p_amount + v_refunded >= v_paid then
    update public.orders set status = 'refunded', updated_by = auth.uid() where id = p_order_id;
  end if;

  if v_order.customer_id is not null then
    update public.customers set total_spent = greatest(0, total_spent - p_amount)
    where id = v_order.customer_id;

    select * into v_loyalty from public.loyalty_settings
    where organization_id = v_order.organization_id and enabled;
    if found then
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
