-- =============================================================
-- ディスプレイ（モニター）端末 — 2026-10-24 Ronnie
--   「デバイス管理にディスプレイ（モニター）を追加。QR でつなぐ。QR でつないだら
--     ログアウトしない。ただしお店の回線は必要。CYPRESS の運営コンソールから
--     企業ごと・店舗ごとに ON にしたときだけ使える（既定 OFF）」
--
-- 店のモニター・タブレット（ブラウザの /display か、TENPO ONE の iPad アプリ）に次のどちらかを出す:
--   kind = 'kitchen' … キッチンディスプレイ（KDS）。stations で持ち場を絞れる（空＝すべて）
--   kind = 'call'    … 呼び出しモニター（「調理中」「できあがり」の番号）
--
-- つなぎ方はハンディ端末（00064_handy_devices.sql）と同じ:
--   1. 店の設定（設定 > デバイス管理 > ディスプレイ端末）で QR を出す。5分・1回だけ有効。
--   2. 端末が QR を読むと、QR を出したレジの接続元と同じ回線かを確かめる（ペアリングの瞬間だけ）。
--   3. 成立したら、その端末専用のログインアカウント（アルバイトと同じ一番下の権限・その店だけ。
--      app_metadata.display_device = true。アプリ側では役割なし＝/display 以外は開けない）を作って
--      セッションを渡す。さらに端末の Cookie に「端末の鍵」を入れ、セッションが切れても自動でつなぎ直す。
--   4. ハンディと違い、回線の外に出てもログアウト・解除はしない（画面に「お店の回線につないでください」と出して待つ）。
--      解除は店の設定（または端末の画面の「レジに戻す」）からだけ。
--
-- 機能の ON/OFF（運営だけが変える）:
--   企業: feature_flags（organization_id, flag_key = 'display_monitor', enabled = true）
--   店舗: store_feature_flags（store_id, flag_key = 'display_monitor', enabled = true）
--   両方が enabled = true のときだけ使える。行が無いときは OFF
--   （既存の feature_flags の「行が無ければ ON」とは逆。display_monitor だけの決まりで、ほかの機能は変えない）。
--
-- 新しい表を3つ作るだけ（既存の表・データは変えない。何度流しても同じ結果）。
-- 書き込みは端末の作成・名前・種類・解除ともサーバー側（サービスロール）から行う。
-- 店の人（authenticated）に許すのは「見る」と「QR の発行（店長以上）」だけ。
-- =============================================================

-- -------------------------------------------------------------
-- 店舗ごとの機能 ON/OFF（運営コンソールから変える）
-- -------------------------------------------------------------
create table if not exists public.store_feature_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  flag_key text not null,
  enabled boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists idx_store_feature_flags_unique on public.store_feature_flags(store_id, flag_key);
create index if not exists idx_store_feature_flags_org on public.store_feature_flags(organization_id, flag_key);

comment on table public.store_feature_flags is '店舗ごとの機能 ON/OFF（運営だけが変える）。display_monitor は企業（feature_flags）と店舗の両方が ON のときだけ使える';

alter table public.store_feature_flags enable row level security;

-- 店舗の人は見えるだけ（変更は運営＝cypress管理者・サービスロールから）
drop policy if exists store_feature_flags_select on public.store_feature_flags;
create policy store_feature_flags_select on public.store_feature_flags for select
  using (
    public.app_is_cypress_admin()
    or (public.app_is_org_member(organization_id) and public.app_has_store_access(organization_id, store_id))
  );

drop policy if exists store_feature_flags_write on public.store_feature_flags;
create policy store_feature_flags_write on public.store_feature_flags for all
  using (public.app_is_cypress_admin())
  with check (public.app_is_cypress_admin());

-- -------------------------------------------------------------
-- ディスプレイ端末
-- -------------------------------------------------------------
create table if not exists public.display_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  -- 現場で見分けるための名前（例: 厨房モニター）
  name text not null,
  -- kitchen＝キッチンディスプレイ / call＝呼び出しモニター
  kind text not null default 'kitchen' check (kind in ('kitchen', 'call')),
  -- 出す持ち場（kitchen / grill / drink / dessert）。空＝すべて
  stations text[] not null default '{}',
  -- 画面ごとの表示設定（将来用。音・文字の大きさなど）
  settings jsonb not null default '{}'::jsonb,
  -- この端末専用のログインアカウント
  profile_id uuid not null references public.profiles(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  -- 端末の Cookie に入れた鍵のハッシュ（平文は保存しない）。セッションが切れたときのつなぎ直しに使う
  device_token_hash text,
  paired_at timestamptz not null default now(),
  -- ペアリングしたときの接続元IP
  paired_ip text,
  user_agent text,
  last_seen_at timestamptz,
  last_ip text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_display_devices_store on public.display_devices(store_id, status);
create unique index if not exists idx_display_devices_profile on public.display_devices(profile_id);
create unique index if not exists idx_display_devices_token on public.display_devices(device_token_hash) where device_token_hash is not null;

comment on table public.display_devices is 'ディスプレイ端末（QRでつないだ店のモニター。キッチンディスプレイ／呼び出しモニター）';

-- 発行済みのQR（コードは平文で持たず、ハッシュだけを保存する）
create table if not exists public.display_pairings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  code_hash text not null,
  -- QRを表示したレジの接続元IP。これと同じ回線からのみペアリングできる
  issued_ip text not null,
  device_name text not null,
  kind text not null default 'kitchen' check (kind in ('kitchen', 'call')),
  stations text[] not null default '{}',
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid references public.display_devices(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_display_pairings_code on public.display_pairings(code_hash);
create index if not exists idx_display_pairings_store on public.display_pairings(store_id, created_at desc);

alter table public.display_devices enable row level security;
alter table public.display_pairings enable row level security;

-- 店舗の管理側（副店長以上）が端末の一覧を見る。端末自身は自分の行だけ見える。
-- 作成・名前・種類・持ち場・解除はサーバー側（サービスロール）から（店の人が表を直接書き換えられないように、
-- update / insert / delete のポリシーは作らない）。
drop policy if exists display_devices_select on public.display_devices;
create policy display_devices_select on public.display_devices for select
  using (
    public.app_is_cypress_admin()
    or (
      public.app_is_org_member(organization_id)
      and public.app_has_store_access(organization_id, store_id)
      and (
        public.app_role_in(
          organization_id,
          array['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager']
        )
        or profile_id = auth.uid()
      )
    )
  );

-- QRの発行は店長以上（設定の「store.settings」と同じ範囲。コードはハッシュで入る）。閲覧も管理側のみ
drop policy if exists display_pairings_select on public.display_pairings;
create policy display_pairings_select on public.display_pairings for select
  using (
    public.app_is_cypress_admin()
    or (
      public.app_is_org_member(organization_id)
      and public.app_has_store_access(organization_id, store_id)
      and public.app_role_in(
        organization_id,
        array['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager']
      )
    )
  );

drop policy if exists display_pairings_insert on public.display_pairings;
create policy display_pairings_insert on public.display_pairings for insert
  with check (
    public.app_is_cypress_admin()
    or (
      public.app_is_org_member(organization_id)
      and public.app_has_store_access(organization_id, store_id)
      and public.app_role_in(organization_id, array['org_owner', 'hq_admin', 'area_manager', 'store_manager'])
      and used_at is null
      and device_id is null
    )
  );
