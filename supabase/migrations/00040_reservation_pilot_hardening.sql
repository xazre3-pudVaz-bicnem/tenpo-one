-- =============================================================
-- 予約機能 実店舗パイロット強化（FOGO De BRASIA 新宿 想定）
-- 既存の公開予約フロー・POS/CRM/フロア連携は壊さず、以下を追加・強化する。
--   1) 予約経路マスタの追加（店頭/Instagram/TableCheck/食べログ/ホットペッパー）
--   2) 公開ページ表示用の店舗コンテンツ列（写真URL・注意事項・キャンセルポリシー）
--   3) コース別の利用人数（min/max）
--   4) get_booking_store 拡張（上記コンテンツ＋コース人数制限を公開ページへ返す）
--   5) create_public_reservation 強化（max_party_size・コース人数制限を作成時に強制）
--   6) cancel_public_reservation 強化（キャンセル期限をRPCで強制。UI回避を防ぐ）
--   7) recalc_customer_stats 拡張（cancel_count/no_show_count を予約から整合）
-- 注意: 公開RPC(get_booking_*/*_public_reservation)は意図的にanon実行可（00034/00037で除外）。
--       recalc_customer_stats は内部RPC。CREATE OR REPLACE で権限がPUBLICへリセットされるため、
--       00037と同様に REVOKE FROM PUBLIC を再適用する（関数の既定EXECUTEはPUBLIC付与）。
-- =============================================================

-- 1) 予約経路マスタの追加（共通マスタ organization_id = null）。unique制約が無いためNOT EXISTSで冪等化。
insert into public.reservation_sources (organization_id, code, name, sort_order)
select v.organization_id, v.code, v.name, v.sort_order
from (values
  (null::uuid, 'storefront', '店頭', 8),
  (null::uuid, 'instagram',  'Instagram', 9),
  (null::uuid, 'tablecheck', 'TableCheck', 10),
  (null::uuid, 'tabelog',    '食べログ', 11),
  (null::uuid, 'hotpepper',  'ホットペッパー', 12)
) as v(organization_id, code, name, sort_order)
where not exists (
  select 1 from public.reservation_sources rs
  where rs.code = v.code and rs.organization_id is null
);

-- 2) 公開予約ページの表示用コンテンツ（店舗ごと）
alter table public.store_settings
  add column if not exists booking_photo_url text,
  add column if not exists booking_notes text,
  add column if not exists cancellation_policy text;

-- 3) コース別の利用人数（任意。未設定なら制限なし）
alter table public.menu_items
  add column if not exists course_min_party integer,
  add column if not exists course_max_party integer;

-- =============================================================
-- 4) get_booking_store 拡張
-- =============================================================
create or replace function public.get_booking_store(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_settings public.store_settings%rowtype;
begin
  select * into v_store from public.stores
  where slug = p_slug and status = 'active' and booking_enabled;
  if not found then return null; end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;

  return jsonb_build_object(
    'id', v_store.id,
    'slug', v_store.slug,
    'name', v_store.name,
    'address', v_store.address,
    'phone', v_store.phone,
    'description', v_store.description,
    'photo_url', v_settings.booking_photo_url,
    'booking_notes', v_settings.booking_notes,
    'cancellation_policy', v_settings.cancellation_policy,
    'max_party_size', coalesce(v_settings.max_party_size, 12),
    'booking_window_days', coalesce(v_settings.booking_window_days, 90),
    'slot_minutes', coalesce(v_settings.slot_minutes, 30),
    'cancel_deadline_hours', coalesce(v_settings.cancel_deadline_hours, 24),
    'business_hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day_of_week', bh.day_of_week, 'is_closed', bh.is_closed,
        'open_time', bh.open_time, 'close_time', bh.close_time,
        'last_entry_time', bh.last_entry_time) order by bh.day_of_week), '[]'::jsonb)
      from public.business_hours bh where bh.store_id = v_store.id),
    'courses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mi.id, 'name', mi.name, 'price', mi.price,
        'description', mi.description, 'duration_minutes', mi.duration_minutes,
        'min_party', mi.course_min_party, 'max_party', mi.course_max_party)
        order by mi.sort_order), '[]'::jsonb)
      from public.menu_items mi
      where mi.organization_id = v_store.organization_id
        and (mi.store_id is null or mi.store_id = v_store.id)
        and mi.item_type = 'course' and mi.status = 'active' and not mi.is_sold_out)
  );
end $$;

-- =============================================================
-- 5) create_public_reservation 強化（max_party_size・コース人数制限を作成時に強制）
--    ※ 00015 の本体を踏襲し、検証のみ追加。ロック/レート制限/顧客紐付けは不変。
-- =============================================================
create or replace function public.create_public_reservation(
  p_slug text, p_date date, p_time text, p_party integer,
  p_adults integer, p_children integer,
  p_name text, p_kana text, p_phone text, p_email text,
  p_course_id uuid default null, p_seat_type text default null, p_purpose text default null,
  p_allergy text default null, p_request text default null,
  p_source_code text default 'web', p_consent boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_settings public.store_settings%rowtype;
  v_customer_id uuid;
  v_code text;
  v_start timestamptz;
  v_end timestamptz;
  v_stay integer;
  v_avail jsonb;
  v_slot jsonb;
  v_ok boolean := false;
  v_res_id uuid;
  v_source_id uuid;
  v_recent integer;
  v_course public.menu_items%rowtype;
begin
  if not p_consent then raise exception 'CONSENT_REQUIRED'; end if;
  if p_name is null or length(trim(p_name)) = 0 or p_phone is null or length(trim(p_phone)) < 10 then
    raise exception 'INVALID_INPUT';
  end if;
  if p_party < 1 or p_party > 99 then raise exception 'INVALID_PARTY'; end if;

  select * into v_store from public.stores
  where slug = p_slug and status = 'active' and booking_enabled;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;

  -- 店舗の最大人数を超える予約は受け付けない（設定がある場合のみ）
  if v_settings.max_party_size is not null and p_party > v_settings.max_party_size then
    raise exception 'PARTY_TOO_LARGE';
  end if;

  -- コース指定時は、コースの利用人数制限（任意）を検証する
  if p_course_id is not null then
    select * into v_course from public.menu_items
    where id = p_course_id and item_type = 'course' and status = 'active';
    if not found then raise exception 'COURSE_NOT_FOUND'; end if;
    if v_course.course_min_party is not null and p_party < v_course.course_min_party then
      raise exception 'COURSE_PARTY_INVALID';
    end if;
    if v_course.course_max_party is not null and p_party > v_course.course_max_party then
      raise exception 'COURSE_PARTY_INVALID';
    end if;
  end if;

  select count(*) into v_recent from public.booking_request_logs
  where phone = p_phone and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'RATE_LIMITED'; end if;
  insert into public.booking_request_logs (phone, store_id) values (p_phone, v_store.id);

  -- 同一店舗×同一日の予約確定を直列化（トランザクション終了で自動解放）
  perform pg_advisory_xact_lock(hashtext(v_store.id::text || ':' || p_date::text));

  v_avail := public.get_booking_availability(p_slug, p_date, p_party);
  for v_slot in select * from jsonb_array_elements(coalesce(v_avail, '[]'::jsonb)) loop
    if v_slot->>'time' = p_time and (v_slot->>'available')::boolean then
      v_ok := true;
    end if;
  end loop;
  if not v_ok then raise exception 'SLOT_UNAVAILABLE'; end if;

  v_stay := coalesce(v_settings.default_stay_minutes, 120);
  if p_course_id is not null then
    v_stay := coalesce(v_course.duration_minutes, v_stay);
  end if;
  v_start := (p_date::text || ' ' || p_time)::timestamp at time zone 'Asia/Tokyo';
  v_end := v_start + make_interval(mins => v_stay);

  select id into v_customer_id from public.customers
  where organization_id = v_store.organization_id and phone = p_phone and status = 'active'
  limit 1;
  if v_customer_id is null then
    insert into public.customers
      (organization_id, primary_store_id, name, name_kana, phone, email, allergy_note)
    values (v_store.organization_id, v_store.id, p_name, p_kana, p_phone, p_email, p_allergy)
    returning id into v_customer_id;
  end if;

  insert into public.customer_consents (organization_id, customer_id, consent_type, granted, granted_at, source)
  values (v_store.organization_id, v_customer_id, 'privacy', true, now(), 'web_booking')
  on conflict (customer_id, consent_type)
  do update set granted = true, granted_at = now(), source = 'web_booking';

  select id into v_source_id from public.reservation_sources
  where code = coalesce(p_source_code, 'web') and organization_id is null limit 1;

  v_code := public.generate_reservation_code();

  insert into public.reservations
    (organization_id, store_id, customer_id, code, reserved_date, start_at, end_at,
     party_size, adults, children, course_id, seat_type, purpose,
     guest_name, guest_name_kana, guest_phone, guest_email,
     allergy_note, request_note, status, source_id, created_via, consent_accepted)
  values
    (v_store.organization_id, v_store.id, v_customer_id, v_code, p_date, v_start, v_end,
     p_party, coalesce(p_adults, p_party), coalesce(p_children, 0), p_course_id, p_seat_type, p_purpose,
     p_name, p_kana, p_phone, p_email,
     p_allergy, p_request, 'confirmed', v_source_id, 'web', true)
  returning id into v_res_id;

  return jsonb_build_object('id', v_res_id, 'code', v_code);
end $$;

-- =============================================================
-- 6) cancel_public_reservation 強化（キャンセル期限をRPCで強制）
-- =============================================================
create or replace function public.cancel_public_reservation(p_code text, p_phone text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_res public.reservations%rowtype;
  v_deadline_hours integer;
begin
  select * into v_res from public.reservations
  where code = upper(p_code) and guest_phone = p_phone;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_res.status not in ('pending','confirmed') then raise exception 'NOT_CANCELLABLE'; end if;

  -- キャンセル期限（来店 v_deadline_hours 時間前）を過ぎた予約はWebキャンセル不可（店舗へ連絡）
  select coalesce(cancel_deadline_hours, 24) into v_deadline_hours
  from public.store_settings where store_id = v_res.store_id;
  if now() > (v_res.start_at - make_interval(hours => coalesce(v_deadline_hours, 24))) then
    raise exception 'CANCEL_DEADLINE_PASSED';
  end if;

  update public.reservations
  set status = 'cancelled', cancel_reason = coalesce(p_reason, 'お客様都合'), cancelled_at = now()
  where id = v_res.id;

  update public.customers set cancel_count = cancel_count + 1
  where id = v_res.customer_id;

  return jsonb_build_object('ok', true);
end $$;

-- =============================================================
-- 7) recalc_customer_stats 拡張（予約から cancel/no_show を整合）
--    visit/spend は従来どおり orders 由来。cancel_count/no_show_count を予約実績で再計算し
--    アプリ層の増分ドリフトを補正できるようにする。
-- =============================================================
create or replace function public.recalc_customer_stats(p_customer_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.customers c
  set visit_count = s.cnt,
      total_spent = s.spent,
      first_visit_at = s.first_at,
      last_visit_at = s.last_at,
      cancel_count = r.cancel_cnt,
      no_show_count = r.no_show_cnt
  from
    (select
      count(*) filter (where o.status in ('paid','refunded')) as cnt,
      coalesce(sum(o.total) filter (where o.status = 'paid'), 0) as spent,
      min(o.closed_at) as first_at,
      max(o.closed_at) as last_at
    from public.orders o where o.customer_id = p_customer_id) s,
    (select
      count(*) filter (where rv.status = 'cancelled') as cancel_cnt,
      count(*) filter (where rv.status = 'no_show') as no_show_cnt
    from public.reservations rv where rv.customer_id = p_customer_id) r
  where c.id = p_customer_id;
end $$;

-- 公開RPCは意図どおり anon 実行可（明示GRANT）。
grant execute on function
  public.get_booking_store(text),
  public.create_public_reservation(text, date, text, integer, integer, integer, text, text, text, text, uuid, text, text, text, text, text, boolean),
  public.cancel_public_reservation(text, text, text)
to anon, authenticated;

-- 内部RPC recalc_customer_stats は PUBLIC を剥奪し authenticated/service_role のみへ（00037と同方針）。
revoke execute on function public.recalc_customer_stats(uuid) from public;
grant execute on function public.recalc_customer_stats(uuid) to authenticated, service_role;
