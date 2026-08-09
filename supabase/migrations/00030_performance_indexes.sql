-- =============================================================
-- v0.5.0 PRODUCTION READINESS: パフォーマンス index 追加
-- パフォーマンス監査（大量データ耐性）で特定した不足indexを補う。
-- 注意: 本番で大量データがある状態で適用する場合、CREATE INDEX はテーブルを
-- ロックする。その場合は本ファイルを参考に手動で `CREATE INDEX CONCURRENTLY`
-- （トランザクション外）で流すこと（docs/performance.md参照）。
-- 初回適用時はデータ量が小さくロック時間は無視できる。
-- =============================================================

-- --- refunds: dashboard/reports/budgets/alerts が store_id×business_date で頻繁に引く ---
-- 現状 idx_refunds_order(order_id) のみで、返金の日次集計が毎回seq scanになっていた
create index if not exists idx_refunds_store_date on public.refunds(store_id, business_date);
create index if not exists idx_refunds_org_date on public.refunds(organization_id, business_date);

-- --- expenses: status/approval_status/business_date の複合絞り込み ---
create index if not exists idx_expenses_store_approval_date
  on public.expenses(store_id, approval_status, business_date) where status = 'active';

-- --- invoices: issue_date 範囲でのexport ---
create index if not exists idx_invoices_org_issue on public.invoices(organization_id, issue_date);

-- --- order_items: 集計JOINの起点（store_id, status='active'）---
create index if not exists idx_order_items_store_status
  on public.order_items(store_id) where status = 'active';

-- --- journal_entry_lines: 財務諸表/元帳/照合の勘定別集計 ---
create index if not exists idx_journal_lines_account on public.journal_entry_lines(account_id);

-- =============================================================
-- ILIKE '%q%' 検索の trigram index（pg_trgm）
-- 顧客検索・POS電話検索・予約検索が100万行規模でseq scanになる問題への対応
-- =============================================================
create extension if not exists pg_trgm;

create index if not exists idx_customers_name_trgm on public.customers using gin (name gin_trgm_ops);
create index if not exists idx_customers_kana_trgm on public.customers using gin (name_kana gin_trgm_ops);
create index if not exists idx_customers_phone_trgm on public.customers using gin (phone gin_trgm_ops);
create index if not exists idx_reservations_guest_name_trgm on public.reservations using gin (guest_name gin_trgm_ops);
create index if not exists idx_reservations_guest_phone_trgm on public.reservations using gin (guest_phone gin_trgm_ops);
