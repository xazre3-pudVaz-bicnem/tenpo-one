-- =============================================================
-- コース予約 → POS 引継（二重計上防止）
-- 予約時に選択したコースを、着席後の注文作成時に「1回だけ」POSへ計上する。
-- course_posted_at が設定済みなら再計上しない（再着席・注文再作成でも二重にならない）。
-- 汎用機能（全店舗対象）。
-- =============================================================
alter table public.reservations
  add column if not exists course_posted_at timestamptz;

comment on column public.reservations.course_posted_at is
  'コース予約のコースをPOS注文へ計上した時刻。設定済みなら再計上しない（二重計上防止）。';
