-- =============================================================
-- printer_configs.upside_down を追加する。
--
-- プリンターを逆向き（上下さかさま）に取り付けている店舗では、伝票の文字が
-- さかさまに出てしまう（2026-09-25 店舗報告）。プリンター機種に頼らず、
-- 印字するデータの方を180度回して出せるようにする。
--   true  … 行の並びを逆にし、1行の文字も逆順にして出す（さかさまに読むと正しく見える）
--   false … これまでどおり
-- =============================================================
alter table public.printer_configs
  add column if not exists upside_down boolean not null default false;

comment on column public.printer_configs.upside_down is
  'プリンターを上下さかさまに取り付けているとき true。印字を180度回して出す';
