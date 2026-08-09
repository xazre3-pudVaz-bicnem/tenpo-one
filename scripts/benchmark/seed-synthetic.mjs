/**
 * TENPO ONE v0.5.0 大量データ synthetic ベンチマークシード（TEST）
 *
 * 使い方（ローカルSupabase専用が既定）:
 *   supabase start
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local anon/service key> \
 *     node scripts/benchmark/seed-synthetic.mjs --preset small
 *   node scripts/benchmark/seed-synthetic.mjs --preset medium
 *   node scripts/benchmark/seed-synthetic.mjs --preset large   # 実投入は控えめ・下記コメント参照
 *
 * データ規模プリセット:
 *   small  : 1店舗   × 注文10,000件（合計 約10,000件）
 *   medium : 10店舗  × 注文10,000件（合計 約100,000件）
 *   large  : 想定は 100店舗 × 注文100,000件（合計 約1,000万件・本番規模相当）。
 *            実行環境（ローカルDocker）への負荷が大きいため、本スクリプトは既定で
 *            large も stores=20 / ordersPerStore=20,000（合計40万件）に抑えて実行する。
 *            真の1000万件規模で測定したい場合は
 *              node scripts/benchmark/seed-synthetic.mjs --preset large --stores 100 --orders-per-store 100000
 *            のように明示指定すること（ローカルでのみ。時間がかかる点に注意）。
 *
 * 安全設計（本番保護・v0.5.0 TEST要件）:
 *  - NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL が localhost / 127.0.0.1 の場合のみ既定で実行可。
 *  - リモートURLに対しては既定で拒否する。--force と環境変数
 *    CONFIRM_NOT_PRODUCTION=I_KNOW_THIS_IS_NOT_PRODUCTION の両方を指定した場合のみ
 *    例外的に実行できるが、それでも投入先は必ず本スクリプト専用の隔離組織
 *    （name: "[BENCHTEST] Synthetic Load Org" / is_demo=false）に限定され、
 *    デモ企業（is_demo=true）や既存の本番企業データには一切書き込まない。
 *  - 本番プロジェクトのURLに対しては（--force を付けても）絶対に実行しないこと。
 *
 * 生成データは軽量注文（order_items無し・合計金額のみ）で、集計クエリの負荷再現が目的。
 * 削除する場合は --wipe を付けて実行すると、投入前に専用組織配下のデータを一括削除する。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL（またはNEXT_PUBLIC_SUPABASE_URL） / SUPABASE_SERVICE_ROLE_KEY を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};

const FORCE = hasFlag('force');
const isLocal = /localhost|127\.0\.0\.1/.test(url);

if (!isLocal) {
  const confirmed = FORCE && process.env.CONFIRM_NOT_PRODUCTION === 'I_KNOW_THIS_IS_NOT_PRODUCTION';
  if (!confirmed) {
    console.error('=== リモートSupabaseへの大量synthetic データ投入は既定で拒否されます ===');
    console.error(`対象URL: ${url}`);
    console.error('');
    console.error('本番/デモ企業を巻き込む事故を防ぐため、ローカルSupabase（supabase start; URLが');
    console.error('localhost/127.0.0.1）での実行を強く推奨します。');
    console.error('');
    console.error('どうしてもリモートの専用test orgに投入する場合のみ、次の両方を指定してください:');
    console.error('  --force と環境変数 CONFIRM_NOT_PRODUCTION=I_KNOW_THIS_IS_NOT_PRODUCTION');
    console.error('本番プロジェクトのURLに対しては、この2つを指定しても絶対に実行しないこと。');
    process.exit(1);
  }
  console.warn('!!! 警告: リモートURLへ --force で投入します。専用組織（is_demo=false）のみへ隔離します。 !!!');
}

const PRESETS = {
  small: { stores: 1, ordersPerStore: 10_000, customers: 2_000 },
  medium: { stores: 10, ordersPerStore: 10_000, customers: 20_000 },
  // 実際の投入は控えめ（40万件）。真の1000万件規模は上記コメントの明示指定で。
  large: { stores: 20, ordersPerStore: 20_000, customers: 100_000 },
};
const presetName = getArg('preset', 'small');
const preset = PRESETS[presetName];
if (!preset) {
  console.error(`未知のpreset: ${presetName}（small / medium / large のいずれか）`);
  process.exit(1);
}
const STORES = Number(getArg('stores', preset.stores));
const ORDERS_PER_STORE = Number(getArg('orders-per-store', preset.ordersPerStore));
const CUSTOMERS = Number(getArg('customers', preset.customers));
const WIPE = hasFlag('wipe');

const db = createClient(url, key, { auth: { persistSession: false } });

const TEST_ORG_NAME = '[BENCHTEST] Synthetic Load Org';

async function main() {
  console.log(`=== synthetic ベンチマークシード（preset=${presetName}） ===`);
  console.log(`店舗${STORES} / 店舗あたり注文${ORDERS_PER_STORE}（合計${(STORES * ORDERS_PER_STORE).toLocaleString()}件） / 顧客${CUSTOMERS}`);
  console.log(`投入先: ${url}（${isLocal ? 'ローカル' : 'リモート・--force指定'}）`);

  // 専用組織を取得または作成（既存のデモ/本番企業には一切触れない）
  let { data: org } = await db.from('organizations').select('*').eq('name', TEST_ORG_NAME).maybeSingle();
  if (!org) {
    const { data: created, error } = await db.from('organizations').insert({
      name: TEST_ORG_NAME, status: 'active', is_demo: false,
    }).select().single();
    if (error) throw error;
    org = created;
  }
  console.log('専用組織:', org.id, TEST_ORG_NAME);

  if (WIPE) {
    console.log('--wipe: 既存の投入データを削除しています…');
    const { data: oldStores } = await db.from('stores').select('id').eq('organization_id', org.id);
    const oldStoreIds = (oldStores ?? []).map((s) => s.id);
    if (oldStoreIds.length) {
      await db.from('orders').delete().in('store_id', oldStoreIds);
    }
    await db.from('customers').delete().eq('organization_id', org.id);
    await db.from('stores').delete().eq('organization_id', org.id);
    console.log('削除完了。');
  }

  // 店舗（slugは専用組織内でのみ一意になるよう固定プレフィックス）
  const storeRows = Array.from({ length: STORES }, (_, i) => ({
    organization_id: org.id, slug: `benchtest-${i + 1}`, name: `[BENCHTEST] 店舗${i + 1}`,
  }));
  const { data: stores, error: eS } = await db.from('stores')
    .upsert(storeRows, { onConflict: 'slug' }).select('id');
  if (eS) throw eS;
  console.log('店舗:', stores.length);

  // 顧客（ILIKE検索ベンチのため氏名にバリエーションを持たせる）
  const surnames = ['田中', '佐藤', '鈴木', '高橋', '渡辺', '伊藤', '山本', '中村', '小林', '加藤'];
  const givens = ['太郎', '花子', '一郎', '直美', '大輔', '美咲', '蓮', '結衣', '健', '誠'];
  for (let i = 0; i < CUSTOMERS; i += 1000) {
    const batch = Array.from({ length: Math.min(1000, CUSTOMERS - i) }, (_, j) => {
      const n = i + j;
      return {
        organization_id: org.id,
        name: `${surnames[n % surnames.length]} ${givens[(n * 7) % givens.length]}`,
        phone: `080${String(n).padStart(8, '0')}`,
      };
    });
    const { error } = await db.from('customers').insert(batch);
    if (error && error.code !== '23505') throw error;
    process.stdout.write(`\r顧客: ${Math.min(i + 1000, CUSTOMERS)}/${CUSTOMERS}`);
  }
  console.log();

  // 注文（軽量: order_itemsなし。集計クエリ負荷の再現が目的。過去90日に分散）
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
  console.log();

  console.log('\n完了。');
  console.log(`計測: node scripts/benchmark/run-benchmark.mjs --org ${org.id}`);
  console.log('後片付け: node scripts/benchmark/seed-synthetic.mjs --preset small --wipe（同一presetで--wipeを付けて再実行）');
  console.log('         または SQL Editor で organizations.name = \'' + TEST_ORG_NAME + '\' の企業配下を削除。');
}

main().catch((e) => { console.error(e); process.exit(1); });
