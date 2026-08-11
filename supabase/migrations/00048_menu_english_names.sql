-- =============================================================
-- メニューの英語名（対訳）をデータ側で管理。モバイルオーダーの言語切替(EN)で表示する。
-- name_en が未設定なら name（日本語）へフォールバック。価格・並び順等は共通。
-- =============================================================
alter table public.menu_categories add column if not exists name_en text;
alter table public.menu_items add column if not exists name_en text;

-- get_qr_menu: カテゴリ/商品に name_en を含めて返す（本体ロジックは 00013 と同一）
create or replace function public.get_qr_menu(p_slug text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_table public.restaurant_tables%rowtype;
  v_store public.stores%rowtype;
  v_now time := (now() at time zone 'Asia/Tokyo')::time;
begin
  select t.* into v_table
  from public.restaurant_tables t
  join public.stores s on s.id = t.store_id
  where t.qr_token = p_token and s.slug = p_slug
    and t.status = 'active';
  if not found then return null; end if;

  select * into v_store from public.stores where id = v_table.store_id and status = 'active';
  if not found then return null; end if;

  return jsonb_build_object(
    'store_name', v_store.name,
    'table_name', v_table.name,
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mc.id, 'name', mc.name, 'name_en', mc.name_en, 'color', mc.color,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', mi.id, 'name', mi.name, 'name_en', mi.name_en, 'description', mi.description,
            'price', mi.price, 'is_sold_out', mi.is_sold_out,
            'is_recommended', mi.is_recommended,
            'allergy_info', mi.allergy_info,
            'image_path', mi.image_path,
            'modifiers', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', mm.id, 'name', mm.name, 'price', mm.price) order by mm.sort_order), '[]'::jsonb)
              from public.menu_item_modifiers mim
              join public.menu_modifiers mm on mm.id = mim.modifier_id and mm.status = 'active'
              where mim.menu_item_id = mi.id))
            order by mi.is_recommended desc, mi.sort_order), '[]'::jsonb)
          from public.menu_items mi
          where mi.category_id = mc.id
            and mi.organization_id = v_store.organization_id
            and (mi.store_id is null or mi.store_id = v_store.id)
            and mi.status = 'active'
            and mi.item_type in ('food','drink')
            and (
              mi.sell_start_time is null or mi.sell_end_time is null
              or (mi.sell_start_time <= mi.sell_end_time
                  and v_now between mi.sell_start_time and mi.sell_end_time)
              or (mi.sell_start_time > mi.sell_end_time
                  and (v_now >= mi.sell_start_time or v_now <= mi.sell_end_time))
            )
        )) order by mc.sort_order), '[]'::jsonb)
      from public.menu_categories mc
      where mc.organization_id = v_store.organization_id
        and (mc.store_id is null or mc.store_id = v_store.id)
        and mc.status = 'active')
  );
end $$;

grant execute on function public.get_qr_menu(text, text) to anon, authenticated;
