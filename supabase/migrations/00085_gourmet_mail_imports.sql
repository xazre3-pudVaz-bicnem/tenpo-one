-- =============================================================
-- グルメサイト連携（メール取り込み）— 2026-09-27 Ronnie
--   「日本の全部のグルメサイトとつながる予約台帳。新規・変更・キャンセルが自動で入るように」
--
-- 店舗ごとの取り込み専用アドレス rsv-<token>@<ドメイン> に届いた予約通知メールを
-- app/api/inbound/gourmet-mail が読んで、ご予約台帳（reservations）に入れる。
-- 届いたメールは全部 gourmet_mail_imports に残す（読めなかったものは「要確認」として画面に出す）。
-- 設定は store_settings.settings.gourmetMail（enabled / token / sites）。
-- =============================================================

create table if not exists public.gourmet_mail_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id),
  -- どのサイトから（lib/gourmet-mail.ts の GourmetSiteKey）
  site text not null,
  -- new / change / cancel / verify / unknown
  kind text not null,
  -- imported / updated / cancelled / verified / needs_review / ignored / duplicate
  status text not null,
  from_address text,
  subject text,
  body_text text,
  message_id text,
  external_id text,
  parsed jsonb not null default '{}'::jsonb,
  reservation_id uuid references public.reservations(id) on delete set null,
  error text,
  -- 「要確認」を店舗が見て対応済みにした時刻
  resolved_at timestamptz,
  resolved_by uuid,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_gourmet_mail_imports_store_received on public.gourmet_mail_imports(store_id, received_at desc);
create index if not exists idx_gourmet_mail_imports_store_external on public.gourmet_mail_imports(store_id, external_id) where external_id is not null;
create unique index if not exists idx_gourmet_mail_imports_store_message on public.gourmet_mail_imports(store_id, message_id) where message_id is not null;

alter table public.gourmet_mail_imports enable row level security;

-- 参照は店舗アクセスを持つ組織メンバー。書き込みはサーバー（service role）だけ。対応済みの印は店長以上
drop policy if exists gourmet_mail_imports_select on public.gourmet_mail_imports;
create policy gourmet_mail_imports_select on public.gourmet_mail_imports for select using (
  public.app_is_cypress_admin()
  or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id))
);

drop policy if exists gourmet_mail_imports_update on public.gourmet_mail_imports;
create policy gourmet_mail_imports_update on public.gourmet_mail_imports for update using (
  public.app_is_cypress_admin()
  or (
    public.app_role_in(organization_id, array['org_owner','hq_admin','area_manager','store_manager','assistant_manager'])
    and public.app_has_store_access(organization_id, store_id)
  )
);

-- 予約の作られ方に「グルメサイトのメール」を足す
alter table public.reservations drop constraint if exists reservations_created_via_check;
alter table public.reservations add constraint reservations_created_via_check
  check (created_via in ('web','phone','walk_in','manual','gourmet_mail'));

-- 予約経路（共通マスタ）に日本の主なグルメサイトを足す
insert into public.reservation_sources (organization_id, code, name, sort_order)
select v.organization_id, v.code, v.name, v.sort_order
from (values
  (null::uuid, 'gurunavi',   'ぐるなび', 13),
  (null::uuid, 'ikyu',       '一休.com・PayPayグルメ', 14),
  (null::uuid, 'retty',      'Retty', 15),
  (null::uuid, 'ozmall',     'OZmall', 16),
  (null::uuid, 'hitosara',   'ヒトサラ', 17),
  (null::uuid, 'yahoo_line', 'Yahoo!リザベーション・LINEで予約', 18),
  (null::uuid, 'omakase',    'OMAKASE', 19)
) as v(organization_id, code, name, sort_order)
where not exists (
  select 1 from public.reservation_sources rs
  where rs.code = v.code and rs.organization_id is null
);
