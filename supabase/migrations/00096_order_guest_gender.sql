-- =============================================================
-- 伝票の来店人数の内訳（女性・男性）
-- 2026-10-17 Ronnie「QR を読んだら、Air レジのように人数（Girls / Boys）を選んでから注文へ」
--
-- お客様QRの最初の画面で選んだ女性・男性の人数を伝票に残す（合計は今までどおり guest_count）。
-- レジで着席した伝票など、内訳が分からない伝票は null のまま。
-- 書き込むのは app/api/qr/start（サーバー・service role）だけ。列が無いあいだは内訳を入れずに動く。
-- =============================================================

alter table public.orders
  add column if not exists guest_female integer check (guest_female is null or guest_female between 0 and 999),
  add column if not exists guest_male integer check (guest_male is null or guest_male between 0 and 999);

comment on column public.orders.guest_female is '来店人数のうち女性（QR の最初の画面で選んだ人数。分からなければ null）';
comment on column public.orders.guest_male is '来店人数のうち男性（QR の最初の画面で選んだ人数。分からなければ null）';
