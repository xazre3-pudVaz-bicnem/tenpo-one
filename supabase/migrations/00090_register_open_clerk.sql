-- =============================================================
-- レジ開局の担当者（2026-09-29 Ronnie「レジ精算の日付の横に、レジを開けた時間と担当を」）
--
-- レジ端末は店舗の共用アカウント（「<店舗名>（レジ）」）でログインしているので、opened_by は人ではない。
-- 開局の画面で選ばれている POS 担当者（clerk gate）の名前を残す。
--   register_sessions.opened_clerk_name … 開局した担当者の名前（NULL 可。前からのデータは NULL）
--   set_register_open_clerk(session, name) … 開局の直後にアプリから呼ぶ。開いているセッションだけ・同じ店舗の人だけ
-- =============================================================

alter table public.register_sessions
  add column if not exists opened_clerk_name text;

comment on column public.register_sessions.opened_clerk_name is '開局した担当者（POS担当者の名前）';

create or replace function public.set_register_open_clerk(p_session_id uuid, p_clerk_name text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_session public.register_sessions%rowtype;
  v_name text := left(nullif(btrim(coalesce(p_clerk_name, '')), ''), 60);
begin
  select * into v_session from public.register_sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.app_role_in(v_session.organization_id,
      array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff'])
     or not public.app_has_store_access(v_session.organization_id, v_session.store_id) then
    raise exception 'FORBIDDEN';
  end if;
  if v_session.status <> 'open' then raise exception 'SESSION_NOT_OPEN'; end if;
  update public.register_sessions set opened_clerk_name = v_name where id = p_session_id;
end $$;

revoke execute on function public.set_register_open_clerk(uuid, text) from public, anon;
grant execute on function public.set_register_open_clerk(uuid, text) to authenticated, service_role;
