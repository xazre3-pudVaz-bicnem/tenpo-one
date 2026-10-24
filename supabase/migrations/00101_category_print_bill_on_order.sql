-- =============================================================
-- 注文時に会計伝票を自動で印刷するカテゴリ（2026-10-23）
--
-- menu_categories.print_bill_on_order：このカテゴリの商品が入った注文を厨房へ送ったとき、
-- レジ（レシートプリンター）にも会計伝票（print_jobs.job_type='order_slip'）を1枚出す。
-- QR（お客様）・ハンディ・レジ のどの注文でも同じ。既定は false（今まで通り自動では出ない）。
-- どのカテゴリを ON にするかは 設定 > カテゴリ で店ごとに選ぶ。列の追加だけ。
-- =============================================================

alter table public.menu_categories
  add column if not exists print_bill_on_order boolean not null default false;

comment on column public.menu_categories.print_bill_on_order is
  '注文を厨房へ送ったとき、レジに会計伝票も自動で印刷する。2026-10-23';
