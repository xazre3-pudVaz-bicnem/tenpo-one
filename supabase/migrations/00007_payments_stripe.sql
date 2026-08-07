-- =============================================================
-- TENPO ONE — 00007 決済プロバイダー抽象化 + Stripe対応
-- docs/payment-stripe.md 参照。
-- カード番号・CVC等の機微決済情報は一切保存しない（プロバイダーIDのみ）。
-- POS売上の決済（payment_intents）とSaaS利用料（saas_subscriptions）は
-- ドメインを分離する。
-- =============================================================

-- 企業ごとのプロバイダー有効化（Secret KeyはDBに保存しない）
create table public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  provider text not null check (provider in ('stripe','square','airpay','stera','paygate')),
  mode text not null default 'test' check (mode in ('test','live')),
  is_active boolean not null default false,
  config jsonb not null default '{}'::jsonb, -- 非秘密設定のみ（将来: stripe_account_id 等）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (organization_id, provider)
);

-- 決済端末（店舗ごと）
create table public.terminal_readers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  provider text not null default 'stripe',
  provider_reader_id text not null unique,
  label text not null,
  device_type text,
  is_simulated boolean not null default true, -- 実機検証完了までtrue前提
  status text not null default 'unknown' check (status in ('online','offline','unknown')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_terminal_readers_store on public.terminal_readers(store_id);

-- プロバイダー決済の台帳（プロバイダー非依存）
create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id),
  provider text not null default 'stripe',
  purpose text not null check (purpose in
    ('pos_charge','booking_prepay','booking_deposit','cancellation_fee','payment_link')),
  order_id uuid references public.orders(id),
  reservation_id uuid references public.reservations(id),
  customer_id uuid references public.customers(id),
  amount integer not null check (amount > 0), -- 円
  currency text not null default 'jpy',
  status text not null default 'created' check (status in
    ('created','processing','requires_action','succeeded','failed','canceled','refunded')),
  provider_payment_intent_id text unique,
  provider_charge_id text,
  provider_customer_id text,
  provider_checkout_session_id text,
  reader_id uuid references public.terminal_readers(id),
  idempotency_key text not null unique,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index idx_payment_intents_order on public.payment_intents(order_id);
create index idx_payment_intents_reservation on public.payment_intents(reservation_id);
create index idx_payment_intents_org_status on public.payment_intents(organization_id, status);

-- Webhook受信の冪等化台帳（サービスロール専用）
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received','processed','failed','skipped')),
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);
create index idx_webhook_events_type on public.webhook_events(event_type, created_at);

-- 既存テーブルへのプロバイダーID関連付け
alter table public.payments
  add column provider text,
  add column provider_payment_intent_id text,
  add column provider_charge_id text;
alter table public.refunds
  add column provider text,
  add column provider_refund_id text;

-- 予約決済ポリシー（店舗設定）
alter table public.store_settings
  add column booking_payment_mode text not null default 'onsite'
    check (booking_payment_mode in ('onsite','prepay_full','deposit')),
  add column booking_deposit_amount integer not null default 0,
  add column cancellation_fee_policy jsonb not null default '{}'::jsonb;

-- SaaS課金（POS売上と分離した別ドメイン。Stripe Billing対応の下地）
create table public.saas_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id),
  provider text not null default 'stripe',
  provider_customer_id text,
  provider_subscription_id text,
  plan_code text not null default 'standard',
  status text not null default 'inactive' check (status in
    ('inactive','trialing','active','past_due','canceled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- updated_at トリガー
do $$
declare t text;
begin
  foreach t in array array['payment_providers','terminal_readers','payment_intents','saas_subscriptions']
  loop
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------

alter table public.payment_providers enable row level security;
create policy payment_providers_select on public.payment_providers for select
  using (public.app_is_cypress_admin() or public.app_is_org_member(organization_id));
create policy payment_providers_write on public.payment_providers for all
  using (public.app_is_cypress_admin() or public.app_role_in(organization_id, array['org_owner','hq_admin']))
  with check (public.app_is_cypress_admin() or public.app_role_in(organization_id, array['org_owner','hq_admin']));

alter table public.terminal_readers enable row level security;
create policy terminal_readers_select on public.terminal_readers for select
  using (public.app_is_cypress_admin()
    or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id)));
create policy terminal_readers_write on public.terminal_readers for all
  using (public.app_is_cypress_admin()
    or (public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager'])
        and public.app_has_store_access(organization_id, store_id)))
  with check (public.app_is_cypress_admin()
    or (public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager'])
        and public.app_has_store_access(organization_id, store_id)));

alter table public.payment_intents enable row level security;
create policy payment_intents_select on public.payment_intents for select
  using (public.app_is_cypress_admin()
    or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id)));
-- 作成・更新はPOS操作ロール（会計フローの一部のため）。Webhookはサービスロールで更新（RLS対象外）
create policy payment_intents_write on public.payment_intents for all
  using (public.app_is_cypress_admin()
    or (public.app_role_in(organization_id, array
        ['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff','part_time'])
        and public.app_has_store_access(organization_id, store_id)))
  with check (public.app_is_cypress_admin()
    or (public.app_role_in(organization_id, array
        ['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff','part_time'])
        and public.app_has_store_access(organization_id, store_id)));

-- webhook_events: クライアントからのアクセス禁止（サービスロール専用）
alter table public.webhook_events enable row level security;
create policy webhook_events_cypress_select on public.webhook_events for select
  using (public.app_is_cypress_admin());

alter table public.saas_subscriptions enable row level security;
create policy saas_subscriptions_select on public.saas_subscriptions for select
  using (public.app_is_cypress_admin()
    or public.app_role_in(organization_id, array['org_owner','hq_admin','hq_accounting']));
create policy saas_subscriptions_write on public.saas_subscriptions for all
  using (public.app_is_cypress_admin()) with check (public.app_is_cypress_admin());
