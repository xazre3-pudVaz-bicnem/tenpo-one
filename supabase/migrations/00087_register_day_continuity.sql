-- =============================================================
-- レジの1営業日の流れ（2026-09-28 Ronnie）
--
--   ① ログイン → 前の営業日のレジが閉まっていれば「開局」。閉まっていなければ開局は出さず、前の営業日のまま続ける
--   ② 開局：レジの中の現金を数える。前回のレジクローズで残した額（翌準備金）と比べ、違えば ± と理由を残す
--   ③ 営業（売上・入出金）
--   ④ レジ精算：現金を数える → 翌準備金（レジに残す額）と 預入金（銀行・預り金）を出す
--   ⑤ 営業日完了（レジ精算のあとだけ）→ ログアウト → 翌日の開局
--
-- 1) register_sessions に 開局の比較（opening_expected / opening_difference / opening_difference_reason）と
--    締めの分け方（next_float / deposit_amount）を持つ。どれも NULL 可（前からのデータは NULL のまま）
-- 2) app_business_date：開いたままのレジがあれば、その営業日を続ける。
--    ただし2日以上前から開きっぱなしのものは続けない（締め忘れで何日分も1日にまとまらないように）。
--    → 前日まで：前の営業日のまま / それより古い：今日の日付（画面に「閉まっていないレジ」の警告を出す）
-- 3) close_register_session：翌準備金 ＝ min(数えた現金, 目標)。預入金 ＝ 数えた現金 − 翌準備金。
--    目標は 店舗設定 registerReport.nextFloat（円）、無ければ その日の釣銭準備金（開局の額）
-- 4) open_register_session：前回のレジクローズの翌準備金と比べる。違えば理由が必須（OPENING_REASON_REQUIRED）。
--    前回に翌準備金の記録が無い（この migration より前の締め）ときは比べない
--    引数を1つ足すので、旧シグネチャは drop してから作る（PostgREST の曖昧一致を防ぐ。00065 と同じ）
--
-- 始める日：営業日 2026-09-28 から（Ronnie「9/27 のレジは 9/28 に続けない」「今日 9/28 からはレジ精算をしないと次の日に開かない」）。
--   それより前の営業日のレジは続けない・開局で比べない（lib/register-day.ts の REGISTER_DAY_FLOW_FROM と同じ日付）
-- =============================================================

alter table public.register_sessions
  add column if not exists opening_expected integer,
  add column if not exists opening_difference integer,
  add column if not exists opening_difference_reason text,
  add column if not exists next_float integer,
  add column if not exists deposit_amount integer;

comment on column public.register_sessions.opening_expected is '開局時の比較元：前回のレジクローズで残した翌準備金（無ければ NULL）';
comment on column public.register_sessions.opening_difference is '開局時の過不足 ＝ 数えた釣銭準備金 − 前回の翌準備金';
comment on column public.register_sessions.opening_difference_reason is '開局時の過不足の理由';
comment on column public.register_sessions.next_float is 'レジクローズ時に翌日のためレジに残す額（翌準備金）';
comment on column public.register_sessions.deposit_amount is 'レジクローズ時にレジから出す額（銀行・預り金）';

-- ---------------------------------------------------------------
-- 営業日：開いたままのレジ（前日まで）があればその営業日を続ける
-- ---------------------------------------------------------------
create or replace function public.app_business_date(p_store_id uuid)
returns date language sql stable security definer set search_path = public as $$
  with c as (
    select ((now() at time zone 'Asia/Tokyo')
            - make_interval(hours => coalesce(
                (select business_day_start_hour from public.store_settings where store_id = p_store_id), 0)))::date as clock
  )
  select coalesce(
    (select max(rs.business_date) from public.register_sessions rs, c
      where rs.store_id = p_store_id and rs.status = 'open'
        and rs.business_date between c.clock - 1 and c.clock
        and rs.business_date >= date '2026-09-28'),
    (select clock from c));
$$;

-- ---------------------------------------------------------------
-- open_register_session（+ p_opening_difference_reason）
-- ---------------------------------------------------------------
drop function if exists public.open_register_session(uuid, uuid, integer, jsonb);

create or replace function public.open_register_session(
  p_store_id uuid, p_register_id uuid, p_opening_float integer,
  p_opening_denominations jsonb default null, p_opening_difference_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_id uuid;
  v_expected integer;
  v_diff integer;
  v_reason text := nullif(btrim(coalesce(p_opening_difference_reason, '')), '');
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

  -- 前回のレジクローズ（この店舗で一番新しい締め）で残した翌準備金と比べる（営業日 2026-09-28 から）
  if public.app_business_date(p_store_id) >= date '2026-09-28' then
    select rs.next_float into v_expected
    from public.register_sessions rs
    where rs.store_id = p_store_id and rs.status in ('closed', 'approved') and rs.closed_at is not null
    order by rs.closed_at desc
    limit 1;
  end if;

  if v_expected is not null then
    v_diff := p_opening_float - v_expected;
    if v_diff <> 0 and v_reason is null then
      raise exception 'OPENING_REASON_REQUIRED';
    end if;
  end if;

  insert into public.register_sessions
    (organization_id, store_id, register_id, business_date, opened_by, opening_float, opening_denominations,
     opening_expected, opening_difference, opening_difference_reason, created_by)
  values
    (v_store.organization_id, p_store_id, p_register_id,
     public.app_business_date(p_store_id), auth.uid(), p_opening_float, p_opening_denominations,
     v_expected, v_diff, case when coalesce(v_diff, 0) <> 0 then v_reason else null end, auth.uid())
  returning id into v_id;

  if coalesce(v_diff, 0) <> 0 then
    perform public.log_audit(v_store.organization_id, p_store_id, 'register.open_difference',
      'register_sessions', v_id::text, null,
      jsonb_build_object('expected', v_expected, 'counted', p_opening_float, 'difference', v_diff),
      v_reason);
  end if;

  return jsonb_build_object('ok', true, 'session_id', v_id,
    'expected', v_expected, 'difference', v_diff);
end $$;

-- ---------------------------------------------------------------
-- close_register_session：計算は 00065 と同じ。締めたあとに 翌準備金 と 預入金 を記録する
-- （引数は変えない）
-- ---------------------------------------------------------------
create or replace function public.close_register_session(
  p_session_id uuid, p_counted_cash integer, p_difference_reason text default null, p_counted_denominations jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_session public.register_sessions%rowtype;
  v_expected integer;
  v_diff integer;
  v_sales integer; v_refunds integer; v_deposit integer; v_withdrawal integer;
  v_target integer;
  v_next integer;
  v_bank integer;
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

  -- 翌準備金の目標：店舗設定（registerReport.nextFloat）→ 無ければ その日の釣銭準備金
  select case when (s.settings->'registerReport'->>'nextFloat') ~ '^[0-9]+$'
              then (s.settings->'registerReport'->>'nextFloat')::integer end
  into v_target
  from public.store_settings s where s.store_id = v_session.store_id;
  v_target := coalesce(v_target, v_session.opening_float);
  v_next := least(p_counted_cash, v_target);
  v_bank := p_counted_cash - v_next;

  update public.register_sessions
  set status = 'closed', closed_by = auth.uid(), closed_at = now(),
      expected_cash = v_expected, counted_cash = p_counted_cash,
      counted_denominations = p_counted_denominations,
      difference = v_diff, difference_reason = p_difference_reason,
      next_float = v_next, deposit_amount = v_bank,
      updated_by = auth.uid()
  where id = p_session_id;

  perform public.log_audit(v_session.organization_id, v_session.store_id, 'register.close',
    'register_sessions', p_session_id::text, null,
    jsonb_build_object('expected', v_expected, 'counted', p_counted_cash, 'difference', v_diff,
                       'cash_sales', v_sales, 'cash_refunds', v_refunds,
                       'next_float', v_next, 'deposit', v_bank, 'next_float_target', v_target),
    p_difference_reason);

  return jsonb_build_object('ok', true, 'session_id', p_session_id,
    'expected', v_expected, 'counted', p_counted_cash, 'difference', v_diff,
    'next_float', v_next, 'deposit', v_bank, 'next_float_target', v_target);
end $$;

-- 権限は 00065 と同じ（PUBLIC/anon から剥奪、authenticated/service_role へ付与）
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
