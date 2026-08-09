-- =============================================================
-- 00035 で apply_punch を CREATE OR REPLACE した際、関数のEXECUTE権限が
-- デフォルト（PUBLIC/anon/authenticated へ付与）へリセットされ、
-- 00034 の anon 剥奪が取り消されていた。anon からの直接実行を再度遮断する。
-- 注意: 今後 apply_punch を再定義する場合は、必ず直後にこのREVOKEを再適用すること。
-- =============================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_punch'
  loop
    execute format('revoke execute on function %s from anon', r.sig);
  end loop;
end $$;
