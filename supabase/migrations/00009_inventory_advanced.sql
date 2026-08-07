-- =============================================================
-- TENPO ONE — 00009 PHASE 3: 仕入・発注・在庫の本格化
-- 適正在庫/最低在庫・発注の税計算・店舗間移動・平均仕入単価
-- =============================================================

-- 在庫品目: 適正在庫・最低在庫・最終仕入単価
alter table public.inventory_items
  add column optimal_quantity numeric(12,2),
  add column min_quantity numeric(12,2),
  add column last_purchase_cost integer;

-- 発注: 税額・希望納期は expected_at 既存。明細に税率
alter table public.purchase_orders
  add column tax_total integer not null default 0;
alter table public.purchase_order_items
  add column tax_rate numeric(5,2) not null default 10.00;

-- 店舗間移動: 出庫/入庫の2行を同一グループIDで対にする
alter table public.stock_movements
  add column transfer_group_id uuid,
  add column to_store_id uuid references public.stores(id);
create index idx_stock_movements_transfer on public.stock_movements(transfer_group_id);

-- 入荷時の加重平均仕入単価の更新（サーバーアクションから呼ぶ）
-- new_avg = (現在庫×現avg + 入荷数×入荷単価) / (現在庫 + 入荷数)
create or replace function public.apply_stock_receipt(
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_unit_cost integer,
  p_purchase_order_id uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_item public.inventory_items%rowtype;
  v_new_avg integer;
begin
  select * into v_item from public.inventory_items where id = p_inventory_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if not public.app_role_in(v_item.organization_id, array
      ['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff']) then
    raise exception 'FORBIDDEN';
  end if;
  if p_quantity <= 0 then raise exception 'INVALID_QUANTITY'; end if;

  if coalesce(v_item.current_quantity, 0) <= 0 or v_item.avg_cost is null then
    v_new_avg := p_unit_cost;
  else
    v_new_avg := round(
      (v_item.current_quantity * v_item.avg_cost + p_quantity * p_unit_cost)
      / (v_item.current_quantity + p_quantity))::integer;
  end if;

  insert into public.stock_movements
    (organization_id, store_id, inventory_item_id, movement_type, quantity, unit_cost,
     ref_purchase_order_id, business_date, created_by)
  values
    (v_item.organization_id, v_item.store_id, p_inventory_item_id, 'in', p_quantity, p_unit_cost,
     p_purchase_order_id, (now() at time zone 'Asia/Tokyo')::date, auth.uid());

  update public.inventory_items
  set current_quantity = current_quantity + p_quantity,
      avg_cost = v_new_avg,
      last_purchase_cost = p_unit_cost,
      updated_by = auth.uid()
  where id = p_inventory_item_id;
end $$;

-- 店舗間移動（出庫店→入庫店をトランザクションで対にする）
create or replace function public.apply_stock_transfer(
  p_from_item_id uuid,
  p_to_store_id uuid,
  p_quantity numeric,
  p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_from public.inventory_items%rowtype;
  v_to public.inventory_items%rowtype;
  v_group uuid := gen_random_uuid();
  v_bd date := (now() at time zone 'Asia/Tokyo')::date;
begin
  select * into v_from from public.inventory_items where id = p_from_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if not public.app_role_in(v_from.organization_id, array
      ['org_owner','hq_admin','area_manager','store_manager','assistant_manager']) then
    raise exception 'FORBIDDEN';
  end if;
  if p_quantity <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  if v_from.store_id = p_to_store_id then raise exception 'SAME_STORE'; end if;
  if v_from.current_quantity < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;

  -- 受け側の同名品目を検索、なければ作成
  select * into v_to from public.inventory_items
  where organization_id = v_from.organization_id and store_id = p_to_store_id
    and name = v_from.name and status = 'active'
  limit 1;
  if not found then
    insert into public.inventory_items
      (organization_id, store_id, name, item_kind, category, unit,
       current_quantity, reorder_point, avg_cost, menu_item_id, created_by)
    values
      (v_from.organization_id, p_to_store_id, v_from.name, v_from.item_kind, v_from.category,
       v_from.unit, 0, v_from.reorder_point, v_from.avg_cost, v_from.menu_item_id, auth.uid())
    returning * into v_to;
  end if;

  insert into public.stock_movements
    (organization_id, store_id, inventory_item_id, movement_type, quantity, unit_cost,
     reason, transfer_group_id, to_store_id, business_date, created_by)
  values
    (v_from.organization_id, v_from.store_id, v_from.id, 'transfer_out', -p_quantity,
     v_from.avg_cost, p_reason, v_group, p_to_store_id, v_bd, auth.uid()),
    (v_from.organization_id, p_to_store_id, v_to.id, 'transfer_in', p_quantity,
     v_from.avg_cost, p_reason, v_group, null, v_bd, auth.uid());

  update public.inventory_items
  set current_quantity = current_quantity - p_quantity, updated_by = auth.uid()
  where id = v_from.id;
  update public.inventory_items
  set current_quantity = current_quantity + p_quantity, updated_by = auth.uid()
  where id = v_to.id;

  perform public.log_audit(v_from.organization_id, v_from.store_id, 'inventory.transfer',
    'inventory_items', v_from.id::text, null,
    jsonb_build_object('to_store_id', p_to_store_id, 'quantity', p_quantity), p_reason);

  return jsonb_build_object('ok', true, 'transfer_group_id', v_group, 'to_item_id', v_to.id);
end $$;
