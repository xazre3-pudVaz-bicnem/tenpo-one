-- ハンディ端末（/handy）のQRペアリング。
--
-- 現場の要望:
--   - スマホでQRを読むだけで使えるようにしたい（パスワード入力をさせない）
--   - ただし「店のWi-Fiにつないでいるときだけ」ペアリングできるようにしたい
--
-- 仕組み:
--   1. レジ（設定 > ハンディ端末）でQRを発行する。5分間・1回だけ有効。
--   2. スマホがQRを読むと、レジがQRを出したときの接続元IPと、スマホの接続元IPを比べる。
--      同じ回線（＝同じWi-Fi）でなければペアリングしない。
--   3. 成立したら、その端末専用のログインアカウントを作ってセッションを渡す。
--      以降はQRなしで開ける。レジ側からいつでも解除できる（解除でそのアカウントは無効化）。
--
-- 同じWi-Fiの判定はペアリングの瞬間だけに掛ける。使用中ずっと掛けると、
-- 回線のIPが変わった瞬間に全端末が使えなくなり、営業中の事故になるため。

create table if not exists public.handy_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  /** 現場で見分けるための名前（例: ホール1） */
  name text not null,
  /** この端末専用のログインアカウント */
  profile_id uuid not null references public.profiles(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  paired_at timestamptz not null default now(),
  /** ペアリングしたときの接続元IP（同じ回線かの記録） */
  paired_ip text,
  user_agent text,
  last_seen_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_handy_devices_store on public.handy_devices(store_id, status);
create unique index if not exists idx_handy_devices_profile on public.handy_devices(profile_id);

comment on table public.handy_devices is 'ハンディ端末（QRでペアリングしたスマホ）';

-- 発行済みのQR（コードは平文で持たず、ハッシュだけを保存する）
create table if not exists public.handy_pairings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  code_hash text not null,
  /** QRを表示したレジの接続元IP。これと同じ回線からのみペアリングできる */
  issued_ip text not null,
  device_name text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid references public.handy_devices(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_handy_pairings_code on public.handy_pairings(code_hash);
create index if not exists idx_handy_pairings_store on public.handy_pairings(store_id, created_at desc);

alter table public.handy_devices enable row level security;
alter table public.handy_pairings enable row level security;

-- 店舗の管理側だけが端末を見る・解除する。作成はサーバー側（サービスロール）から行う。
drop policy if exists handy_devices_select on public.handy_devices;
create policy handy_devices_select on public.handy_devices for select
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
        -- 端末自身は自分の行だけ見える（最終利用の記録用）
        or profile_id = auth.uid()
      )
    )
  );

drop policy if exists handy_devices_update on public.handy_devices;
create policy handy_devices_update on public.handy_devices for update
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
  )
  with check (
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

-- QRの発行履歴は管理側のみ閲覧（コードはハッシュなので見えても使えない）
drop policy if exists handy_pairings_select on public.handy_pairings;
create policy handy_pairings_select on public.handy_pairings for select
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
