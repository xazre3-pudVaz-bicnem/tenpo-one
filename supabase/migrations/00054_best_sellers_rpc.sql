-- =============================================================
-- 売れ筋TOP集計の最適化
--
-- これまでPOS画面は過去30日の order_items を全件取得し、JS側で集計していた。
-- 繁忙店では毎回数千行を転送するため、SQL側で集計して上位N件だけ返すRPCにする。
--
-- SECURITY DEFINER だが、呼び出し元が対象店舗にアクセスできる場合のみ結果を返す
-- （app_has_store_access で検証。RLSバイパスによる他店舗の閲覧を防ぐ）。
-- =============================================================

create or replace function public.get_best_sellers(
  p_store uuid,
  p_days integer default 30,
  p_limit integer default 12
)
returns table (menu_item_id uuid, quantity bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.stores where id = p_store;
  if v_org is null then
    return;
  end if;
  -- 呼び出し元の権限チェック（cypress運営 or 当該店舗にアクセスできる組織メンバー）
  if not (public.app_is_cypress_admin()
          or (public.app_is_org_member(v_org) and public.app_has_store_access(v_org, p_store))) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select oi.menu_item_id, sum(oi.quantity)::bigint as quantity
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.store_id = p_store
     and o.status = 'paid'
     and oi.status = 'active'
     and oi.menu_item_id is not null
     and o.business_date >= (current_date at time zone 'Asia/Tokyo')::date - p_days
   group by oi.menu_item_id
   order by sum(oi.quantity) desc
   limit p_limit;
end $$;

-- 既定の EXECUTE 権限は PUBLIC に付くため、明示的に絞る
revoke all on function public.get_best_sellers(uuid, integer, integer) from public;
grant execute on function public.get_best_sellers(uuid, integer, integer) to authenticated, service_role;

-- 集計対象の絞り込みを効かせるインデックス（店舗×状態×営業日）
create index if not exists idx_orders_store_status_date
  on public.orders(store_id, status, business_date);
