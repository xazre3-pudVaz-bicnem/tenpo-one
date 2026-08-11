-- =============================================================
-- 支払方法に 'external'（外部キャッシュレス端末。stera JT-C60 等）を追加。
-- TENPO ONEは金額を表示し、スタッフが外部端末で決済成功を確認してから会計確定する
-- 手動確認方式（ネイティブAPI連携なし）。売上区分として明示できるようにする。
-- =============================================================
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash','credit','qr','emoney','voucher','on_account','points','other','external'));

alter table public.refunds drop constraint if exists refunds_method_check;
alter table public.refunds add constraint refunds_method_check
  check (method in ('cash','credit','qr','emoney','voucher','on_account','points','other','external'));
