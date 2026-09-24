-- =============================================================
-- POS担当者に「役職」を持たせる。
--
-- 店舗要望（2026-09-24）:
--   「レジ取消は店長または店長より上の人が必要」
-- レジ（iPad）は店舗共通のアカウントでログインしているため、誰が操作しているかは
-- ログインアカウントでは分からない。担当者（pos_clerks）側に役職を持たせ、
-- 取消のときだけ「店長以上の担当者」を選ばせて記録する。
--
-- 既存の担当者は全員 staff（スタッフ）から始まる。設定 > POS担当者 で変更する。
-- =============================================================
alter table public.pos_clerks
  add column if not exists role text not null default 'staff';

alter table public.pos_clerks
  drop constraint if exists pos_clerks_role_check;

alter table public.pos_clerks
  add constraint pos_clerks_role_check
  check (role in ('staff', 'assistant_manager', 'store_manager', 'area_manager', 'owner'));
