-- Star CloudPRNT の問い合わせ間隔の標準を 5 秒 → 1 秒に（2026-10-25 Ronnie「LAN ko late hunxa」「aba bata default nai 1 sec」）。
-- 新しく追加するプリンターは 1 秒。今のプリンターのうち、標準の 5 秒のまま（だれも変えていない）ものも 1 秒にする。
-- 対応機には GET /api/cloudprnt/cloudprnt-setting.json でこの値が届く（lib/cloudprnt-setting.ts）。
-- 00103・00104 のあとに流す。何回流しても同じ結果。

alter table public.printer_configs
  alter column poll_interval_seconds set default 1;

update public.printer_configs
  set poll_interval_seconds = 1
  where poll_interval_seconds = 5;
