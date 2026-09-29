-- =============================================================
-- stera terminal 連携（2026-09-29 Ronnie「会計で stera を押したら金額が端末へ行って、決済されて、会計になって、ドロアまで開く」。Ronnie OK 済み）
--
-- LAN は使わない（iPad の Web から店内の機械へは直接つなげないため）。CloudPRNT と同じくクラウド中継:
--   stera_terminals          … 店舗の stera 端末。端末の「TENPO ONE 連携」アプリにリンクコード（link_code）を1回入れてつなぐ
--   stera_payment_requests   … レジからの決済依頼。端末のアプリが受け取って決済アプリを呼び、結果を返す
-- どちらもサーバー（service role）だけが読み書きする（RLS は有効・ポリシーなし）。画面はサーバーアクション経由。
-- 今までのデータは変えない（新しいテーブルだけ）。
-- =============================================================

create table if not exists public.stera_terminals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  -- 端末の番号（端末契約番号など。確認・表示用）
  terminal_no text check (terminal_no is null or char_length(terminal_no) <= 40),
  link_code text not null unique check (link_code ~ '^[A-Z2-9]{12}$'),
  status text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  last_seen_at timestamptz,
  app_version text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stera_terminals_store on public.stera_terminals(store_id, status);

create table if not exists public.stera_payment_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  terminal_id uuid not null references public.stera_terminals(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  amount integer not null check (amount between 1 and 99999999),
  tax integer not null default 0 check (tax between 0 and 9999999),
  payment_type text not null check (payment_type in ('01', '02-01', '02-02', '02-03', '02-04', '02-05', '02-06', '02-07', '03')),
  slip_number text not null check (slip_number ~ '^[0-9]{5}$'),
  status text not null default 'queued' check (status in ('queued', 'sent', 'succeeded', 'failed', 'canceled', 'expired')),
  result jsonb,
  -- 会計（checkout）まで済んだとき
  finalized_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_stera_requests_terminal on public.stera_payment_requests(terminal_id, status, created_at);
create index if not exists idx_stera_requests_order on public.stera_payment_requests(order_id, created_at desc);
-- 1つの伝票で同時に待っている依頼は1つだけ（二重決済を防ぐ）
create unique index if not exists uq_stera_requests_active_order
  on public.stera_payment_requests(order_id) where status in ('queued', 'sent');

alter table public.stera_terminals enable row level security;
alter table public.stera_payment_requests enable row level security;
revoke all on public.stera_terminals from anon, authenticated;
revoke all on public.stera_payment_requests from anon, authenticated;

comment on table public.stera_terminals is 'stera 端末（TENPO ONE 連携アプリのリンクコード）。サーバー専用';
comment on table public.stera_payment_requests is 'レジ → stera 端末の決済依頼と結果。サーバー専用';
