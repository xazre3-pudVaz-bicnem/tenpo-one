-- レジ（iPad）のログインと、契約の台数（2026-09-23 要望）。
--
-- 現場の要望:
--   - iPad は 企業番号 ＋ レジ用パスワード だけでログインさせたい（メールアドレスを打たせない）
--   - 企業番号は会社で1つ。どの店舗のレジかは「契約時に登録したお店のIP」で決まる
--   - レジ用パスワードは店舗ごと。運営（TENPO ONE）だけが発行・変更できる
--   - ハンディも契約した台数までしか使えないようにする（既定2台）
--   - パソコンからは今まで通り メールアドレス＋パスワード

-- 企業番号（t1 + 5桁）。レジのログイン画面で打つ番号。秘密ではない（秘密はパスワードの方）
alter table public.organizations add column if not exists org_code text;
create unique index if not exists idx_organizations_org_code
  on public.organizations(org_code) where org_code is not null;
comment on column public.organizations.org_code is 'レジ（iPad）のログインで使う企業番号（t1+5桁）';

-- 既存の会社にも企業番号を配る
do $$
declare
  r record;
  code text;
  placed boolean;
begin
  for r in select id from public.organizations where org_code is null loop
    placed := false;
    while not placed loop
      code := 't1' || lpad((floor(random() * 100000))::int::text, 5, '0');
      begin
        update public.organizations set org_code = code where id = r.id;
        placed := true;
      exception
        when unique_violation then placed := false;
      end;
    end loop;
  end loop;
end $$;

-- ハンディの契約台数（レジ＝register_limit と同じ考え方。既定2台）
alter table public.store_access_policies add column if not exists handy_limit integer not null default 2;
alter table public.store_access_policies drop constraint if exists store_access_policies_handy_limit_check;
alter table public.store_access_policies add constraint store_access_policies_handy_limit_check
  check (handy_limit between 0 and 20);
comment on column public.store_access_policies.handy_limit is 'ハンディの契約台数（契約時に運営が設定）';

-- レジ用パスワード（店舗ごと）。
-- 店舗・オーナーからは読めない・変えられない。運営（サービスロール）だけが書き込む。
create table if not exists public.store_register_credentials (
  store_id uuid primary key references public.stores(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  /** scrypt のハッシュ（平文は保存しない） */
  password_hash text not null,
  /** この店舗のレジ端末が使うログインアカウント（初回ログインのときに作る） */
  profile_id uuid references public.profiles(id) on delete set null,
  membership_id uuid references public.memberships(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table public.store_register_credentials is 'レジ（iPad）のログイン用パスワード。運営だけが発行・変更する';

alter table public.store_register_credentials enable row level security;

-- 読めるのは運営だけ（店舗側には見せない）。書き込みポリシーは作らない＝サービスロールのみ
drop policy if exists store_register_credentials_select on public.store_register_credentials;
create policy store_register_credentials_select on public.store_register_credentials for select
  using (public.app_is_cypress_admin());
