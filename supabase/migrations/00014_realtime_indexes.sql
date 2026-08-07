-- =============================================================
-- TENPO ONE — 00014 商用品質化: Realtime有効化・パフォーマンスindex
-- =============================================================

-- ---- Supabase Realtime（必要なテーブルのみ・RLS適用で購読者は許可行のみ受信） ----
-- 対象: 注文（POS/QR/KDS連動）・注文明細（KDS）・テーブル状態（フロア）・予約（台帳）
do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.order_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.restaurant_tables;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.reservations;
  exception when duplicate_object then null;
  end;
end $$;

-- ---- 大規模データを想定した追加index（100社/1000店/1000万注文規模） ----
-- スタッフ別売上ランキング（本社ダッシュボード・給与歩合集計）
create index if not exists idx_orders_staff_date on public.orders(staff_id, business_date)
  where staff_id is not null;
-- 休眠顧客・セグメント絞込
create index if not exists idx_customers_org_lastvisit on public.customers(organization_id, last_visit_at);
-- 廃棄集計（原価管理・アラート）
create index if not exists idx_stock_movements_store_type_date
  on public.stock_movements(store_id, movement_type, business_date);
-- 勤怠の期間集計（給与・人件費概算）
create index if not exists idx_time_entries_org_date on public.time_entries(organization_id, work_date);
-- 支払方法別集計（組織横断レポート）
create index if not exists idx_payments_org_date on public.payments(organization_id, business_date);
-- 監査ログのactor検索（運営コンソール）
create index if not exists idx_audit_logs_actor on public.audit_logs(actor_id, created_at);
-- 通知一覧の並び
create index if not exists idx_notifications_recipient_created
  on public.notifications(recipient_id, created_at desc);
-- 請求書の費目別集計
create index if not exists idx_invoices_org_account on public.invoices(organization_id, expense_account_id);
-- QR/KDS: openな注文のテーブル検索
create index if not exists idx_orders_table_open on public.orders(table_id) where status = 'open';
