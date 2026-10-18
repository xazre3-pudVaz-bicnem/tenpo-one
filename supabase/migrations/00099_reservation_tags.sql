-- =============================================================
-- 予約のキーワード（2026-10-19 Ronnie「レストランボードのようにキーワード（複数選択）」）
--
-- reservations.tags：当日予約・クーポン利用・個室希望・要連絡 など（複数）。
-- 列の追加だけ。既存の予約・データは変えない・消さない（既定は空の配列）。
-- キーワードの一覧は店舗ごとに store_settings.settings.reservation_keywords（無ければアプリの既定）。
-- =============================================================

alter table public.reservations
  add column if not exists tags text[] not null default '{}'::text[];

comment on column public.reservations.tags is '予約のキーワード（複数）。2026-10-19';

create index if not exists idx_reservations_tags on public.reservations using gin (tags);
