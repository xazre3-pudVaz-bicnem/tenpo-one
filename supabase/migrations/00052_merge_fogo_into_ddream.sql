-- =============================================================
-- FOGO De BRASIA 新宿 の組織統合（1回きりのデータ移行）
--
-- 背景: 4店舗は「株式会社D&DREAM」組織、FOGO新宿店とその会社の経理基盤
--       （銀行口座10・取引先14・経費科目5・勘定科目カスタム）は別組織に
--       分かれていた。両者を D&DREAM に統合し、旧組織を解約する。
--
-- 方針:
--   - 店舗ID・slug は変更しない（公開予約URL・CloudPRNTのポーリングURLを維持）
--   - 勘定科目は D&DREAM 側の同コードへ参照を付け替えて重複を解消し、科目表を1本化
--   - メンバーは全員 D&DREAM へ移し、status を active にする
--   - マイグレーションはトランザクションで実行されるため、途中で失敗すれば全て巻き戻る
--
-- 対象が存在しない環境（新規構築・ローカル）では何もしない（べき等）。
-- =============================================================

do $$
declare
  v_fogo uuid := 'c4e821e6-b5f3-4f3c-b6c9-5eceab4dc1c7';
  v_dd   uuid := '2fbd102b-f0c7-4c9b-b3ff-188e1f68d3d8';
  v_store uuid := '49940cf6-702d-4205-b062-55b6b99c1907';
  r record;
  v_moved int;
begin
  -- 両組織と対象店舗が揃っている環境でのみ実行する
  if not exists (select 1 from public.organizations where id = v_fogo)
     or not exists (select 1 from public.organizations where id = v_dd)
     or not exists (select 1 from public.stores where id = v_store and organization_id = v_fogo) then
    raise notice 'FOGO統合: 対象が見つからないためスキップします';
    return;
  end if;

  -- -----------------------------------------------------------
  -- 1) 勘定科目の参照を D&DREAM 側の同コードへ付け替える
  --    （accounts は unique(organization_id, code) のため、そのまま移すと衝突する）
  --    accounts を参照するのは以下の3列のみ（00020）。
  -- -----------------------------------------------------------
  update public.journal_entry_lines l
     set account_id = d.id
    from public.accounts f
    join public.accounts d on d.organization_id = v_dd and d.code = f.code
   where f.organization_id = v_fogo and l.account_id = f.id;

  update public.bank_accounts b
     set account_id = d.id
    from public.accounts f
    join public.accounts d on d.organization_id = v_dd and d.code = f.code
   where f.organization_id = v_fogo and b.account_id = f.id;

  update public.expense_accounts e
     set account_id = d.id
    from public.accounts f
    join public.accounts d on d.organization_id = v_dd and d.code = f.code
   where f.organization_id = v_fogo and e.account_id = f.id;

  -- 2) D&DREAM に無いコードの科目だけを移動（FOGO固有のカスタム科目）
  update public.accounts a
     set organization_id = v_dd
   where a.organization_id = v_fogo
     and not exists (
       select 1 from public.accounts d where d.organization_id = v_dd and d.code = a.code
     );
  get diagnostics v_moved = row_count;
  raise notice 'FOGO統合: 固有の勘定科目を移動 % 件', v_moved;

  -- 3) 参照が無くなった重複科目を削除
  delete from public.accounts where organization_id = v_fogo;
  get diagnostics v_moved = row_count;
  raise notice 'FOGO統合: 重複した勘定科目を削除 % 件', v_moved;

  -- -----------------------------------------------------------
  -- 4) 店舗本体の所属を変更（IDとslugは維持）
  -- -----------------------------------------------------------
  update public.stores set organization_id = v_dd where id = v_store;

  -- -----------------------------------------------------------
  -- 5) 店舗単位のデータ（organization_id と store_id を両方持つ全テーブル）
  -- -----------------------------------------------------------
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'organization_id'
       and exists (
         select 1 from information_schema.columns c2
          where c2.table_schema = 'public' and c2.table_name = c.table_name and c2.column_name = 'store_id'
       )
     order by c.table_name
  loop
    execute format(
      'update public.%I set organization_id = %L where store_id = %L and organization_id = %L',
      r.table_name, v_dd, v_store, v_fogo);
  end loop;

  -- -----------------------------------------------------------
  -- 6) 会社単位のデータ（store_id を持たないテーブル）
  --    accounts は上で処理済み。memberships は status も変えるため個別。
  --    feature_flags / saas_subscriptions は旧組織の契約情報なので移さない。
  -- -----------------------------------------------------------
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'organization_id'
       and not exists (
         select 1 from information_schema.columns c2
          where c2.table_schema = 'public' and c2.table_name = c.table_name and c2.column_name = 'store_id'
       )
       and c.table_name not in ('accounts', 'memberships', 'feature_flags', 'saas_subscriptions')
     order by c.table_name
  loop
    execute format(
      'update public.%I set organization_id = %L where organization_id = %L',
      r.table_name, v_dd, v_fogo);
  end loop;

  -- -----------------------------------------------------------
  -- 7) メンバーを移し、全員を利用可能（active）にする
  --    status が active でないとアプリもRLSも通らないため（app_is_org_member）。
  -- -----------------------------------------------------------
  update public.memberships
     set organization_id = v_dd, status = 'active'
   where organization_id = v_fogo;
  get diagnostics v_moved = row_count;
  raise notice 'FOGO統合: メンバーを移動・有効化 % 件', v_moved;

  -- -----------------------------------------------------------
  -- 8) 旧組織を解約（履歴を残すため削除はしない）
  -- -----------------------------------------------------------
  update public.organizations set status = 'cancelled' where id = v_fogo;

  raise notice 'FOGO統合: 完了';
end $$;
