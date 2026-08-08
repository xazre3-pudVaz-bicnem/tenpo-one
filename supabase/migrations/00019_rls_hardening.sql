-- =============================================================
-- TENPO ONE — 00019 セキュリティ監査対応（RLS強化）
-- 1) app_has_store_access: HQ系ロールでも「店舗がその組織に属すること」を検証
--    （他組織の store_id を自組織のデータに紐付ける書込を根本から遮断）
-- 2) 子テーブルRLS: 親の存在確認だけでなく両側の組織/店舗整合を検証
-- =============================================================

create or replace function public.app_has_store_access(p_org uuid, p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_store is null then public.app_is_org_member(p_org)
    when public.app_role_in(p_org, array['org_owner','hq_admin','hq_accounting','external_accountant'])
      then exists (
        select 1 from public.stores s
        where s.id = p_store and s.organization_id = p_org)
    else exists (
      select 1
      from public.memberships m
      join public.membership_stores ms on ms.membership_id = m.id
      join public.stores s on s.id = ms.store_id
      where m.profile_id = auth.uid() and m.organization_id = p_org
        and m.status = 'active' and ms.store_id = p_store
        and s.organization_id = p_org)
  end;
$$;

-- 子テーブル: 参照両側の組織/店舗整合を強制
drop policy if exists customer_tag_links_all on public.customer_tag_links;
create policy customer_tag_links_all on public.customer_tag_links for all
  using (exists (
    select 1 from public.customers c
    join public.customer_tags t on t.id = tag_id and t.organization_id = c.organization_id
    where c.id = customer_id))
  with check (exists (
    select 1 from public.customers c
    join public.customer_tags t on t.id = tag_id and t.organization_id = c.organization_id
    where c.id = customer_id));

drop policy if exists reservation_tables_all on public.reservation_tables;
create policy reservation_tables_all on public.reservation_tables for all
  using (exists (
    select 1 from public.reservations r
    join public.restaurant_tables rt on rt.id = table_id and rt.store_id = r.store_id
    where r.id = reservation_id))
  with check (exists (
    select 1 from public.reservations r
    join public.restaurant_tables rt on rt.id = table_id and rt.store_id = r.store_id
    where r.id = reservation_id));

drop policy if exists menu_item_modifiers_all on public.menu_item_modifiers;
create policy menu_item_modifiers_all on public.menu_item_modifiers for all
  using (exists (
    select 1 from public.menu_items mi
    join public.menu_modifiers mm on mm.id = modifier_id and mm.organization_id = mi.organization_id
    where mi.id = menu_item_id))
  with check (exists (
    select 1 from public.menu_items mi
    join public.menu_modifiers mm on mm.id = modifier_id and mm.organization_id = mi.organization_id
    where mi.id = menu_item_id));

drop policy if exists stock_count_items_all on public.stock_count_items;
create policy stock_count_items_all on public.stock_count_items for all
  using (exists (
    select 1 from public.stock_counts sc
    join public.inventory_items ii on ii.id = inventory_item_id and ii.store_id = sc.store_id
    where sc.id = stock_count_id))
  with check (exists (
    select 1 from public.stock_counts sc
    join public.inventory_items ii on ii.id = inventory_item_id and ii.store_id = sc.store_id
    where sc.id = stock_count_id));
