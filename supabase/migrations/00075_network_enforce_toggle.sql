-- お店の回線（IP）の制限を、運営がON/OFFできるようにする（2026-09-23 要望）。
--
-- 回線を登録しても、現場では回線が変わったり iPhone のプライベートリレーで
-- はじかれたりして手間がかかる。まずは 企業番号＋店舗ユーザー名＋パスワード で
-- 開けるようにして、回線の制限は運営が必要だと判断したときだけONにする。
--
-- 既定はOFF（＝うっかり店が開けなくなる事故を起こさない）。
-- 台数（レジ・ハンディ）の制限は、回線のON/OFFとは切り離して、
-- 契約（store_access_policies の行）がある店舗に効く。

alter table public.store_access_policies
  add column if not exists network_enforced boolean not null default false;

comment on column public.store_access_policies.network_enforced is
  'お店の回線からだけ使えるようにするか（運営が切り替える。既定はOFF）';

-- いま登録されている回線は、いったんOFFにする（運営が必要なときにONにする）
update public.store_access_policies set network_enforced = false where network_enforced;
