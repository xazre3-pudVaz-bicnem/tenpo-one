/**
 * FOGOフロアのデータ補正（1回きり・ベキ等）。
 *   1) restaurant_tables.sort_order を T1..T15 の並びに補正（全0でバラバラ表示になっていたのを正す）
 *   2) 開いている伝票が無いのに current_status='seated' で取り残されたテーブルを 'available' に戻す
 * 実行: node --env-file=.env.local scripts/tenants/fogo/fix-floor.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { TABLES } from './data.mjs';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: store } = await admin.from('stores').select('id, name').ilike('name', '%FOGO%').maybeSingle();
if (!store) throw new Error('FOGO店舗が見つかりません');
console.log('store:', store.id, store.name);

// 1) sort_order 補正
let fixedOrder = 0;
for (let i = 0; i < TABLES.length; i++) {
  const sortOrder = i + 1;
  const { data: row } = await admin
    .from('restaurant_tables')
    .select('id, sort_order')
    .eq('store_id', store.id)
    .eq('name', TABLES[i].name)
    .maybeSingle();
  if (!row) continue;
  if (row.sort_order !== sortOrder) {
    await admin.from('restaurant_tables').update({ sort_order: sortOrder }).eq('id', row.id);
    fixedOrder++;
  }
}
console.log(`sort_order 補正: ${fixedOrder}件`);

// 2) 幽霊 seated の解消（開伝票が無いテーブルのみ）
const { data: tables } = await admin
  .from('restaurant_tables')
  .select('id, name, current_status')
  .eq('store_id', store.id)
  .eq('status', 'active');

let reset = 0;
for (const t of tables ?? []) {
  if (t.current_status === 'available') continue;
  const { count } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('table_id', t.id)
    .eq('status', 'open');
  if ((count ?? 0) > 0) {
    console.log(`  ${t.name}: 開伝票あり(${count}) → 変更しない`);
    continue;
  }
  await admin.from('restaurant_tables').update({ current_status: 'available' }).eq('id', t.id);
  console.log(`  ${t.name}: ${t.current_status} → available（開伝票なし）`);
  reset++;
}
console.log(`current_status リセット: ${reset}件`);

// 結果表示
const { data: after } = await admin
  .from('restaurant_tables')
  .select('name, sort_order, current_status')
  .eq('store_id', store.id)
  .eq('status', 'active')
  .order('sort_order');
console.log('\n=== after ===');
console.log((after ?? []).map((t) => `${t.name}(${t.sort_order},${t.current_status})`).join('  '));
