-- =============================================================
-- TENPO ONE — 00017: 店頭ウェイティング（waitlist_entries）のRealtime有効化
-- 予約台帳の「ウェイティング」タブが他端末の受付/呼出/案内を即時反映できるようにする
-- =============================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.waitlist_entries;
  exception when duplicate_object then null;
  end;
end $$;
