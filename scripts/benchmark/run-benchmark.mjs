/**
 * TENPO ONE v0.5.0 パフォーマンスベンチマーク（TEST）
 *
 * 使い方:
 *   node --env-file=.env.local scripts/benchmark/run-benchmark.mjs
 *   node --env-file=.env.local scripts/benchmark/run-benchmark.mjs --org <organization_id>
 *
 * 主要クエリ（ダッシュボード当月集計・注文一覧range・顧客ILIKE検索・仕訳期間集計・
 * 監査ログ）を実測し、閾値（既定500ms）超過を警告する。結果はJSONでも出力する
 * （scripts/benchmark/results/<timestamp>.json）。
 *
 * 対象組織:
 *   --org 未指定時は、scripts/benchmark/seed-synthetic.mjs で作られる専用組織
 *   "[BENCHTEST] Synthetic Load Org" が存在すればそれを、無ければ is_demo=true の
 *   デモ企業を対象にする（既存 scripts/benchmark-queries.mjs と同じデータソース）。
 *
 * 本番規模（100社/1000店/1000万注文相当）で測定する手順:
 *   1. ローカルSupabaseを起動: supabase start
 *   2. 大量データを投入（ローカル専用ガード付き。本番URLへは投入されない）:
 *        SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *          node scripts/benchmark/seed-synthetic.mjs --preset large --stores 100 --orders-per-store 100000
 *   3. 本スクリプトをローカルURLに向けて実行:
 *        SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *          node scripts/benchmark/run-benchmark.mjs --org <seed-synthetic.mjsが出力したorganization_id>
 *   4. ⚠が出たクエリは EXPLAIN ANALYZE（Supabase SQL Editor / psql）でindex利用を確認し、
 *      supabase/migrations/000xx_*.sql へ新しいindexを追加する（本タスクではmigration追加は対象外）。
 *
 * 現状（このスクリプトを本番/デモ環境に対して実行した場合）は既存データ規模での
 * 測定に留まる。デモ企業のデータ量は小さいため、⚠が出ないのは「速い」のではなく
 * 「本番規模でまだ測っていない」ことを意味する点に注意。
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('環境変数（URL / SUPABASE_SERVICE_ROLE_KEY）を設定してください');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const WARN_MS = Number(getArg('warn-ms', 500));

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const monthStart = new Date();
monthStart.setDate(1);
const monthStartStr = monthStart.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const monthAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

const results = [];
async function bench(category, name, fn) {
  const t0 = performance.now();
  const { data, error, count } = await fn();
  const ms = Math.round(performance.now() - t0);
  const flag = error ? '✗' : ms > WARN_MS ? '⚠' : '✓';
  console.log(`  ${flag} ${name}: ${ms}ms${count != null ? ` (${count}件)` : ''}${error ? ` ERROR: ${error.message}` : ''}`);
  results.push({
    category, name, ms, count: count ?? (Array.isArray(data) ? data.length : null),
    warn: !error && ms > WARN_MS, error: error?.message ?? null,
  });
  return ms;
}

async function main() {
  console.log('=== パフォーマンスベンチマーク（v0.5.0 TEST） ===');

  let orgId = getArg('org', null);
  let orgLabel;
  if (orgId) {
    orgLabel = `指定org ${orgId}`;
  } else {
    const { data: benchOrg } = await db.from('organizations')
      .select('id').eq('name', '[BENCHTEST] Synthetic Load Org').maybeSingle();
    if (benchOrg) {
      orgId = benchOrg.id;
      orgLabel = 'synthetic ([BENCHTEST] Synthetic Load Org)';
    } else {
      const { data: demoOrg } = await db.from('organizations').select('id').eq('is_demo', true).limit(1).single();
      orgId = demoOrg.id;
      orgLabel = 'デモ企業（is_demo=true。synthetic データ未投入のため既存データ規模での測定）';
    }
  }
  const { data: stores } = await db.from('stores').select('id').eq('organization_id', orgId);
  const storeIds = (stores ?? []).map((s) => s.id);
  const { count: orderCount } = await db.from('orders').select('id', { count: 'exact', head: true }).in('store_id', storeIds);
  console.log(`対象組織: ${orgLabel}`);
  console.log(`店舗数: ${storeIds.length} / 注文数: ${orderCount ?? '不明'}`);
  if (!storeIds.length) {
    console.error('対象組織に店舗がありません。seed.mjs または seed-synthetic.mjs を先に実行してください。');
    process.exit(1);
  }

  console.log('\n■ ダッシュボード当月集計');
  await bench('dashboard', '当月売上集計（store×month, paid/refunded）', () =>
    db.from('orders').select('total', { count: 'exact' }).in('store_id', storeIds)
      .gte('business_date', monthStartStr).lte('business_date', today).in('status', ['paid', 'refunded']));

  console.log('\n■ 注文一覧（range ページング）');
  await bench('orders_list', '注文一覧 50件（created_at降順・range(0,49)）', () =>
    db.from('orders').select('*', { count: 'exact' }).in('store_id', storeIds)
      .order('created_at', { ascending: false }).range(0, 49));
  // 後方ページ（seek far pagination）。件数が少ない環境（デモ企業等）でも
  // Requested range not satisfiable エラーにならないよう、実件数に収まる範囲へ丸める
  const backOffset = Math.max(0, Math.min(5000, (orderCount ?? 0) - 60));
  await bench('orders_list', `注文一覧 50件（後方ページ・range(${backOffset},${backOffset + 49})）`, () =>
    db.from('orders').select('*', { count: 'exact' }).in('store_id', storeIds)
      .order('created_at', { ascending: false }).range(backOffset, backOffset + 49));

  console.log('\n■ 顧客ILIKE検索（trigram index: idx_customers_*_trgm）');
  await bench('customer_search', '顧客検索（name/name_kana/phone のOR ILIKE）', () =>
    db.from('customers').select('*', { count: 'exact' }).eq('organization_id', orgId)
      .or('name.ilike.%田中%,name_kana.ilike.%田中%,phone.ilike.%080%').range(0, 49));
  await bench('customer_search', '顧客検索（電話番号の部分一致）', () =>
    db.from('customers').select('id', { count: 'exact' }).eq('organization_id', orgId)
      .ilike('phone', '%0001%'));

  console.log('\n■ 仕訳期間集計（journal_entry_lines: idx_journal_lines_account）');
  await bench('journal', '当月の確定仕訳一覧（posted, entry_date範囲）', () =>
    db.from('journal_entries').select('id, entry_date, description', { count: 'exact' })
      .eq('organization_id', orgId).eq('status', 'posted')
      .gte('entry_date', monthStartStr).lte('entry_date', today)
      .order('entry_date', { ascending: false }).limit(1000));
  await bench('journal', '勘定科目別・期間集計（journal_entry_lines join）', async () => {
    const { data: acct } = await db.from('accounts').select('id').eq('organization_id', orgId).limit(1).maybeSingle();
    if (!acct) return { data: [], error: null, count: 0 };
    return db.from('journal_entry_lines')
      .select('id, side, amount, journal_entries!inner(entry_date, status, organization_id)', { count: 'exact' })
      .eq('account_id', acct.id)
      .eq('journal_entries.organization_id', orgId)
      .eq('journal_entries.status', 'posted')
      .gte('journal_entries.entry_date', monthAgo);
  });

  console.log('\n■ 監査ログ');
  await bench('audit', '監査ログ検索 100件（created_at降順）', () =>
    db.from('audit_logs').select('*', { count: 'exact' }).eq('organization_id', orgId)
      .order('created_at', { ascending: false }).range(0, 99));
  await bench('audit', '監査ログ検索（action絞込）', () =>
    db.from('audit_logs').select('id', { count: 'exact' }).eq('organization_id', orgId)
      .ilike('action', '%order%').order('created_at', { ascending: false }).range(0, 99));

  const warnCount = results.filter((r) => r.warn).length;
  const errorCount = results.filter((r) => r.error).length;
  console.log(`\n※ ⚠は${WARN_MS}ms超（${warnCount}件）。件数増加時はEXPLAIN（Supabase SQL Editor）でindex利用を確認すること。`);
  if (errorCount) console.log(`※ エラー: ${errorCount}件（上記ログ参照）`);
  console.log('※ 本番規模での測定手順はこのファイル冒頭のコメントを参照。');

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'results');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(outPath, JSON.stringify({
    ranAt: new Date().toISOString(), url, orgId, orgLabel,
    storeCount: storeIds.length, orderCount: orderCount ?? null,
    warnThresholdMs: WARN_MS, results,
  }, null, 2));
  console.log(`\n結果JSON: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
