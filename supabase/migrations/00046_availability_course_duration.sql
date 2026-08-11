-- =============================================================
-- 空席判定にコース所要時間を反映（汎用）
-- get_booking_availability に任意の p_course_id を追加。指定時は、判定対象の予約の
-- 占有窓（滞在時間）にコースの duration_minutes を用いる（既定は default_stay_minutes）。
-- 既存予約は従来どおり実 end_at で占有判定するため、確定済みコース予約はその実所要時間で
-- 正しくブロックされる。今回の追加は「これから取るコース予約」の占有窓を正確化するもの。
-- create_public_reservation の最終再判定（advisory lock 後）でも p_course_id を渡し、
-- 長時間コースが後続枠へはみ出す取り違えを防ぐ。
-- 旧 3引数版は破棄し 4引数（p_course_id default null）へ統一（3引数呼び出しは既定値で解決）。
-- =============================================================

drop function if exists public.get_booking_availability(text, date, integer);

create or replace function public.get_booking_availability(
  p_slug text, p_date date, p_party integer, p_course_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_store public.stores%rowtype;
  v_settings public.store_settings%rowtype;
  v_bh public.business_hours%rowtype;
  v_capacity integer;
  v_slots jsonb := '[]'::jsonb;
  v_slot time;
  v_last time;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_used integer;
  v_private integer;
  v_stay integer;
  v_cutoff timestamptz;
  v_buffer integer;
begin
  select * into v_store from public.stores
  where slug = p_slug and status = 'active' and booking_enabled;
  if not found then return null; end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;
  v_buffer := coalesce(v_settings.cleaning_buffer_minutes, 0);

  if p_date < (now() at time zone 'Asia/Tokyo')::date
     or p_date > (now() at time zone 'Asia/Tokyo')::date + coalesce(v_settings.booking_window_days, 90) then
    return '[]'::jsonb;
  end if;
  if exists (select 1 from public.holidays where store_id = v_store.id and holiday_date = p_date) then
    return '[]'::jsonb;
  end if;
  select * into v_bh from public.business_hours
  where store_id = v_store.id and day_of_week = extract(dow from p_date)::int;
  if not found or v_bh.is_closed or v_bh.open_time is null then
    return '[]'::jsonb;
  end if;
  select coalesce(sum(capacity_max), 0) into v_capacity
  from public.restaurant_tables
  where store_id = v_store.id and status = 'active' and current_status <> 'unavailable';
  if v_capacity <= 0 or p_party > v_capacity then
    return '[]'::jsonb;
  end if;

  -- 占有窓（滞在時間）: コース指定時はコース所要時間を優先
  v_stay := coalesce(v_settings.default_stay_minutes, 120);
  if p_course_id is not null then
    select coalesce(mi.duration_minutes, v_stay) into v_stay
    from public.menu_items mi where mi.id = p_course_id and mi.item_type = 'course';
    v_stay := coalesce(v_stay, coalesce(v_settings.default_stay_minutes, 120));
  end if;

  v_last := coalesce(v_bh.last_entry_time, v_bh.close_time - interval '60 minutes');
  v_cutoff := now() + make_interval(mins => coalesce(v_settings.booking_cutoff_minutes, 120));

  v_slot := v_bh.open_time;
  while v_slot <= v_last loop
    v_slot_start := (p_date::text || ' ' || v_slot::text)::timestamp at time zone 'Asia/Tokyo';
    v_slot_end := v_slot_start + make_interval(mins => v_stay + v_buffer);

    if v_slot_start >= v_cutoff then
      select count(*) into v_private
      from public.reservations
      where store_id = v_store.id and is_private_hire
        and status in ('pending','confirmed','waiting','arrived','seated','billing')
        and start_at < v_slot_end
        and end_at + make_interval(mins => v_buffer) > v_slot_start;
      if v_private > 0 then
        v_slots := v_slots || jsonb_build_object('time', to_char(v_slot, 'HH24:MI'), 'available', false);
      else
        select coalesce(sum(party_size), 0) into v_used
        from public.reservations
        where store_id = v_store.id
          and status in ('pending','confirmed','waiting','arrived','seated','billing')
          and start_at < v_slot_end
          and end_at + make_interval(mins => v_buffer) > v_slot_start;
        v_slots := v_slots || jsonb_build_object(
          'time', to_char(v_slot, 'HH24:MI'),
          'available', (v_used + p_party) <= v_capacity);
      end if;
    else
      v_slots := v_slots || jsonb_build_object('time', to_char(v_slot, 'HH24:MI'), 'available', false);
    end if;

    v_slot := v_slot + make_interval(mins => coalesce(v_settings.slot_minutes, 30));
  end loop;
  return v_slots;
end $$;

-- create_public_reservation: 最終再判定でコース所要を反映（それ以外は 00040 と同一）
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

  if v_settings.max_party_size is not null and p_party > v_settings.max_party_size then
    raise exception 'PARTY_TOO_LARGE';
  end if;

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

  perform pg_advisory_xact_lock(hashtext(v_store.id::text || ':' || p_date::text));

  -- コース所要を反映した占有窓で最終再判定
  v_avail := public.get_booking_availability(p_slug, p_date, p_party, p_course_id);
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

grant execute on function public.get_booking_availability(text, date, integer, uuid) to anon, authenticated;
grant execute on function public.create_public_reservation(text, date, text, integer, integer, integer, text, text, text, text, uuid, text, text, text, text, text, boolean) to anon, authenticated;
