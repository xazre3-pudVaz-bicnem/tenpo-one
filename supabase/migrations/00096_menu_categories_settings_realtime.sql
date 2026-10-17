-- =============================================================
-- iPad（メニュー設定）でカテゴリやメニューブックを変えたら、ハンディ・レジにもすぐ出す
-- （2026-10-17 Ronnie「iPad のメニューを変えたら、どこでも自動で変わるように。メニューもカテゴリも」）
--
-- menu_items は 00089 で Realtime に載せた。カテゴリ（追加・並び替え・名前）と
-- store_settings（メニューブックの出し方・ページ・ランチ時間）も載せる。
-- RLS で購読者は自社の行だけ受け取る。
-- =============================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.menu_categories;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.store_settings;
  exception when duplicate_object then null;
  end;
end $$;
