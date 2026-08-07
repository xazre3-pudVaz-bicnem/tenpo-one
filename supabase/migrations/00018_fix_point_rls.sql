-- =============================================================
-- TENPO ONE — 00018 fix
-- point_transactions のINSERTポリシーに hq_accounting を追加。
-- UI（cash.approve権限=経理を含む）とRLSの不一致を解消する。
-- =============================================================
drop policy if exists point_transactions_write on public.point_transactions;
create policy point_transactions_write on public.point_transactions for insert
  with check (public.app_is_cypress_admin()
    or public.app_role_in(organization_id,
      array['org_owner','hq_admin','hq_accounting','area_manager','store_manager']));
