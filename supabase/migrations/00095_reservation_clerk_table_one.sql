-- =============================================================
-- 予約の担当者をレジの担当名（pos_clerks）にする・TABLE ONE の予約経路（2026-10-15 Ronnie）
--
-- 1) 「台帳の担当者は端末（ログイン）ではなく、レジの担当名（Sankar・Miyazaki…）。レジと台帳は同じ」
--    reservations.clerk_id（pos_clerks）と clerk_name（その時点の名前を残す。担当者を消しても名前は残る）
--    既存の staff_id（ログインアカウント）はそのまま残す（消さない・書き換えない）
-- 2) 「TABLE ONE から来た予約の経路は TABLE ONE」
--    共通の予約経路に table_one（TABLE ONE）を追加。これまで TABLE ONE からの予約は
--    「グルメサイト（gourmet_site）」で入っていたので、Web予約（created_via='web'）で
--    グルメサイトになっているものだけ TABLE ONE に付け替える（予約そのものは変えない）
-- 列の追加と経路の追加だけ。既存の予約・データは消さない。
-- =============================================================

alter table public.reservations
  add column if not exists clerk_id uuid references public.pos_clerks(id) on delete set null,
  add column if not exists clerk_name text;

create index if not exists idx_reservations_clerk on public.reservations(clerk_id);

comment on column public.reservations.clerk_id is '予約の担当者（レジの担当名 pos_clerks）。2026-10-15';
comment on column public.reservations.clerk_name is '予約の担当者の名前（選んだ時点の名前を残す）';

insert into public.reservation_sources (organization_id, code, name, sort_order)
select null, 'table_one', 'TABLE ONE', 22
where not exists (
  select 1 from public.reservation_sources rs
  where rs.code = 'table_one' and rs.organization_id is null
);

update public.reservations r
   set source_id = (select id from public.reservation_sources where code = 'table_one' and organization_id is null)
 where r.created_via = 'web'
   and r.source_id = (select id from public.reservation_sources where code = 'gourmet_site' and organization_id is null);
