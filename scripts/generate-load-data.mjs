/**
 * 負荷テスト用データ生成（v0.3 項目59）— **ローカルSupabase専用**
 *
 * 使い方:
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/generate-load-data.mjs --stores 100 --orders-per-store 1000
 *
 * リモート（本番/開発クラウド）への大量投入を防ぐため、
 * SUPABASE_URL が localhost/127.0.0.1 でない場合は FORCE_REMOTE=1 が無い限り拒否する。
 * 生成データは専用の負荷テスト企業（name: LOADTEST）配下に作成される。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を設定してください');
  process.exit(1);
}
const isLocal = /localhost|127\.0\.0\.1/.test(url);
if (!isLocal && process.env.FORCE_REMOTE !== '1') {
  console.error('リモート環境への大量データ投入は禁止です（ローカルSupabaseで実行してください）。');
  console.error('どうしても必要な場合のみ FORCE_REMOTE=1 を設定（本番では絶対に実行しないこと）。');
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const STORES = getArg('stores', 100);
const ORDERS_PER_STORE = getArg('orders-per-store', 1000);
const CUSTOMERS = getArg('customers', 10000);

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  console.log(`=== 負荷データ生成: 店舗${STORES} / 店舗あたり注文${ORDERS_PER_STORE} / 顧客${CUSTOMERS} ===`);

  const { data: [org] } = await db.from('organizations')
    .upsert({ name: 'LOADTEST', status: 'active', is_demo: false }, { onConflict: 'id', ignoreDuplicates: false })
    .select();

  // 店舗をバッチ作成
  const storeRows = Array.from({ length: STORES }, (_, i) => ({
    organization_id: org.id, slug: `loadtest-${i + 1}`, name: `負荷テスト店舗${i + 1}`,
  }));
  const { data: stores, error: eS } = await db.from('stores')
    .upsert(storeRows, { onConflict: 'slug' }).select('id');
  if (eS) throw eS;
  console.log('店舗:', stores.length);

  // 顧客をバッチ作成（1000件ずつ）
  for (let i = 0; i < CUSTOMERS; i += 1000) {
    const batch = Array.from({ length: Math.min(1000, CUSTOMERS - i) }, (_, j) => ({
      organization_id: org.id,
      name: `負荷顧客${i + j}`,
      phone: `000${String(i + j).padStart(8, '0')}`,
    }));
    const { error } = await db.from('customers').insert(batch);
    if (error && error.code !== '23505') throw error;
    process.stdout.write(`\r顧客: ${Math.min(i + 1000, CUSTOMERS)}/${CUSTOMERS}`);
  }
  console.log();

  // 注文をバッチ作成（明細なしの軽量注文。集計クエリ負荷の再現が目的）
  let total = 0;
  for (const store of stores) {
    const rows = [];
    for (let i = 0; i < ORDERS_PER_STORE; i++) {
      const daysAgo = i % 90;
      const bd = new Date(Date.now() - daysAgo * 86400000)
        .toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      rows.push({
        organization_id: org.id, store_id: store.id, order_type: 'dine_in',
        status: 'paid', guest_count: (i % 4) + 1,
        subtotal: 2000, tax_total: 200, total: 2200, business_date: bd,
      });
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await db.from('orders').insert(rows.slice(i, i + 1000));
      if (error) throw error;
    }
    total += rows.length;
    process.stdout.write(`\r注文: ${total}/${STORES * ORDERS_PER_STORE}`);
  }
  console.log('\n完了。scripts/benchmark-queries.mjs で計測してください。');
  console.log('後片付け: LOADTEST企業を削除するSQLはローカル環境でのみ実行すること。');
}

main().catch((e) => { console.error(e); process.exit(1); });
