-- レジ用パスワードを運営がいつでも見られるようにする（2026-09-23 要望）。
--
-- 店から「パスワードを忘れた」と電話が来たときに、営業を止めずにその場で答えられるようにする。
-- 平文では置かず、サーバーの鍵で暗号化して置く（DBだけを見ても読めない）。
-- ログインの照合は今まで通りハッシュ（password_hash）で行う。

alter table public.store_register_credentials add column if not exists password_enc text;

comment on column public.store_register_credentials.password_enc is
  'レジ用パスワードの暗号文（AES-256-GCM。運営だけが画面で復号して見る）';
