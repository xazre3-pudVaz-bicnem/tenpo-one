-- =============================================================
-- TENPO ONE — 00011 PHASE 5: 請求書・経費・小口現金の本格化
-- 請求書の費目・承認待ちステータス / 小口現金の立替・精算・実査
-- =============================================================

-- 請求書: 費目（勘定科目）と承認待ちステータス
alter table public.invoices
  add column expense_account_id uuid references public.expense_accounts(id);

alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('open','review','pending_approval','approved','scheduled','paid','rejected'));
-- ステータス表示: open=未処理 / review=確認待ち / pending_approval=承認待ち /
-- approved=承認済 / scheduled=支払予定 / paid=支払済 / rejected=差戻し
-- 期限超過は due_date < today かつ未払で導出（保存しない）

-- 小口現金: 立替・精算の区分を追加
alter table public.cash_transactions drop constraint cash_transactions_kind_check;
alter table public.cash_transactions add constraint cash_transactions_kind_check
  check (kind in ('sale','refund','deposit','withdrawal',
                  'petty_in','petty_out','petty_advance','petty_settlement','adjustment'));
-- petty_advance = 立替（スタッフが立て替えた支出。現金は減らない・負債計上）
-- petty_settlement = 精算（立替の払い戻し。現金が減る）

-- 小口現金の開始残高（店舗設定）
alter table public.store_settings
  add column petty_opening_balance integer not null default 0;

-- 小口現金の実査（実残高カウント）
create table public.petty_cash_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  count_date date not null,
  expected_amount integer not null, -- 理論残高（開始残高＋入金−出金−精算）
  counted_amount integer not null,  -- 実残高
  difference integer not null,      -- 実残高 − 理論残高
  note text,
  status text not null default 'recorded' check (status in ('recorded','approved')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (store_id, count_date)
);
create trigger trg_petty_cash_counts_updated_at
  before update on public.petty_cash_counts
  for each row execute function public.set_updated_at();

alter table public.petty_cash_counts enable row level security;
create policy petty_cash_counts_select on public.petty_cash_counts for select
  using (public.app_is_cypress_admin()
    or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id)));
create policy petty_cash_counts_write on public.petty_cash_counts for all
  using (public.app_is_cypress_admin()
    or (public.app_role_in(organization_id, array
        ['org_owner','hq_admin','hq_accounting','area_manager','store_manager','assistant_manager'])
        and public.app_has_store_access(organization_id, store_id)))
  with check (public.app_is_cypress_admin()
    or (public.app_role_in(organization_id, array
        ['org_owner','hq_admin','hq_accounting','area_manager','store_manager','assistant_manager'])
        and public.app_has_store_access(organization_id, store_id)));
