-- =============================================================
-- CloudPRNT（Star mC-Print3 等）連携
--   プリンタが当方サーバをHTTPSでポーリングし、キューにある印刷ジョブを取得・印字する方式。
--   HTTPSクラウドのTENPO ONEと相性が良く（WebPRNTのMixed Content問題を回避）、
--   店舗LAN情報が不要。レシート印字とキャッシュドロアのキックをこの経路で行う。
-- =============================================================

-- pgcrypto（gen_random_bytes）はSupabaseでは extensions スキーマに存在。
-- スキーマ修飾（extensions.gen_random_bytes）で呼び出す。

-- -------------------------------------------------------------
-- printer_configs: CloudPRNT設定
-- -------------------------------------------------------------
alter table public.printer_configs
  add column if not exists cloudprnt_enabled boolean not null default false,
  -- プリンタのポーリングURLに埋め込む店舗別トークン（推測不能・行ごとに一意）。
  add column if not exists cloudprnt_token text,
  add column if not exists mac_address text,
  -- ドロアキックの印字コマンド。機種/ファームでMarkup方言が異なる場合に無停止で調整できるよう可変。
  add column if not exists drawer_command text not null default '[drawer: 1]',
  add column if not exists poll_interval_seconds integer not null default 5,
  add column if not exists last_polled_at timestamptz;

-- 既存行と新規行にトークンを付与（NULLのみ生成）。以後もNULLなら生成される既定値を設定。
update public.printer_configs
  set cloudprnt_token = encode(extensions.gen_random_bytes(24), 'hex')
  where cloudprnt_token is null;
alter table public.printer_configs
  alter column cloudprnt_token set default encode(extensions.gen_random_bytes(24), 'hex');

create unique index if not exists idx_printer_configs_cloudprnt_token
  on public.printer_configs(cloudprnt_token)
  where cloudprnt_token is not null;

-- -------------------------------------------------------------
-- print_jobs: CloudPRNTジョブキュー化
--   status に 'claimed'（プリンタが取得中＝GET受領〜DELETE確定待ち）を追加。
--   target に 'cloudprnt' を追加。content_type/claimed_at を追加。
--   ジョブ本文（Star Document Markup等）は payload.body に格納する。
-- -------------------------------------------------------------
alter table public.print_jobs drop constraint if exists print_jobs_status_check;
alter table public.print_jobs
  add constraint print_jobs_status_check
  check (status in ('queued','claimed','printed','failed'));

alter table public.print_jobs drop constraint if exists print_jobs_target_check;
alter table public.print_jobs
  add constraint print_jobs_target_check
  check (target in ('browser','sdk','cloudprnt'));

alter table public.print_jobs
  add column if not exists content_type text,
  add column if not exists claimed_at timestamptz;

-- ポーリングで「最古のqueuedを1件」取り出す用途のインデックス。
create index if not exists idx_print_jobs_poll
  on public.print_jobs(store_id, status, created_at);
