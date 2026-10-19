-- =============================================================
-- 予約受付管理（2026-10-19 Ronnie「レストランボードの予約受付管理のように：新しいネット予約・変更・キャンセルを
-- お店が確認したら消える」）
--
-- reservations.acknowledged_at：お店が「確認済み」にした時刻（ネット予約・グルメサイトのメールで入った予約、
-- お客様のキャンセル）。null のあいだは予約受付管理に出る。
-- 列の追加だけ。既存の予約は「確認済み」にしておく（いまある予約が全部「未確認」で並ばないように）。
-- =============================================================

alter table public.reservations
  add column if not exists acknowledged_at timestamptz;

comment on column public.reservations.acknowledged_at is 'お店が予約受付管理で確認した時刻。2026-10-19';

update public.reservations
   set acknowledged_at = coalesce(acknowledged_at, now())
 where acknowledged_at is null
   and created_at < now();
