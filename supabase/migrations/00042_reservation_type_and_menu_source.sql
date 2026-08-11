-- =============================================================
-- 席のみ/コース予約の店舗切替 ＋ メニュー出典追跡（冪等import用）＋ コース属性
-- FOGO De BRASIA 新宿の本番導入に伴う汎用機能。特定店舗専用ロジックは作らない。
--   1) store_settings: seat_only_enabled / course_enabled（店舗単位で 席のみ/コース/両方 を切替）
--   2) menu_items: 出典(source/source_url/source_key/imported_at)＋コース属性
--      (食べ放題/飲み放題/コース注意事項)＋price_pending(価格未設定は非公開)
--   3) source_key による冪等import（同一importの二重登録防止）
--   4) get_booking_store: 席のみ/コース可否とコース属性を公開ページへ返す
-- =============================================================

-- 1) 予約方式の店舗切替（既定は両方可）
alter table public.store_settings
  add column if not exists seat_only_enabled boolean not null default true,
  add column if not exists course_enabled boolean not null default true;

-- 2) メニュー出典・コース属性・価格pending
alter table public.menu_items
  add column if not exists source text,               -- 例: 'tabelog'
  add column if not exists source_url text,
  add column if not exists source_key text,            -- import冪等キー（店舗内一意）
  add column if not exists imported_at timestamptz,
  add column if not exists course_includes_ayce boolean,   -- 食べ放題
  add column if not exists course_includes_drinks boolean, -- 飲み放題
  add column if not exists course_notes text,
  add column if not exists price_pending boolean not null default false; -- 価格未設定（非公開）

-- 3) 冪等import: 同一店舗×source_key は一意（二重登録防止）
create unique index if not exists uq_menu_items_source_key
  on public.menu_items(organization_id, source_key) where source_key is not null;

-- =============================================================
-- 4) get_booking_store 拡張（席のみ/コース可否・コース属性）
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
    'seat_only_enabled', coalesce(v_settings.seat_only_enabled, true),
    'course_enabled', coalesce(v_settings.course_enabled, true),
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
        'min_party', mi.course_min_party, 'max_party', mi.course_max_party,
        'includes_ayce', mi.course_includes_ayce, 'includes_drinks', mi.course_includes_drinks,
        'notes', mi.course_notes)
        order by mi.sort_order), '[]'::jsonb)
      from public.menu_items mi
      where mi.organization_id = v_store.organization_id
        and (mi.store_id is null or mi.store_id = v_store.id)
        and mi.item_type = 'course' and mi.status = 'active' and not mi.is_sold_out
        and not mi.price_pending)
  );
end $$;

-- 公開RPCは意図どおり anon 実行可（明示GRANT）
grant execute on function public.get_booking_store(text) to anon, authenticated;
