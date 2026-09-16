-- =============================================================
-- 00052 の取りこぼし回収
--
-- 00052 では「organization_id と store_id を両方持つテーブル」を店舗単位
-- （store_id = 対象店舗）で移したが、bank_accounts や audit_logs のように
-- store_id が NULL の「会社レベルの行」は条件に合わず旧組織に残った。
--   bank_accounts 10件（D&DREAM名義の口座）/ audit_logs 12件
--
-- ここでは旧組織に残っている行を、テーブルを問わず全て D&DREAM へ移す。
-- feature_flags / saas_subscriptions は旧組織の契約情報のため対象外（00052と同じ方針）。
-- =============================================================

do $$
declare
  v_fogo uuid := 'c4e821e6-b5f3-4f3c-b6c9-5eceab4dc1c7';
  v_dd   uuid := '2fbd102b-f0c7-4c9b-b3ff-188e1f68d3d8';
  r record;
  v_moved int;
  v_total int := 0;
begin
  if not exists (select 1 from public.organizations where id = v_fogo)
     or not exists (select 1 from public.organizations where id = v_dd) then
    raise notice 'FOGO統合(残り): 対象が見つからないためスキップします';
    return;
  end if;

  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and c.column_name = 'organization_id'
       and c.table_name not in ('feature_flags', 'saas_subscriptions')
     order by c.table_name
  loop
    execute format(
      'update public.%I set organization_id = %L where organization_id = %L',
      r.table_name, v_dd, v_fogo);
    get diagnostics v_moved = row_count;
    if v_moved > 0 then
      raise notice 'FOGO統合(残り): % を % 件移動', r.table_name, v_moved;
      v_total := v_total + v_moved;
    end if;
  end loop;

  raise notice 'FOGO統合(残り): 合計 % 行を移動', v_total;
end $$;
