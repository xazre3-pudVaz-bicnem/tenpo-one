-- =============================================================
-- 00034/00036 の是正: 関数のデフォルトEXECUTEは PUBLIC ロールへ付与されるため
-- `revoke ... from anon` は無効（anon は PUBLIC 経由で権限を継承）。
-- 正しくは PUBLIC から剥奪し、必要なロールへ明示GRANTする。
--
-- 方針: 特権RPC群は anon から実行不可にする（PUBLIC剥奪）。
--   - 認証ユーザー(authenticated)が直接呼ぶ業務RPCは authenticated へGRANT（RLS/内部権限検証が防御）
--   - service_role は正規フロー(scripts/webhook/app admin)のため常にGRANT
--   - 公開RPC（予約・QR）と RLSヘルパー(app_*)は対象外＝PUBLICのまま
-- =============================================================
do $$
declare
  r record;
  fn text;
  names text[] := array[
    -- 認証ユーザーが直接呼ぶ業務RPC（authenticated + service_role へ付与）
    'finalize_order','refund_order',
    'open_register_session','close_register_session','close_store_day','reopen_store_day',
    'apply_stock_receipt','apply_stock_transfer','ship_stock_transfer','receive_stock_transfer',
    'merge_customers','install_standard_accounts','post_journal_entry','void_journal_entry',
    'close_accounting_period','reopen_accounting_period','recalc_order_totals','recalc_customer_stats',
    'log_system_error','apply_punch'
  ];
begin
  foreach fn in array names loop
    for r in
      select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke execute on function %s from public', r.sig);
      execute format('revoke execute on function %s from anon', r.sig);
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    end loop;
  end loop;
end $$;
