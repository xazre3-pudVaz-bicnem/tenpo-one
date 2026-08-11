/**
 * FOGO メニュー投入（冪等・出典追跡）
 *
 *   node --env-file=.env.local scripts/tenants/fogo/import-menu.mjs
 *
 * - コース6 / 料理38 / ドリンク86（合計130）を FOGO の menu master へ登録。
 * - source_key で冪等（2回実行しても二重登録しない）。出典 source/source_url/imported_at を記録。
 * - 価格未確認は price_pending=true / status='hidden'（非公開・注文不可。0円表示はしない）。
 * - 画像は登録しない（食べログ写真を転載しない）。オーナーが後から追加。
 * - 実データ件数が指定(6/38/86)と異なる場合は SOURCE_CHANGED として報告し、架空商品で埋めない。
 */
import { createClient } from '@supabase/supabase-js';
import { SOURCE, SOURCE_URLS, COURSES, FOOD, FOOD_CATEGORIES, DRINK, DRINK_CATEGORIES } from './data.mjs';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SLUG = 'fogo-de-brasia-shinjuku';
const now = new Date().toISOString();

async function main() {
  console.log('=== FOGO メニュー投入（冪等）===');
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('slug', SLUG).maybeSingle();
  if (!store) throw new Error('FOGO店舗が見つかりません。先に setup.mjs を実行してください。');
  const org = store.organization_id;

  // 件数の事前チェック（架空で埋めない）
  const expect = { course: 6, food: 38, drink: 86 };
  const actual = { course: COURSES.length, food: FOOD.length, drink: DRINK.length };
  if (actual.course !== expect.course || actual.food !== expect.food || actual.drink !== expect.drink) {
    console.log(`⚠ SOURCE_CHANGED: 実データ件数 course=${actual.course} food=${actual.food} drink=${actual.drink}（指定 6/38/86）。架空商品は作りません。`);
  }

  // 1) カテゴリ get-or-create（店舗スコープ）
  const catId = new Map();
  const allCats = [...FOOD_CATEGORIES, ...DRINK_CATEGORIES];
  let sort = 1;
  for (const c of allCats) {
    const { data: ex } = await admin.from('menu_categories').select('id').eq('organization_id', org).eq('store_id', store.id).eq('name', c.name).maybeSingle();
    if (ex) {
      catId.set(c.name, ex.id);
      await admin.from('menu_categories').update({ station: c.station }).eq('id', ex.id);
    } else {
      const { data, error } = await admin.from('menu_categories')
        .insert({ organization_id: org, store_id: store.id, name: c.name, station: c.station, sort_order: sort, status: 'active' })
        .select('id').single();
      if (error) throw new Error(`category ${c.name}: ${error.message}`);
      catId.set(c.name, data.id);
    }
    sort++;
  }
  console.log(`カテゴリ: ${allCats.length}件（料理${FOOD_CATEGORIES.length}/ドリンク${DRINK_CATEGORIES.length}）`);

  // 汎用 upsert（source_key で冪等）
  async function upsertItem(sourceKey, fields) {
    const { data: ex } = await admin.from('menu_items').select('id').eq('organization_id', org).eq('source_key', sourceKey).maybeSingle();
    if (ex) {
      const { error } = await admin.from('menu_items').update(fields).eq('id', ex.id);
      if (error) throw new Error(`update ${sourceKey}: ${error.message}`);
      return 'updated';
    }
    const { error } = await admin.from('menu_items').insert({ organization_id: org, store_id: store.id, source_key: sourceKey, ...fields });
    if (error) throw new Error(`insert ${sourceKey}: ${error.message}`);
    return 'inserted';
  }

  // 2) コース
  let cSort = 1;
  for (const c of COURSES) {
    await upsertItem(c.key, {
      name: c.name, item_type: 'course', price: c.price ?? 0, price_pending: c.price == null,
      description: null, duration_minutes: c.duration, course_min_party: c.minParty, course_max_party: c.maxParty,
      course_includes_ayce: c.ayce, course_includes_drinks: c.drinks, course_notes: c.notes,
      status: c.price == null ? 'hidden' : 'active', sort_order: cSort++,
      source: SOURCE, source_url: SOURCE_URLS.course, imported_at: now,
    });
  }
  console.log(`コース: ${COURSES.length}件`);

  // 3) 料理（station=kitchen）
  let fSort = 1, foodPending = 0;
  for (const f of FOOD) {
    if (f.price == null) foodPending++;
    await upsertItem(f.key, {
      name: f.name, item_type: 'food', category_id: catId.get(f.cat),
      price: f.price ?? 0, price_pending: f.price == null,
      status: f.price == null ? 'hidden' : 'active', is_sold_out: false, sort_order: fSort++,
      source: SOURCE, source_url: SOURCE_URLS.food, imported_at: now,
    });
  }
  console.log(`料理: ${FOOD.length}件（価格未設定=非公開 ${foodPending}件）`);

  // 4) ドリンク（station=drink）
  let dSort = 1, drinkPending = 0;
  for (const d of DRINK) {
    if (d.price == null) drinkPending++;
    await upsertItem(d.key, {
      name: d.name, item_type: 'drink', category_id: catId.get(d.cat),
      price: d.price ?? 0, price_pending: d.price == null,
      status: d.price == null ? 'hidden' : 'active', is_sold_out: false, sort_order: dSort++,
      source: SOURCE, source_url: SOURCE_URLS.drink, imported_at: now,
    });
  }
  console.log(`ドリンク: ${DRINK.length}件（価格未設定=非公開 ${drinkPending}件）`);

  // 5) 実DB件数の検証
  const q = (t) => admin.from('menu_items').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('source', SOURCE).eq('item_type', t);
  const [cc, fc, dc] = await Promise.all([q('course'), q('food'), q('drink')]);
  console.log('\n--- DB実件数（source=tabelog）---');
  console.log(`コース ${cc.count} / 料理 ${fc.count} / ドリンク ${dc.count} / 合計 ${(cc.count ?? 0) + (fc.count ?? 0) + (dc.count ?? 0)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
