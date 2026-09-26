-- レジ用アカウントの表示名「<店舗名>（レジ）」を、いまの店舗名に揃える
-- （2026-09-27 Ronnie「店舗名を FULLMOoN に変えたのにレジの名前が FOGO のまま」）。本番には 2026-09-27 に適用済み。
-- 以後は店舗情報の保存時にアプリ側（app/app/settings/store/actions.ts の renameRegisterAccount）で追従させる。
update public.profiles p
set display_name = s.name || '（レジ）'
from public.store_register_credentials c
join public.stores s on s.id = c.store_id
where c.profile_id = p.id
  and p.display_name like '%（レジ）'
  and p.display_name <> s.name || '（レジ）';
