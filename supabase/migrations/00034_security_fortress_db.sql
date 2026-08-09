-- =============================================================
-- SECURITY FORTRESS — DB層の残存穴の是正（監査 HIGH/MEDIUM）
-- 1) apply_punch の p_via_pin バイパスで越境勤怠注入（HIGH）
-- 2) daily_closings に不変性が無い（HIGH）— RPC専用書込へ
-- 3) stock_movements / cash_transactions 台帳の直接改変（MEDIUM）— 追記専用へ
-- 4) 特権RPC群への anon デフォルトEXECUTE（MEDIUM）— anon から剥奪
--
-- 設計原則: 正規フローは SECURITY DEFINER RPC（関数オーナー権限で実行）または
-- service role（scripts/webhook）で行われるため、anon/authenticated から
-- 直接テーブル書込・直接RPC実行を剥奪しても正規動作は壊れない。
-- =============================================================

-- -------------------------------------------------------------
-- 1) apply_punch: p_via_pin を認証ユーザー文脈で信用しない + 店舗所属を必須化
--    - service role（auth.uid() is null。PIN打刻はapp層で権限+PIN検証済み）は従来どおり許可
--    - 認証ユーザーは「自店の自分の打刻」または「自店の管理者による代理」のみ
--    - anon は下の REVOKE で関数実行自体を遮断（多層防御）
-- 関数本体は既存(00016)と同一。認可ブロックのみ差し替え。
-- -------------------------------------------------------------
create or replace function public.apply_punch(
  p_store_id uuid, p_profile_id uuid, p_event_type text,
  p_source text default 'personal', p_via_pin boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_entry public.time_entries%rowtype;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_last_break public.time_entry_events%rowtype;
  v_break_min integer;
  v_note text := null;
begin
  select * into v_store from public.stores where id = p_store_id;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;

  -- 認可: 認証ユーザー文脈では p_via_pin を信用しない（PIN打刻は service role 経由のみ）
  if auth.uid() is not null then
    if not public.app_has_store_access(v_store.organization_id, p_store_id) then
      raise exception 'FORBIDDEN';
    end if;
    if p_profile_id <> auth.uid()
       and not public.app_role_in(v_store.organization_id,
         array['org_owner','hq_admin','area_manager','store_manager']) then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  -- auth.uid() is null（service role・PIN打刻はapp層で検証済み）は許可

  select * into v_entry from public.time_entries
  where profile_id = p_profile_id and store_id = p_store_id
    and work_date in (v_today, v_today - 1) and status = 'open'
  order by work_date desc, created_at desc limit 1;

  if p_event_type = 'clock_in' then
    if found and v_entry.clock_out_at is null then raise exception 'ALREADY_CLOCKED_IN'; end if;
    if exists (select 1 from public.time_entries
               where profile_id = p_profile_id and status = 'open' and clock_out_at is null
                 and work_date in (v_today, v_today - 1)) then
      raise exception 'ALREADY_CLOCKED_IN_ELSEWHERE';
    end if;
    insert into public.time_entries
      (organization_id, store_id, profile_id, work_date, clock_in_at, source, created_by)
    values (v_store.organization_id, p_store_id, p_profile_id, v_today, now(), p_source, auth.uid())
    returning * into v_entry;

  elsif p_event_type = 'clock_out' then
    if v_entry.id is null or v_entry.clock_in_at is null then raise exception 'NOT_CLOCKED_IN'; end if;
    if v_entry.on_break then
      select * into v_last_break from public.time_entry_events
      where time_entry_id = v_entry.id and event_type = 'break_start'
      order by occurred_at desc limit 1;
      if v_last_break.id is not null then
        v_break_min := ceil(extract(epoch from (now() - v_last_break.occurred_at)) / 60)::integer;
        v_note := '休憩未終了のまま退勤（休憩' || v_break_min || '分を自動確定）';
        update public.time_entries
        set break_minutes = break_minutes + v_break_min where id = v_entry.id;
      end if;
    end if;
    update public.time_entries
    set clock_out_at = now(), status = 'closed', on_break = false,
        note = case when v_note is not null
                    then coalesce(note || E'\n', '') || v_note else note end,
        updated_by = auth.uid()
    where id = v_entry.id;

  elsif p_event_type = 'break_start' then
    if v_entry.id is null then raise exception 'NOT_CLOCKED_IN'; end if;
    if v_entry.on_break then raise exception 'ALREADY_ON_BREAK'; end if;
    update public.time_entries set on_break = true where id = v_entry.id;

  elsif p_event_type = 'break_end' then
    if v_entry.id is null then raise exception 'NOT_CLOCKED_IN'; end if;
    if not v_entry.on_break then raise exception 'NOT_ON_BREAK'; end if;
    select * into v_last_break from public.time_entry_events
    where time_entry_id = v_entry.id and event_type = 'break_start'
    order by occurred_at desc limit 1;
    if v_last_break.id is not null then
      v_break_min := ceil(extract(epoch from (now() - v_last_break.occurred_at)) / 60)::integer;
      update public.time_entries
      set break_minutes = break_minutes + v_break_min, on_break = false
      where id = v_entry.id;
    else
      update public.time_entries set on_break = false where id = v_entry.id;
    end if;
  else
    raise exception 'INVALID_EVENT';
  end if;

  insert into public.time_entry_events
    (organization_id, store_id, profile_id, time_entry_id, event_type, source, via_pin)
  values
    (v_store.organization_id, p_store_id, p_profile_id, v_entry.id, p_event_type, p_source, p_via_pin);

  return jsonb_build_object('ok', true, 'entry_id', v_entry.id, 'event', p_event_type,
    'warning', v_note);
end $$;

-- -------------------------------------------------------------
-- 4) 特権RPCへの anon EXECUTE を剥奪（多層防御）。overload/署名差異に強いDOブロックで。
--    公開RPC（get_booking_*, create/get/cancel_public_reservation, get_qr_*, create_qr_order）と
--    RLSヘルパー（app_*）は除外＝anon が正当に必要とするため触らない。
-- -------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'apply_punch','finalize_order','refund_order',
        'open_register_session','close_register_session','close_store_day','reopen_store_day',
        'apply_stock_receipt','apply_stock_transfer','ship_stock_transfer','receive_stock_transfer',
        'merge_customers','install_standard_accounts','post_journal_entry','void_journal_entry',
        'close_accounting_period','reopen_accounting_period','recalc_order_totals','recalc_customer_stats',
        'log_system_error'
      ])
  loop
    execute format('revoke execute on function %s from anon', r.sig);
  end loop;
end $$;

-- -------------------------------------------------------------
-- 2) daily_closings: RPC専用書込。直接 insert/update/delete を anon/authenticated から剥奪。
--    アプリは close_store_day RPC 経由のみ（SECURITY DEFINER・関数オーナー権限で実行）。
--    scripts は service role で bypass。→ 店舗締め記録の直接改竄/削除を封鎖。
-- -------------------------------------------------------------
revoke insert, update, delete on public.daily_closings from anon, authenticated;

-- -------------------------------------------------------------
-- 3) 台帳の追記専用化: 直接 update/delete を剥奪（insert は現行アプリが直接行うため維持）。
--    stock_movements: waste/count_adjust 等はアプリが insert する追記型。訂正は打消し行で。
--    cash_transactions: 小口入出金はアプリが insert する追記型。status変更/削除で理論現金を
--      操作できないよう update/delete を封鎖。
-- -------------------------------------------------------------
revoke update, delete on public.stock_movements from anon, authenticated;
revoke update, delete on public.cash_transactions from anon, authenticated;
