-- =============================================================
-- 端末の契約と承認をコントロールセンター（運営コンソール /admin）へ — 2026-10-25 Ronnie
--   「ipad lai dine 契約 on off, handy 端末 kati ota vanne yesta kura haru sabai control centre ma.
--     ipad monitor sabai control centre le ok garepaxi balla chalxa.」
--   ＝ レジ（iPad）・ハンディ・ディスプレイ端末の 契約 ON/OFF と台数は運営が決める。
--      新しい端末は「承認待ち」で作られ、運営が承認するまで使えない。
--   「table qr code on off sabai control centre bata」＝ テーブルQR（お客様の QR 注文）の ON/OFF も店舗ごとに運営が決める。
--
-- このファイルは「足すだけ」（既存の行・列は消さない。何度流しても同じ結果）:
--   1. store_access_policies に 契約 ON/OFF（レジ・ハンディ）と ディスプレイの台数を足す（既定は ON・2台）
--   2. register_devices / handy_devices / display_devices に 承認の列を足す
--      既存の端末はすべて approval_status = 'approved'（今使っている端末はそのまま使える＝止めない）
--      新しい端末はアプリが 'pending' で作る（列の既定値は 'approved' のまま。アプリの古い版が作った端末も止めない）
--   3. 承認の列は運営（cypress管理者）とサーバー（サービスロール）だけが変えられる（店舗の人は見るだけ）
--   4. お客様の QR 注文：店舗ごとの OFF（store_feature_flags の qr_order = false）でも注文を作らせない
--      （企業ごとの feature_flags の qr_order = false は今まで通り。行が無い店舗は今まで通り ON）
--
-- 先に 00103_display_devices.sql（display_devices・store_feature_flags）が必要。
-- 適用は Ronnie（Supabase の SQL エディタ）。アプリは列が無い間も今まで通り動く（lib/device-control-server.ts）。
-- =============================================================

do $$
begin
  if to_regclass('public.display_devices') is null or to_regclass('public.store_feature_flags') is null then
    raise exception '先に 00103_display_devices.sql を適用してください（display_devices・store_feature_flags が必要）';
  end if;
end $$;

-- -------------------------------------------------------------
-- 1. 契約（店舗ごと。運営だけが変える＝既存の store_access_policies の RLS のまま）
-- -------------------------------------------------------------
alter table public.store_access_policies add column if not exists register_enabled boolean not null default true;
alter table public.store_access_policies add column if not exists handy_enabled boolean not null default true;
alter table public.store_access_policies add column if not exists display_limit integer not null default 2;
alter table public.store_access_policies drop constraint if exists store_access_policies_display_limit_check;
alter table public.store_access_policies add constraint store_access_policies_display_limit_check
  check (display_limit between 0 and 20);

comment on column public.store_access_policies.register_enabled is 'レジ（iPad）の契約。false ならレジのログイン・レジ画面を使えない（運営が切り替える）';
comment on column public.store_access_policies.handy_enabled is 'ハンディの契約。false ならハンディの接続・操作ができない（運営が切り替える）';
comment on column public.store_access_policies.display_limit is 'ディスプレイ端末の契約台数（0＝数えない）。ON/OFF は store_feature_flags の display_monitor';

-- -------------------------------------------------------------
-- 2. 承認の列（3つの端末の表に同じ形で足す）
--    approval_status: pending＝承認待ち / approved＝承認済み / rejected＝却下 / revoked＝運営が解除
--    status（active / revoked）は今まで通り「この端末のログインが生きているか」
--    （ハンディの Wi-Fi 外の自動ログアウトは status だけ revoked になり、承認は残る）
-- -------------------------------------------------------------
alter table public.register_devices add column if not exists approval_status text not null default 'approved';
alter table public.register_devices add column if not exists approval_requested_at timestamptz;
alter table public.register_devices add column if not exists approved_at timestamptz;
alter table public.register_devices add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.register_devices drop constraint if exists register_devices_approval_status_check;
alter table public.register_devices add constraint register_devices_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected', 'revoked'));
create index if not exists idx_register_devices_approval on public.register_devices(store_id, approval_status);

alter table public.handy_devices add column if not exists approval_status text not null default 'approved';
alter table public.handy_devices add column if not exists approval_requested_at timestamptz;
alter table public.handy_devices add column if not exists approved_at timestamptz;
alter table public.handy_devices add column if not exists approved_by uuid references public.profiles(id) on delete set null;
-- 端末の Cookie に入れる鍵のハッシュ（承認待ちの端末・自動ログアウトした承認済みの端末を、次に QR を読んだとき見分ける）
alter table public.handy_devices add column if not exists device_token_hash text;
alter table public.handy_devices drop constraint if exists handy_devices_approval_status_check;
alter table public.handy_devices add constraint handy_devices_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected', 'revoked'));
create index if not exists idx_handy_devices_approval on public.handy_devices(store_id, approval_status);
create unique index if not exists idx_handy_devices_token on public.handy_devices(device_token_hash) where device_token_hash is not null;

alter table public.display_devices add column if not exists approval_status text not null default 'approved';
alter table public.display_devices add column if not exists approval_requested_at timestamptz;
alter table public.display_devices add column if not exists approved_at timestamptz;
alter table public.display_devices add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.display_devices drop constraint if exists display_devices_approval_status_check;
alter table public.display_devices add constraint display_devices_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected', 'revoked'));
create index if not exists idx_display_devices_approval on public.display_devices(store_id, approval_status);

comment on column public.register_devices.approval_status is '運営の承認（pending / approved / rejected / revoked）。既存の端末は approved';
comment on column public.handy_devices.approval_status is '運営の承認（pending / approved / rejected / revoked）。既存の端末は approved';
comment on column public.display_devices.approval_status is '運営の承認（pending / approved / rejected / revoked）。既存の端末は approved';

-- -------------------------------------------------------------
-- 3. 承認は運営だけ（PostgREST を店舗の人の JWT で直接叩いても変えられない）
--    00031 と同じ考え方: サービスロール（auth.uid() が null＝アプリの権限確認済みの操作）と運営は通す。
--    店舗の人（register_devices / handy_devices は店長が status を revoked にする更新が RLS で許されている）が
--    承認の列を書き換える・解除した端末を active に戻すのを止める。
-- -------------------------------------------------------------
create or replace function public.prevent_device_self_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.app_is_cypress_admin() then return new; end if;
  if new.approval_status is distinct from old.approval_status
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by then
    raise exception 'FORBIDDEN_FIELD: 端末の承認は TENPO ONE 運営だけが変更できます';
  end if;
  if old.status = 'revoked' and new.status = 'active' then
    raise exception 'FORBIDDEN_FIELD: 解除した端末を戻せるのは TENPO ONE 運営だけです';
  end if;
  return new;
end $$;

drop trigger if exists trg_register_devices_approval_guard on public.register_devices;
create trigger trg_register_devices_approval_guard
  before update on public.register_devices
  for each row execute function public.prevent_device_self_approval();

drop trigger if exists trg_handy_devices_approval_guard on public.handy_devices;
create trigger trg_handy_devices_approval_guard
  before update on public.handy_devices
  for each row execute function public.prevent_device_self_approval();

drop trigger if exists trg_display_devices_approval_guard on public.display_devices;
create trigger trg_display_devices_approval_guard
  before update on public.display_devices
  for each row execute function public.prevent_device_self_approval();

-- -------------------------------------------------------------
-- 4. お客様の QR 注文：店舗ごとの OFF も注文の作成で止める（00032 の trg_orders_qr_feature の中身だけ差し替え）
--    store_feature_flags に (store_id, 'qr_order', enabled = false) の行がある店舗だけ止める。行が無い＝今まで通り ON。
-- -------------------------------------------------------------
create or replace function public.enforce_qr_order_feature()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.order_source = 'qr' then
    if not public.app_feature_enabled(new.organization_id, 'qr_order') then
      raise exception 'QR_DISABLED: この店舗ではQRオーダーが無効です';
    end if;
    if exists (
      select 1 from public.store_feature_flags f
      where f.store_id = new.store_id and f.flag_key = 'qr_order' and f.enabled = false
    ) then
      raise exception 'QR_DISABLED: この店舗ではQRオーダーが無効です';
    end if;
  end if;
  return new;
end $$;
