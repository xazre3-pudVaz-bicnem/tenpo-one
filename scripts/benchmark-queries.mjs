/**
 * クエリベンチマーク（v0.3 項目59/60）
 *
 * 使い方: node --env-file=.env.local scripts/benchmark-queries.mjs
 * 主要クエリの実行時間を計測する（service role・読み取りのみ・データ変更なし）。
 * 大量データ想定（100社/1000店/1000万注文）でのボトルネック検出の起点。
 * index は 00014_realtime_indexes.sql を参照。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('環境変数を設定してください');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const monthAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

async function bench(name, fn, warnMs = 500) {
  const t0 = performance.now();
  const { error, count } = await fn();
  const ms = Math.round(performance.now() - t0);
  const flag = error ? '✗' : ms > warnMs ? '⚠' : '✓';
  console.log(`  ${flag} ${name}: ${ms}ms${count != null ? ` (${count}件)` : ''}${error ? ` ERROR: ${error.message}` : ''}`);
  return ms;
}

async function main() {
  console.log('=== クエリベンチマーク ===');
  const { data: [org] } = await db.from('organizations').select('id').eq('is_demo', true).limit(1);
  const { data: stores } = await db.from('stores').select('id').eq('organization_id', org.id);
  const storeIds = stores.map((s) => s.id);

  console.log('\n■ ダッシュボード系');
  await bench('当日売上集計', () =>
    db.from('orders').select('total', { count: 'exact' }).in('store_id', storeIds)
      .eq('business_date', today).in('status', ['paid', 'refunded']));
  await bench('30日締めサマリ', () =>
    db.from('daily_closings').select('business_date, sales_total', { count: 'exact' })
      .in('store_id', storeIds).gte('business_date', monthAgo));
  await bench('スタッフ別売上（30日）', () =>
    db.from('orders').select('staff_id, total', { count: 'exact' }).in('store_id', storeIds)
      .gte('business_date', monthAgo).eq('status', 'paid').not('staff_id', 'is', null));

  console.log('\n■ 一覧系（ページング）');
  await bench('注文一覧 50件', () =>
    db.from('orders').select('*', { count: 'exact' }).in('store_id', storeIds)
      .order('created_at', { ascending: false }).range(0, 49));
  await bench('顧客一覧 50件（最終来店順）', () =>
    db.from('customers').select('*', { count: 'exact' }).eq('organization_id', org.id)
      .eq('status', 'active').order('last_visit_at', { ascending: false, nullsFirst: false }).range(0, 49));
  await bench('休眠顧客絞込', () =>
    db.from('customers').select('id', { count: 'exact' }).eq('organization_id', org.id)
      .lt('last_visit_at', monthAgo));

  console.log('\n■ 業務系');
  await bench('KDS未提供品目', () =>
    db.from('order_items').select('*, orders!inner(status)', { count: 'exact' })
      .in('store_id', storeIds).eq('orders.status', 'open').neq('kitchen_status', 'served'));
  await bench('本日の予約（台帳）', () =>
    db.from('reservations').select('*', { count: 'exact' }).in('store_id', storeIds)
      .eq('reserved_date', today));
  await bench('廃棄集計（30日）', () =>
    db.from('stock_movements').select('inventory_item_id, quantity', { count: 'exact' })
      .in('store_id', storeIds).eq('movement_type', 'waste').gte('business_date', monthAgo));
  await bench('監査ログ検索 100件', () =>
    db.from('audit_logs').select('*', { count: 'exact' }).eq('organization_id', org.id)
      .order('created_at', { ascending: false }).range(0, 99));

  console.log('\n※ ⚠は500ms超。件数増加時はEXPLAIN（Supabase SQL Editor）でindex利用を確認すること。');
  console.log('※ 大量データ生成は scripts/generate-load-data.mjs（ローカル専用ガード付き）を使用。');
}

main().catch((e) => { console.error(e); process.exit(1); });
