-- =============================================================
-- 店舗導入管理基盤（CYPRESS運営が多店舗を安全に受け入れるための構造）
-- 方針: TENPO ONE本体は1つのマルチテナントSaaSのまま。店舗ごとのコード複製はしない。
--       導入状態・ハードウェア・運営メモを「データ」として管理する層のみを追加する。
--   1) store_onboarding … 店舗1:1。environment(demo/test/pilot/production)・導入stage・
--      利用予定モジュール・手動チェックリスト・Go Live情報。
--   2) store_hardware   … 決済端末/プリンター/ドロア/KDS等の機器情報（秘密情報は保存しない）。
--   3) tenant_support_notes … CYPRESS運営だけが見る導入メモ（個人情報・秘密は書かない運用）。
-- すべて RLS は CYPRESS 限定（app_is_cypress_admin()）。書込は service role 経由（既存admin流儀）。
-- 一般店舗Ownerはこれらへ一切アクセスできない（tenant isolation維持）。
-- =============================================================

-- 1) store_onboarding（店舗1:1）
create table if not exists public.store_onboarding (
  store_id uuid primary key references public.stores(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  -- 本番/デモ/テスト/パイロットの識別（デモデータと混ざらない）
  environment text not null default 'production'
    check (environment in ('demo','test','pilot','production')),
  -- 導入ステージ（state machine。遷移はアプリ側 lib/tenant-onboarding.ts で制御）
  stage text not null default 'draft'
    check (stage in ('draft','onboarding','configuration','testing','pilot','ready','live','suspended','cancelled')),
  -- この店舗が実際に使うモジュール（Go Live判定・チェックリストの関連性に使用）
  enabled_modules text[] not null default array['reservations','pos','crm','reports']::text[],
  -- 人手確認が必要な項目のチェック状態: { itemKey: { done: bool, by: uuid, at: timestamptz } }
  checklist jsonb not null default '{}'::jsonb,
  go_live_at timestamptz,
  go_live_by uuid,
  opened_on date,           -- 利用開始日
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index if not exists idx_store_onboarding_org on public.store_onboarding(organization_id);
create index if not exists idx_store_onboarding_stage on public.store_onboarding(stage);
create index if not exists idx_store_onboarding_env on public.store_onboarding(environment);

alter table public.store_onboarding enable row level security;
create policy store_onboarding_cypress_all on public.store_onboarding
  for all using (public.app_is_cypress_admin()) with check (public.app_is_cypress_admin());

-- 2) store_hardware（機器情報。password/secret/IP認証情報は保存しない運用）
create table if not exists public.store_hardware (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid not null references public.stores(id) on delete cascade,
  category text not null check (category in ('payment_terminal','printer','cash_drawer','kds')),
  provider text,            -- 決済: Square/stera/USEN/AirPAY/PAYGATE/Other、その他: メーカー名
  model text,
  connection text,          -- bluetooth/lan/usb/cloud 等（自由記述）
  ip_address text,          -- 参考情報のみ（認証情報は保存しない）
  status text not null default 'planned'
    check (status in ('planned','ordered','installed','active','inactive','removed')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index if not exists idx_store_hardware_store on public.store_hardware(store_id);

alter table public.store_hardware enable row level security;
create policy store_hardware_cypress_all on public.store_hardware
  for all using (public.app_is_cypress_admin()) with check (public.app_is_cypress_admin());

-- 3) tenant_support_notes（CYPRESS内部メモ。個人情報・秘密は書かない運用）
create table if not exists public.tenant_support_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  store_id uuid references public.stores(id) on delete cascade,  -- null=組織スコープ
  body text not null,
  author_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_tenant_support_notes_org on public.tenant_support_notes(organization_id, created_at desc);
create index if not exists idx_tenant_support_notes_store on public.tenant_support_notes(store_id);

alter table public.tenant_support_notes enable row level security;
create policy tenant_support_notes_cypress_all on public.tenant_support_notes
  for all using (public.app_is_cypress_admin()) with check (public.app_is_cypress_admin());

-- =============================================================
-- 店舗作成時に store_onboarding 行を自動生成するトリガー
-- environment は組織の is_demo / 名称から初期推定（後で管理画面から変更可能）。
-- =============================================================
create or replace function public.ensure_store_onboarding()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_demo boolean;
  v_org_name text;
  v_env text;
begin
  select is_demo, name into v_is_demo, v_org_name from public.organizations where id = new.organization_id;
  v_env := case
    when v_is_demo then 'demo'
    when v_org_name like '[PILOT]%' then 'test'
    else 'production'
  end;
  insert into public.store_onboarding (store_id, organization_id, environment, stage)
  values (new.id, new.organization_id, v_env, 'draft')
  on conflict (store_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_ensure_store_onboarding on public.stores;
create trigger trg_ensure_store_onboarding
  after insert on public.stores
  for each row execute function public.ensure_store_onboarding();

-- 既存店舗のbackfill（is_demo→demo / [PILOT]→test / その他→production）
insert into public.store_onboarding (store_id, organization_id, environment, stage)
select s.id, s.organization_id,
  case when o.is_demo then 'demo' when o.name like '[PILOT]%' then 'test' else 'production' end,
  'draft'
from public.stores s
join public.organizations o on o.id = s.organization_id
on conflict (store_id) do nothing;
