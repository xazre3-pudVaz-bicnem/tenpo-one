-- =============================================================
-- 00034 の forward-fix
-- (A) apply_punch: 店舗所属(store access)まで要求すると「自店以外での自己打刻」を弾き、
--     組織内の応援勤務や既存の越境二重出勤検知(ELSEWHERE)より前にFORBIDDENになる。
--     真の穴は「他テナント(別org)」と「p_via_pinで他人を打刻」。→ 組織メンバー(app_is_org_member)
--     までに緩和し、他org・他人代理・via_pin悪用は引き続き遮断する。
-- (B) cash_transactions: 小口現金の承認フローが approval_status を UPDATE するため、
--     UPDATE 全剥奪は過剰。DELETE のみ剥奪し、金額・種別・セッションの改竄は
--     トリガーで拒否する（承認・void系フィールドの更新は許可）。
-- =============================================================

-- -------------------------------------------------------------
-- (A) apply_punch: 認可を app_is_org_member に緩和
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

  -- 認可: 認証ユーザー文脈では p_via_pin を信用しない。
  -- 他テナント(別org)を遮断し、他人の代理打刻は管理者ロールに限定する。
  if auth.uid() is not null then
    if not public.app_is_org_member(v_store.organization_id) then
      raise exception 'FORBIDDEN';
    end if;
    if p_profile_id <> auth.uid()
       and not public.app_role_in(v_store.organization_id,
         array['org_owner','hq_admin','area_manager','store_manager']) then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  -- auth.uid() is null（service role・PIN打刻はapp層で権限+PIN検証済み）は許可

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
-- (B) cash_transactions: UPDATE を復活（小口承認フロー用）、DELETE は剥奪維持、
--     金額・種別・セッション・注文/返金参照の改竄はトリガーで拒否。
-- -------------------------------------------------------------
grant update on public.cash_transactions to authenticated;

create or replace function public.prevent_cash_tx_tamper()
returns trigger language plpgsql as $$
begin
  -- service role（auth.uid() null。RPC/scriptの正規処理）は許可
  if auth.uid() is null then return new; end if;
  -- 金額・種別・レジセッション・注文/返金参照・営業日は確定後不変（承認/void系のみ更新可）
  if new.amount is distinct from old.amount
     or new.kind is distinct from old.kind
     or new.register_session_id is distinct from old.register_session_id
     or new.order_id is distinct from old.order_id
     or new.refund_id is distinct from old.refund_id
     or new.business_date is distinct from old.business_date then
    raise exception 'CASH_TX_IMMUTABLE: 入出金の金額・種別・参照は変更できません';
  end if;
  return new;
end $$;

drop trigger if exists trg_cash_tx_tamper on public.cash_transactions;
create trigger trg_cash_tx_tamper
  before update on public.cash_transactions
  for each row execute function public.prevent_cash_tx_tamper();
