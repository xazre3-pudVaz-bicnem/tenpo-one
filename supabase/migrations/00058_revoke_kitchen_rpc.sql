-- =============================================================
-- 00054/00055/00057 の実行権限の是正
--
-- Supabase は public スキーマの関数に anon / authenticated へ個別に EXECUTE を付与するため、
-- `revoke ... from public` だけでは anon から実行できてしまう（検証で確認）。
-- 00037 と同じく public と anon の両方から剥奪し、必要なロールへ明示的に付与する。
--
--   claim_kitchen_items … プリンタのエンドポイント（サービスロール）専用。
--                         匿名に開いていると、任意店舗の厨房明細を読めるうえ
--                         「伝達済み」にして伝票を消せてしまう。
--   get_best_sellers    … ログインユーザー向け（関数内で店舗アクセスを検証済み）。
-- =============================================================

revoke execute on function public.claim_kitchen_items(uuid, integer, integer) from public;
revoke execute on function public.claim_kitchen_items(uuid, integer, integer) from anon;
revoke execute on function public.claim_kitchen_items(uuid, integer, integer) from authenticated;
grant execute on function public.claim_kitchen_items(uuid, integer, integer) to service_role;

revoke execute on function public.get_best_sellers(uuid, integer, integer) from public;
revoke execute on function public.get_best_sellers(uuid, integer, integer) from anon;
grant execute on function public.get_best_sellers(uuid, integer, integer) to authenticated, service_role;
