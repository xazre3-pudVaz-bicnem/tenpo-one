-- =============================================================
-- 予約リマインダー基盤（送信アウトボックス）
-- 方針: 実送信（メール/SMS）は外部プロバイダ未接続。ここでは「送信待ちキュー」を持ち、
--       将来 SendGrid/Twilio 等を差し替え接続する（Stripe決済抽象と同じ考え方）。
--   - notification_outbox: 送信予定/結果のキュー。個人情報は最小限（宛先・本文）。
--   - store_settings: リマインダー有効化と送信タイミング（来店何時間前か）。
-- RLS: 店舗スタッフ（所属＋店舗アクセス）とCYPRESSのみ参照。書込は管理系ロール＋CYPRESS。
-- =============================================================

alter table public.store_settings
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_hours_before integer not null default 24;

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  channel text not null check (channel in ('email','sms')),
  recipient text not null,              -- メール or 電話番号
  subject text,
  body text not null,
  status text not null default 'queued'
    check (status in ('queued','sent','failed','skipped','canceled')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_notification_outbox_store on public.notification_outbox(store_id, status, scheduled_for);
create index if not exists idx_notification_outbox_reservation on public.notification_outbox(reservation_id);

alter table public.notification_outbox enable row level security;

create policy notification_outbox_select on public.notification_outbox for select
  using (
    public.app_is_cypress_admin()
    or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id))
  );
create policy notification_outbox_write on public.notification_outbox for all
  using (
    public.app_is_cypress_admin()
    or (public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager','assistant_manager'])
        and public.app_has_store_access(organization_id, store_id))
  )
  with check (
    public.app_is_cypress_admin()
    or (public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager','assistant_manager'])
        and public.app_has_store_access(organization_id, store_id))
  );
