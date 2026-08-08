/**
 * TENPO ONE データ整合性監査スクリプト（v0.4.3 F4）
 *
 * 使い方: node --env-file=.env.local scripts/audit-data-integrity.mjs [--org <organization_id>]
 *         node --env-file=.env.local scripts/audit-data-integrity.mjs --strict
 *
 * 完全read-only。service role キーで参照するのみで、一切の書込・自動修復を行わない。
 * 既定では全企業を横断して検査する。--org で特定企業に絞り込める。
 *
 * 検出項目は各テーブルのFK制約・DBトリガー（immutable系）が正常に機能していれば
 * 基本的に0件になるはずのものが大半だが、直接SQL操作・移行時の不整合・将来の
 * スキーマ変更漏れ等に備えて実データを都度突き合わせて確認する。
 *
 * 出力: 項目ごとに件数と代表例ID（最大5件）を一覧表示。問題が1件もなければ
 * 「整合性OK」を表示する。終了コードは既定では常に0（本スクリプトは監査レポートで
 * あり、検出＝失敗ではない）。--strict を付けた場合のみ、問題が1件でもあれば
 * exit 1 にする（CI等での機械判定用）。
 *
 * 修復方針: 本スクリプトは検出のみ行う。実際の修復は各画面の正規操作
 * （修正仕訳・取消・締め直し等）で行うこと。DBを直接書き換えて辻褄を合わせない。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('環境変数（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const orgArgIdx = args.indexOf('--org');
const orgFilter = orgArgIdx >= 0 ? args[orgArgIdx + 1] : null;

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// ---------------------------------------------------------------
// 出力ヘルパー（verify-flow.mjs / verify-accounting-consistency.mjs と同じ
// section()/check() の流儀を踏襲。ただし本スクリプトは合否ではなく件数を報告する）
// ---------------------------------------------------------------
function section(title) {
  console.log(`\n■ ${title}`);
}

const problems = []; // { title, count, examples: string[] }
function report(title, count, examples = []) {
  problems.push({ title, count, examples });
  if (count === 0) {
    console.log(`  ✓ ${title}`);
  } else {
    console.log(`  ✗ ${title}: ${count}件`);
    examples.slice(0, 5).forEach((ex) => console.log(`      - ${ex}`));
  }
  return count;
}

// ---------------------------------------------------------------
// クエリヘルパー（PostgRESTの既定1000件上限をrange()で越えて全件取得。
// MVP〜実店舗パイロット規模を想定。数百万件規模になった場合の方針は
// docs/data-scaling.md を参照）
// ---------------------------------------------------------------
async function fetchAll(queryFactory, pageSize = 1000) {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function fetchByIds(table, idCol, ids, selectStr, extraFilter) {
  const result = [];
  const uniqueIds = [...new Set(ids)].filter((v) => v !== null && v !== undefined);
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const chunk = uniqueIds.slice(i, i + 200);
    const rows = await fetchAll(() => {
      let q = admin.from(table).select(selectStr).in(idCol, chunk);
      if (extraFilter) q = extraFilter(q);
      return q;
    });
    result.push(...rows);
  }
  return result;
}

function withOrg(query, col = 'organization_id') {
  return orgFilter ? query.eq(col, orgFilter) : query;
}

function daysBetween(dateStrPast, dateStrNow) {
  const a = new Date(`${dateStrPast}T00:00:00Z`);
  const b = new Date(`${dateStrNow}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

const bizDateCache = new Map();
async function businessDateOf(storeId) {
  if (bizDateCache.has(storeId)) return bizDateCache.get(storeId);
  const { data, error } = await admin.rpc('app_business_date', { p_store_id: storeId });
  if (error) throw error;
  bizDateCache.set(storeId, data);
  return data;
}

// ---------------------------------------------------------------
// 汎用: 子テーブル→親テーブルの anti-join（孤児検出）
// FK制約が効いていれば通常0件。制約が効いていない/迂回された場合の検証用。
// ---------------------------------------------------------------
async function findOrphans(childTable, childFkCol, parentTable, parentIdCol, orgCol = 'organization_id') {
  const children = await fetchAll(() =>
    withOrg(admin.from(childTable).select(`id, ${childFkCol}`).not(childFkCol, 'is', null), orgCol));
  if (children.length === 0) return { count: 0, examples: [] };
  const fkIds = [...new Set(children.map((c) => c[childFkCol]))];
  const parents = await fetchByIds(parentTable, parentIdCol, fkIds, parentIdCol);
  const existing = new Set(parents.map((p) => p[parentIdCol]));
  const orphans = children.filter((c) => !existing.has(c[childFkCol]));
  return { count: orphans.length, examples: orphans.map((o) => o.id) };
}

// ---------------------------------------------------------------
// 汎用: 子テーブルのorganization_id/store_idが親と不一致（テナント越境検出）
// ---------------------------------------------------------------
async function findTenantMismatch(
  childTable, childKeyCol, childFkCol, parentTable, parentIdCol, parentKeyCol,
  childOrgCol = 'organization_id',
) {
  const children = await fetchAll(() =>
    withOrg(admin.from(childTable).select(`id, ${childKeyCol}, ${childFkCol}`), childOrgCol));
  if (children.length === 0) return { count: 0, examples: [] };
  const fkIds = [...new Set(children.map((c) => c[childFkCol]).filter(Boolean))];
  const parents = await fetchByIds(parentTable, parentIdCol, fkIds, `${parentIdCol}, ${parentKeyCol}`);
  const parentMap = new Map(parents.map((p) => [p[parentIdCol], p[parentKeyCol]]));
  const bad = children.filter((c) => c[childFkCol] && parentMap.has(c[childFkCol])
    && parentMap.get(c[childFkCol]) !== c[childKeyCol]);
  return { count: bad.length, examples: bad.map((c) => c.id) };
}

async function main() {
  console.log('=== TENPO ONE データ整合性監査 ===');
  if (orgFilter) {
    const { data: org } = await admin.from('organizations').select('id, name').eq('id', orgFilter).single();
    if (!org) {
      console.error(`指定された企業IDが見つかりません: ${orgFilter}`);
      process.exitCode = 1;
      return;
    }
    console.log(`対象企業: ${org.name} (${org.id})`);
  } else {
    console.log('対象: 全企業横断');
  }

  // ============================================================
  section('1. 孤児レコード（FK制約の再確認。通常は0件）');
  // ============================================================
  {
    const r1 = await findOrphans('order_items', 'order_id', 'orders', 'id');
    report('order_items → orders 欠損', r1.count, r1.examples);
    const r2 = await findOrphans('payments', 'order_id', 'orders', 'id');
    report('payments → orders 欠損', r2.count, r2.examples);
    const r3 = await findOrphans('refund_items', 'refund_id', 'refunds', 'id');
    report('refund_items → refunds 欠損', r3.count, r3.examples);
    const r4 = await findOrphans('journal_entry_lines', 'entry_id', 'journal_entries', 'id');
    report('journal_entry_lines → journal_entries 欠損', r4.count, r4.examples);
  }

  // ============================================================
  section('2. paid注文の支払整合性');
  // ============================================================
  {
    const orders = await fetchAll(() =>
      withOrg(admin.from('orders').select('id, total, organization_id, store_id').eq('status', 'paid')));
    let noPayments = [];
    let mismatch = [];
    if (orders.length > 0) {
      const orderIds = orders.map((o) => o.id);
      const payments = await fetchByIds('payments', 'order_id', orderIds, 'order_id, amount, status');
      const sumMap = new Map();
      for (const p of payments) {
        if (p.status !== 'completed') continue;
        sumMap.set(p.order_id, (sumMap.get(p.order_id) ?? 0) + p.amount);
      }
      noPayments = orders.filter((o) => !sumMap.has(o.id));
      mismatch = orders.filter((o) => sumMap.has(o.id) && sumMap.get(o.id) !== o.total);
    }
    report('paidなのにpaymentsが無い注文', noPayments.length, noPayments.map((o) => o.id));
    report('payments合計 ≠ orders.total（paid注文）', mismatch.length,
      mismatch.map((o) => `${o.id}`));
  }

  // ============================================================
  section('3. ordersの無いpayments');
  // ============================================================
  {
    const nullOrderPays = await fetchAll(() =>
      withOrg(admin.from('payments').select('id').is('order_id', null)));
    report('order_id が null の payments（NOT NULL制約により通常発生しない）',
      nullOrderPays.length, nullOrderPays.map((p) => p.id));
    const orphanPays = await findOrphans('payments', 'order_id', 'orders', 'id');
    report('order_id が存在しない payments（1.と同一集合の再掲）', orphanPays.count, orphanPays.examples);
  }

  // ============================================================
  section('4. 返金超過（注文単位: refunds合計 > payments合計）');
  // ============================================================
  {
    const payments = await fetchAll(() => withOrg(admin.from('payments').select('order_id, amount').eq('status', 'completed')));
    const refunds = await fetchAll(() => withOrg(admin.from('refunds').select('order_id, amount')));
    const paySum = new Map();
    for (const p of payments) paySum.set(p.order_id, (paySum.get(p.order_id) ?? 0) + p.amount);
    const refSum = new Map();
    for (const r of refunds) refSum.set(r.order_id, (refSum.get(r.order_id) ?? 0) + r.amount);
    const bad = [];
    for (const [orderId, sum] of refSum) {
      const paid = paySum.get(orderId) ?? 0;
      if (sum > paid) bad.push(`${orderId}（返金合計¥${sum} > 支払合計¥${paid}）`);
    }
    report('返金合計が支払合計を超過している注文', bad.length, bad);
  }

  // ============================================================
  section('5. 仕訳不一致');
  // ============================================================
  {
    const postedEntries = await fetchAll(() => withOrg(admin.from('journal_entries').select('id').eq('status', 'posted')));
    let unbalanced = [];
    if (postedEntries.length > 0) {
      const entryIds = postedEntries.map((e) => e.id);
      const lines = await fetchByIds('journal_entry_lines', 'entry_id', entryIds, 'entry_id, side, amount');
      const balMap = new Map();
      for (const l of lines) {
        const cur = balMap.get(l.entry_id) ?? { debit: 0, credit: 0 };
        if (l.side === 'debit') cur.debit += l.amount; else cur.credit += l.amount;
        balMap.set(l.entry_id, cur);
      }
      for (const [id, b] of balMap) if (b.debit !== b.credit) unbalanced.push(`${id}（借方¥${b.debit}/貸方¥${b.credit}）`);
    }
    report('posted仕訳で借方合計≠貸方合計（DB強制済みのはずの再確認）', unbalanced.length, unbalanced);

    const jelMismatch = await findTenantMismatch(
      'journal_entry_lines', 'organization_id', 'entry_id', 'journal_entries', 'id', 'organization_id');
    report('journal_entry_lines.organization_id ≠ 親journal_entries.organization_id',
      jelMismatch.count, jelMismatch.examples);
  }

  // ============================================================
  section('6. 在庫マイナス異常（allow_negative_stock=falseの店舗）');
  // ============================================================
  {
    const settings = await fetchAll(() =>
      withOrg(admin.from('store_settings').select('store_id, organization_id').eq('allow_negative_stock', false)));
    let bad = [];
    if (settings.length > 0) {
      const storeIds = settings.map((s) => s.store_id);
      const items = await fetchByIds('inventory_items', 'store_id', storeIds,
        'id, store_id, name, current_quantity, status', (q) => q.eq('status', 'active'));
      bad = items.filter((i) => Number(i.current_quantity) < 0);
    }
    report('allow_negative_stock=falseの店舗でcurrent_quantity<0', bad.length,
      bad.map((i) => `${i.id}（${i.name}: ${i.current_quantity}）`));
  }

  // ============================================================
  section('7. register未締め（2営業日以上前のbusiness_dateでopen）');
  // ============================================================
  {
    const sessions = await fetchAll(() =>
      withOrg(admin.from('register_sessions').select('id, store_id, business_date, organization_id').eq('status', 'open')));
    const bad = [];
    for (const s of sessions) {
      const bd = await businessDateOf(s.store_id);
      if (daysBetween(s.business_date, bd) >= 2) bad.push(s);
    }
    report('2営業日以上前のbusiness_dateでstatus=openのregister_sessions', bad.length,
      bad.map((s) => `${s.id}（店舗${s.store_id} / ${s.business_date}）`));
  }

  // ============================================================
  section('8. 重複予約（同一店舗×卓×confirmed/seatedの時間帯重複）');
  // ============================================================
  {
    const reservations = await fetchAll(() =>
      withOrg(admin.from('reservations').select('id, store_id, start_at, end_at, status, organization_id')
        .in('status', ['confirmed', 'seated'])));
    let bad = [];
    if (reservations.length > 0) {
      const resIds = reservations.map((r) => r.id);
      const links = await fetchByIds('reservation_tables', 'reservation_id', resIds, 'reservation_id, table_id');
      const resById = new Map(reservations.map((r) => [r.id, r]));
      const byTable = new Map();
      for (const l of links) {
        const res = resById.get(l.reservation_id);
        if (!res) continue;
        const arr = byTable.get(l.table_id) ?? [];
        arr.push(res);
        byTable.set(l.table_id, arr);
      }
      for (const [tableId, list] of byTable) {
        list.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
        for (let i = 0; i < list.length; i += 1) {
          for (let j = i + 1; j < list.length; j += 1) {
            const a = list[i]; const b = list[j];
            if (new Date(b.start_at) >= new Date(a.end_at)) break; // ソート済みなのでこれ以降は重複なし
            if (new Date(a.start_at) < new Date(b.end_at) && new Date(a.end_at) > new Date(b.start_at)) {
              bad.push(`卓${tableId}: ${a.id} × ${b.id}`);
            }
          }
        }
      }
    }
    report('同一卓×confirmed/seatedで時間帯が重複する予約の組', bad.length, bad);
  }

  // ============================================================
  section('9. 重複payment（同一order×method×amount×同一分内の複数completed）');
  // ============================================================
  {
    const payments = await fetchAll(() =>
      withOrg(admin.from('payments').select('id, order_id, method, amount, paid_at, organization_id').eq('status', 'completed')));
    const groups = new Map();
    for (const p of payments) {
      const minuteKey = (p.paid_at ?? '').slice(0, 16);
      const key = `${p.order_id}|${p.method}|${p.amount}|${minuteKey}`;
      const arr = groups.get(key) ?? [];
      arr.push(p.id);
      groups.set(key, arr);
    }
    const bad = [];
    for (const [key, ids] of groups) if (ids.length > 1) bad.push(`${key} → ${ids.join(', ')}`);
    report('同一注文×方法×金額×同一分内に複数のcompleted支払（真の重複疑い）', bad.length, bad);
  }

  // ============================================================
  section('10. 給与snapshot欠損（approved payroll_runsでrules_snapshotがnull）');
  // ============================================================
  {
    const rows = await fetchAll(() =>
      withOrg(admin.from('payroll_runs').select('id, title, organization_id').eq('status', 'approved').is('rules_snapshot', null)));
    report('status=approvedでrules_snapshotがnullのpayroll_runs', rows.length,
      rows.map((r) => `${r.id}（${r.title}）`));
  }

  // ============================================================
  section('11. tenant mismatch（代表5経路: 子のorganization_id ≠ 親のorganization_id）');
  // ============================================================
  {
    const p1 = await findTenantMismatch('orders', 'organization_id', 'store_id', 'stores', 'id', 'organization_id');
    report('orders.organization_id ≠ 親stores.organization_id（order→org）', p1.count, p1.examples);
    const p2 = await findTenantMismatch('order_items', 'organization_id', 'order_id', 'orders', 'id', 'organization_id');
    report('order_items.organization_id ≠ 親orders.organization_id', p2.count, p2.examples);
    const p3 = await findTenantMismatch('payments', 'organization_id', 'order_id', 'orders', 'id', 'organization_id');
    report('payments.organization_id ≠ 親orders.organization_id（payment→order.org）', p3.count, p3.examples);
    const p4 = await findTenantMismatch('refunds', 'organization_id', 'order_id', 'orders', 'id', 'organization_id');
    report('refunds.organization_id ≠ 親orders.organization_id', p4.count, p4.examples);
    const p5 = await findTenantMismatch(
      'journal_entry_lines', 'organization_id', 'entry_id', 'journal_entries', 'id', 'organization_id');
    report('journal_entry_lines.organization_id ≠ 親journal_entries.organization_id（5.と同一集合の再掲）',
      p5.count, p5.examples);
  }

  // ============================================================
  section('12. store mismatch（子のstore_id ≠ 親orders.store_id）');
  // ============================================================
  {
    const s1 = await findTenantMismatch('order_items', 'store_id', 'order_id', 'orders', 'id', 'store_id');
    report('order_items.store_id ≠ 親orders.store_id', s1.count, s1.examples);
    const s2 = await findTenantMismatch('payments', 'store_id', 'order_id', 'orders', 'id', 'store_id');
    report('payments.store_id ≠ 親orders.store_id', s2.count, s2.examples);
    const s3 = await findTenantMismatch('refunds', 'store_id', 'order_id', 'orders', 'id', 'store_id');
    report('refunds.store_id ≠ 親orders.store_id', s3.count, s3.examples);
  }

  // ============================================================
  section('13. 未日次締め（3営業日以上前にpaid注文があるのにdaily_closingsが無い）');
  // ============================================================
  {
    const orders = await fetchAll(() =>
      withOrg(admin.from('orders').select('store_id, business_date, organization_id').eq('status', 'paid')));
    let bad = [];
    if (orders.length > 0) {
      const pairs = new Map();
      for (const o of orders) pairs.set(`${o.store_id}|${o.business_date}`, { storeId: o.store_id, date: o.business_date });
      const storeIds = [...new Set(orders.map((o) => o.store_id))];
      const candidates = [];
      for (const p of pairs.values()) {
        const bd = await businessDateOf(p.storeId);
        if (daysBetween(p.date, bd) >= 3) candidates.push(p);
      }
      if (candidates.length > 0) {
        const closings = await fetchByIds('daily_closings', 'store_id', storeIds, 'store_id, business_date');
        const closedSet = new Set(closings.map((c) => `${c.store_id}|${c.business_date}`));
        bad = candidates.filter((c) => !closedSet.has(`${c.storeId}|${c.date}`));
      }
    }
    report('3営業日以上前にpaid注文があるのにdaily_closingsが無い店舗×日', bad.length,
      bad.map((b) => `店舗${b.storeId} / ${b.date}`));
  }

  // ============================================================
  const totalProblems = problems.reduce((a, p) => a + p.count, 0);
  console.log('\n=== 監査結果 ===');
  if (totalProblems === 0) {
    console.log('整合性OK（検出項目なし）');
  } else {
    console.log(`検出件数: ${totalProblems}件（内訳は上記項目別ログを参照）`);
    console.log('\n件数のある項目:');
    problems.filter((p) => p.count > 0).forEach((p) => console.log(` - ${p.title}: ${p.count}件`));
    console.log('\n本スクリプトは読み取り専用です。修復は各画面の正規操作（修正仕訳・取消・締め）で行ってください。');
  }

  // Windows環境でprocess.exit()を直後に呼ぶとundici/libuvのソケットクローズと競合し
  // クラッシュすることがあるため、明示的なexit()は呼ばずexitCodeの設定のみに留めて
  // イベントループを自然に空にする（main()の完了を待って正常終了させる）。
  if (strict && totalProblems > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('\n監査中断:', e.message); process.exitCode = 1; });
