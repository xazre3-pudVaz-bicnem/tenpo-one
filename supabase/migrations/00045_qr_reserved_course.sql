-- =============================================================
-- モバイルオーダー用: そのテーブルの「ご予約コース」を参考表示するためのRPC。
-- 現在その卓に着席中（arrived/seated/billing）でコース指定のある予約があれば、そのコース情報を返す。
-- 参照のみ（コースはQRメニューに出ないため二重課金は発生しない）。anon実行可。
-- =============================================================
create or replace function public.get_qr_reserved_course(p_slug text, p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', mi.name,
    'includes_ayce', mi.course_includes_ayce,
    'includes_drinks', mi.course_includes_drinks,
    'duration_minutes', mi.duration_minutes,
    'notes', mi.course_notes)
  from public.restaurant_tables t
  join public.stores s on s.id = t.store_id
  join public.reservation_tables rt on rt.table_id = t.id
  join public.reservations r on r.id = rt.reservation_id
  join public.menu_items mi on mi.id = r.course_id
  where t.qr_token = p_token and s.slug = p_slug and t.status = 'active'
    and r.course_id is not null
    and r.status in ('arrived','seated','billing')
    and r.reserved_date = (now() at time zone 'Asia/Tokyo')::date
  order by r.start_at desc
  limit 1;
$$;

grant execute on function public.get_qr_reserved_course(text, text) to anon, authenticated;
