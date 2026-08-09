-- =============================================================
-- SECURITY: profiles.pin_code（scryptハッシュ）のカラム露出を封鎖（監査 G-2）
-- 従来 profiles_select は同一組織のアクティブメンバー全員に他者行の閲覧を許可し、
-- PostgREST `?select=pin_code` で同僚のPINハッシュ（4-6桁の低エントロピー秘密）を
-- 取得できた。認証ユーザーはPINハッシュを一切必要としない（照合は service role 経由）。
--
-- 対応: 「設定済み/未設定」判定用の has_pin 生成列を追加し、
-- authenticated/anon には pin_code を除く列のみ SELECT を許可する。
-- service_role（PIN照合の admin client）は従来どおり pin_code を読める。
-- =============================================================

-- 設定有無だけを公開する生成列
alter table public.profiles
  add column if not exists has_pin boolean generated always as (pin_code is not null) stored;

-- pin_code を除く列のみ authenticated/anon に SELECT 許可
revoke select on public.profiles from authenticated, anon;
grant select (id, display_name, display_name_kana, phone, is_cypress_admin, status,
              created_at, updated_at, has_pin)
  on public.profiles to authenticated, anon;

-- INSERT/UPDATE は既存の grant（と 00031 の機密列変更禁止トリガー）を維持。
-- service_role は明示 revoke していないため pin_code を含む全列にアクセス可能。
