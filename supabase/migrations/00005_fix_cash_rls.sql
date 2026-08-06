-- =============================================================
-- TENPO ONE — 00005 fix
-- レジ担当（staff）が中間入出金（deposit/withdrawal）を登録できるようにする。
-- 権限マトリクス上「レジ開局/閉局」はstaffまで可のため、レジ操作に付随する
-- 中間入出金のみをops層へ開放する（小口現金 petty_* は従来どおり店長以上）。
-- ポリシーはORで評価されるため追加のみで安全。
-- =============================================================

create policy cash_transactions_register_ops_insert on public.cash_transactions
  for insert with check (
    kind in ('deposit', 'withdrawal')
    and register_session_id is not null
    and public.app_role_in(organization_id, array[
      'org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff'])
    and public.app_has_store_access(organization_id, store_id)
  );
