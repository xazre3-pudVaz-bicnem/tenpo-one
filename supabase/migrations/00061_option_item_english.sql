-- セット商品の選択肢（カレーの種類・ナン/ご飯・ドリンク等）を厨房伝票へ英語で印字するため、
-- 選択肢そのものにも英語名を持たせる（商品・カテゴリは 00048 で対応済み）。
-- 未設定なら日本語のみ印字する（表示側でフォールバック）。
alter table public.menu_option_items add column if not exists name_en text;
