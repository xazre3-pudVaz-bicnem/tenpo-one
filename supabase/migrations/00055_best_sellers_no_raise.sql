-- =============================================================
-- get_best_sellers: 権限が無い場合は例外ではなく空を返す
--
-- 00054 では権限チェックに失敗すると FORBIDDEN を raise していたが、
-- 売れ筋はPOS画面の補助表示であり、例外にすると画面全体が落ちる。
-- 置き換え前の実装（RLS付きの通常クエリ）は権限が無ければ0件を返すだけだったため、
-- その挙動に合わせる（データを返さない点は同じで、可用性のみ改善）。
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
    return; -- 店舗が無い
  end if;
  if not (public.app_is_cypress_admin()
          or (public.app_is_org_member(v_org) and public.app_has_store_access(v_org, p_store))) then
    return; -- 権限が無ければ空（RLS相当）
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

-- CREATE OR REPLACE で既定のPUBLIC実行権限に戻るため、再度絞り直す
revoke all on function public.get_best_sellers(uuid, integer, integer) from public;
grant execute on function public.get_best_sellers(uuid, integer, integer) to authenticated, service_role;
