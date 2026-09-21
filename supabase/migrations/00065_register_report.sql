-- レジ精算レシート（dinii の「レジ精算」相当）と、開局・締め時の金種別枚数の保存。
--
-- 1) register_sessions に金種別の枚数（開局時の釣銭準備金・締め時の実査）を jsonb で持つ。
--    形式: {"1":0,"5":0,"10":3,"50":0,"100":10,"500":4,"1000":20,"5000":2,"10000":30}（金種→枚数）
-- 2) open_register_session / close_register_session に省略可能な jsonb 引数を追加する。
--    既存の3引数・2引数の呼び出しはそのまま動く（default null）。
--    ※ 同名関数の多重定義を避けるため、旧シグネチャは先に drop する（PostgREST の曖昧一致エラー防止）。
-- 3) print_jobs.job_type に 'register_report'（レジ精算レシート）を追加する。

alter table public.register_sessions
  add column if not exists opening_denominations jsonb,
  add column if not exists counted_denominations jsonb;

comment on column public.register_sessions.opening_denominations is '開局時に数えた釣銭準備金の金種別枚数（金種→枚数）';
comment on column public.register_sessions.counted_denominations is '締め時に数えた実査の金種別枚数（金種→枚数）';

-- ---------------------------------------------------------------
-- open_register_session（+ p_opening_denominations）
-- ---------------------------------------------------------------
drop function if exists public.open_register_session(uuid, uuid, integer);

create or replace function public.open_register_session(
  p_store_id uuid, p_register_id uuid, p_opening_float integer, p_opening_denominations jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_id uuid;
begin
  select * into v_store from public.stores where id = p_store_id;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;
  if not public.app_role_in(v_store.organization_id,
      array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff']) then
    raise exception 'FORBIDDEN';
  end if;
  if exists (select 1 from public.register_sessions
             where register_id = p_register_id and status = 'open') then
    raise exception 'SESSION_ALREADY_OPEN';
  end if;
  insert into public.register_sessions
    (organization_id, store_id, register_id, business_date, opened_by, opening_float, opening_denominations, created_by)
  values
    (v_store.organization_id, p_store_id, p_register_id,
     public.app_business_date(p_store_id), auth.uid(), p_opening_float, p_opening_denominations, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'session_id', v_id);
end $$;

-- ---------------------------------------------------------------
-- close_register_session（+ p_counted_denominations）。計算ロジックは 00027 と同じ。
-- ---------------------------------------------------------------
drop function if exists public.close_register_session(uuid, integer, text);

create or replace function public.close_register_session(
  p_session_id uuid, p_counted_cash integer, p_difference_reason text default null, p_counted_denominations jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_session public.register_sessions%rowtype;
  v_expected integer;
  v_diff integer;
  v_sales integer; v_refunds integer; v_deposit integer; v_withdrawal integer;
begin
  select * into v_session from public.register_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.status <> 'open' then raise exception 'SESSION_NOT_OPEN'; end if;
  if not public.app_role_in(v_session.organization_id,
      array['org_owner','hq_admin','area_manager','store_manager','assistant_manager','staff']) then
    raise exception 'FORBIDDEN';
  end if;

  select
    coalesce(sum(amount) filter (where kind = 'sale'), 0),
    coalesce(sum(amount) filter (where kind = 'refund'), 0),
    coalesce(sum(amount) filter (where kind in ('deposit','petty_in')), 0),
    coalesce(sum(amount) filter (where kind in ('withdrawal','petty_out')), 0)
  into v_sales, v_refunds, v_deposit, v_withdrawal
  from public.cash_transactions
  where register_session_id = p_session_id and status = 'active';

  v_expected := v_session.opening_float + v_sales - v_refunds + v_deposit - v_withdrawal;
  v_diff := p_counted_cash - v_expected;

  update public.register_sessions
  set status = 'closed', closed_by = auth.uid(), closed_at = now(),
      expected_cash = v_expected, counted_cash = p_counted_cash,
      counted_denominations = p_counted_denominations,
      difference = v_diff, difference_reason = p_difference_reason,
      updated_by = auth.uid()
  where id = p_session_id;

  perform public.log_audit(v_session.organization_id, v_session.store_id, 'register.close',
    'register_sessions', p_session_id::text, null,
    jsonb_build_object('expected', v_expected, 'counted', p_counted_cash, 'difference', v_diff,
                       'cash_sales', v_sales, 'cash_refunds', v_refunds),
    p_difference_reason);

  return jsonb_build_object('ok', true, 'session_id', p_session_id,
    'expected', v_expected, 'counted', p_counted_cash, 'difference', v_diff);
end $$;

-- 権限は 00037 と同じ方針（PUBLIC/anon から剥奪、authenticated/service_role へ付与）。新シグネチャに再適用する。
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('open_register_session', 'close_register_session')
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- print_jobs.job_type に 'register_report' を追加
-- ---------------------------------------------------------------
alter table public.print_jobs
  drop constraint if exists print_jobs_job_type_check;

alter table public.print_jobs
  add constraint print_jobs_job_type_check
  check (job_type in ('receipt','ryoshusho','kitchen','test','order_slip','register_report'));
