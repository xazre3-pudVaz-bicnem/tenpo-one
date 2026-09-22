-- =============================================================
-- レシートプリンターの「担当フロア」
--
-- 背景: 複数フロアの店（SHUNKA 新宿: 4F=受付・会計、3F・5F=客席＋会計伝票を出す場所）で、
--       会計伝票（中間伝票・QR注文のお会計伝票）をその卓のフロアのプリンターから出したい。
--
-- 方式: printer_configs.floor_ids（floors.id の配列）。空配列＝担当フロアなし＝店の既定プリンター。
--       - 担当フロアのあるプリンター … そのフロアの卓の会計伝票だけ
--       - 既定プリンター … 担当のいないフロア・フロア未割当の卓・レシート（会計確定）・ドロア
--       既存のプリンターはすべて空配列（＝今まで通りの動き）。判定は lib/printer-floors.ts。
-- =============================================================

alter table public.printer_configs
  add column if not exists floor_ids uuid[] not null default '{}'::uuid[];

comment on column public.printer_configs.floor_ids is
  '担当フロア（floors.id）。空＝既定プリンター。会計伝票はその卓のフロア担当のプリンターから出す（lib/printer-floors.ts）';
