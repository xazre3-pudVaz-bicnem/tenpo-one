-- =============================================================
-- TENPO ONE の iPhone/iPad アプリ（ios/）の通知トークン（APNs）。2026-09-28 Ronnie「iPhone と iPad のアプリ」
--
-- アプリは端末のトークンを、ログインしている Web のセッションで /api/native/push-token に送る。
-- サーバー（service role）だけが読み書きする（RLS は有効・ポリシーなし）。
--   app: regi（iPad のレジ）/ handy（iPhone のハンディ）/ owner（iPhone のオーナー・店長）
--   store_id: レジ・ハンディはその店舗。オーナーは NULL（会社全体）
--   environment: production（TestFlight・App Store）/ sandbox（Xcode から直接入れたとき）
-- =============================================================

create table if not exists public.native_push_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  token text not null unique,
  app text not null check (app in ('regi', 'handy', 'owner')),
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_native_push_tokens_store on public.native_push_tokens(store_id, app);
create index if not exists idx_native_push_tokens_org on public.native_push_tokens(organization_id, app);

alter table public.native_push_tokens enable row level security;
revoke all on public.native_push_tokens from anon, authenticated;

comment on table public.native_push_tokens is 'iPhone/iPad アプリの APNs トークン（サーバー専用）';
