-- =============================================================
-- 支払方法に 'site_points'（グルメサイトのポイント。ホットペッパー・ぐるなび・食べログ等）を追加。
--
-- 自社ポイント（'points'）は finalize_order がお客様の point_balance を減らすため、
-- グルメサイトのポイントを 'points' で入れてはいけない（他人のポイントが減る）。
-- 売上の内訳としても分けたいので別の支払方法にする。
-- どのサイトのポイントかは payments.provider（既存の列）に入れる（会計確定のあとサーバー側で書く）。
--
-- 店舗要望 2026-09-24「ポイントも ホットペッパー・ぐるなび・食べログ などから選べるように」
-- =============================================================
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash','credit','qr','emoney','voucher','on_account','points','other','external','site_points'));

alter table public.refunds drop constraint if exists refunds_method_check;
alter table public.refunds add constraint refunds_method_check
  check (method in ('cash','credit','qr','emoney','voucher','on_account','points','other','external','site_points'));
