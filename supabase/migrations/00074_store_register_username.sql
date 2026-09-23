-- 店舗ユーザー名（レジのログインで打つ、店舗ごとの名前）。2026-09-23 要望。
--
-- それまでは 企業番号＋パスワード だけで、どの店舗かは接続元IPで決めていた。
-- 1社に店舗が増えると分かりにくいので、店舗そのものを名前で指定できるようにする。
--   ログイン = 企業番号（会社で1つ）＋ 店舗ユーザー名（店舗ごと）＋ レジ用パスワード（店舗ごと）
-- お店の回線チェックは今まで通り残す（名前とパスワードが漏れても外からは入れない）。

alter table public.stores add column if not exists register_username text;

-- 同じ会社の中で重複しないようにする（大文字小文字は区別しない）
create unique index if not exists idx_stores_register_username
  on public.stores(organization_id, lower(register_username))
  where register_username is not null;

alter table public.stores drop constraint if exists stores_register_username_check;
alter table public.stores add constraint stores_register_username_check
  check (register_username is null or register_username ~ '^[a-z0-9][a-z0-9-]{1,31}$');

comment on column public.stores.register_username is 'レジ（iPad）のログインで打つ店舗ユーザー名（会社の中で一意）';

-- 既存の店舗には slug をそのまま入れる（形が合わないものは運営が後から決める）
update public.stores
set register_username = slug
where register_username is null
  and slug ~ '^[a-z0-9][a-z0-9-]{1,31}$'
  and not exists (
    select 1 from public.stores other
    where other.organization_id = stores.organization_id
      and other.id <> stores.id
      and lower(other.register_username) = lower(stores.slug)
  );
