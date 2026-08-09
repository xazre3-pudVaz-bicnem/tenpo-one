/**
 * TENPO ONE v0.4.3 — 「1か月営業シミュレーション + 月末処理」実環境検証スクリプト（VER-E4）
 *
 * 使い方: node --env-file=.env.local scripts/verify-store-month.mjs
 *
 * verify-store-day.mjs（D4）/ verify-store-week.mjs（E4）と同じ流儀（check()/section()での記録・
 * service roleは準備/照合専用・scripts/pilot-org.mjsのensurePilotOrg()/cleanupPilotDay()/
 * loginPilotUser()を再利用）で、専用テスト企業「[PILOT] TENPO ONE検証企業」に「過去1か月分の
 * 営業日（直近の1つ前の暦月・28-31日）」を教科書どおりに手組みで積み上げ、月末処理
 * （勤怠確定→給与確定→給与仕訳→売上/返金/経費/仕入仕訳→棚卸確定→月次締め→試算表/P L/B S）
 * を可能な限り実関数・実RPCで一周させる。
 *
 * データ隔離の方針（重要）:
 *  - 月次シミュレーションは1か月分×毎日5-10取引の大量データになり、payments/refunds/
 *    paid注文・postedな仕訳・確定した棚卸・承認済み給与runはいずれもDBトリガーにより
 *    物理削除できない（会計の不変性はこのアプリの中核設計）。
 *  - そこで週次スクリプトの「累積許容」方式ではなく、専用の第2店舗
 *    「pilot-shinjuku-monthly」（このスクリプトが自前でget-or-createする。pilot-org.mjsは
 *    変更しない）にすべての月次データを隔離し、削除できないデータは店舗ごと残す方式を採る。
 *    こうすることで、週次スクリプトが使う本店舗（pilot-shinjuku）や日次スクリプトの
 *    「本日」分のデータと物理的に混ざらない。
 *  - 仕訳（journal_entries）と会計期間（accounting_periods）だけは再実行のたびにvoid/reopen/
 *    削除して完全にリセットする（後始末セクション参照）。棚卸・給与run・注文等の隔離店舗内の
 *    データは削除せず残す（このスクリプトの再実行は同一暦月に対して安全に繰り返せる設計）。
 *
 * 対象期間の選び方:
 *  - 「本日を含む直近30日」ではなく、実行日から見て「1つ前の暦月」を対象とする
 *    （例: 実行日が2026-08-09なら対象は2026-07-01〜2026-07-31の31日間）。
 *    月末締め（close_accounting_period）は本質的に過去の確定した暦月に対して行う操作であり、
 *    日をまたぐ実行でも対象期間がぶれない・週次スクリプト（直近7日=当月）と日付が重複しない
 *    という2点から、暦月境界を採用した。
 *
 * 金額の設計（重要・恣意的ではなく意図的な整合）:
 *  - 仕入請求書2件の金額は、その月の実原価（理論原価+廃棄+棚卸差異。lib/metrics.
 *    computeCostVarianceの定義）に一致するよう事後的にサイズを合わせている。
 *    これにより「仕訳ベースの原価（勘定科目500への計上額）」と「metricsベースの実原価
 *    （在庫消費からの算出）」が意図的に一致し、P/Lの恒等式チェックが実際に成立する
 *    （会計帳簿と実棚卸を突き合わせる、という実務の月次締め作業を模している）。
 *  - 給与仕訳・経費仕訳・売上/返金仕訳は、いずれも「画面で使われるのと同じ元データ」から
 *    lib/accounting.tsの本物のビルダー関数（buildSalesJournal等）で生成するため、
 *    metricsベースの人件費・経費とも自動的に一致する。
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { ensurePilotOrg, cleanupPilotDay, loginPilotUser, fetchAllRows } from './pilot-org.mjs';
import { computeSalesMetrics, expectedCash, computeCostVariance, SETTLED_ORDER_STATUSES } from '../lib/metrics.ts';
import { summarizeEntry, calcPayroll, calcCommission } from '../lib/payroll.ts';
import {
  STD, buildSalesJournal, buildRefundJournal, buildPurchaseJournal, buildExpenseJournal, buildPayrollJournal,
  aggregateTrialBalance, buildOperatingStatement, buildBalanceSheet, classifyExpense,
} from '../lib/accounting.ts';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('環境変数（URL / SERVICE_ROLE_KEY）を設定してください');
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
}
function section(title) {
  console.log(`\n■ ${title}`);
}
async function safe(label, fn) {
  try { await fn(); } catch (e) { console.log(`  ! 後始末で警告: ${label}: ${e.message ?? e}`); }
}

// ---------------------------------------------------------------
// 基本ヘルパー
// ---------------------------------------------------------------
const todayJst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const rand = () => Math.random();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pad2 = (n) => String(n).padStart(2, '0');

function sumKind(rows, kind) {
  return (rows ?? []).filter((r) => r.kind === kind).reduce((a, r) => a + r.amount, 0);
}

/** 注文金額の計算式（supabase/migrations/00002_functions.sql recalc_order_totalsと同一式・税込10%固定） */
function computeOrderTotals(items) {
  let gross = 0;
  let tax = 0;
  for (const { mi, qty } of items) {
    const lineGross = mi.price * qty;
    const lineTax = lineGross - Math.floor(lineGross / (1 + 10 / 100));
    gross += lineGross;
    tax += lineTax;
  }
  return { subtotal: gross - tax, taxTotal: tax, total: Math.max(0, gross) };
}

/** 現金/カード/QR/併用を織り交ぜた支払プラン（verify-store-day.mjsと同一ロジック） */
function paymentPlan(total) {
  const r = rand();
  const cashLeg = (amount) => ({ method: 'cash', amount, tendered: Math.ceil(amount / 1000) * 1000 });
  if (total < 20 || r < 0.4) return [cashLeg(total)];
  if (r < 0.62) return [{ method: 'credit', amount: total }];
  if (r < 0.8) return [{ method: 'qr', amount: total }];
  if (r < 0.88) return [{ method: 'emoney', amount: total }];
  if (r < 0.94) {
    const c = Math.max(10, Math.min(total - 10, Math.floor((total * 0.4) / 10) * 10));
    return [cashLeg(c), { method: 'credit', amount: total - c }];
  }
  const c = Math.max(10, Math.min(total - 10, Math.floor((total * 0.5) / 10) * 10));
  return [cashLeg(c), { method: 'qr', amount: total - c }];
}

async function main() {
  console.log('=== TENPO ONE 1か月営業シミュレーション + 月末処理 検証（VER-E4） ===');
  const startedAt = Date.now();

  // ============================================================
  section('準備: 専用テスト企業のget-or-create → 専用第2店舗（月次隔離用）のget-or-create');
  // ============================================================
  const ctx = await ensurePilotOrg();
  const { org, menuItems, menuByName, staff } = ctx;
  check('専用テスト企業はis_demo=false', org.is_demo === false);

  // ---- 専用第2店舗（pilot-shinjuku-monthly）。pilot-org.mjsは変更せずこのスクリプト内で完結させる ----
  const MSTORE_SLUG = 'pilot-shinjuku-monthly';
  let mstore;
  {
    const { data: existing } = await admin.from('stores').select('*').eq('organization_id', org.id).eq('slug', MSTORE_SLUG).limit(1);
    if (existing?.length) mstore = existing[0];
    else {
      const { data, error } = await admin.from('stores').insert({
        organization_id: org.id, slug: MSTORE_SLUG, name: 'TENPO ONE 新宿店(月次検証専用/データ隔離)',
        address: '東京都新宿区西新宿1-1-1 検証ビル2F', phone: '03-0000-9002', seat_count: 30, booking_enabled: false,
        description: '[PILOT-MONTH] 1か月営業シミュレーション検証専用店舗（物理削除不可データの隔離先）',
      }).select().single();
      if (error) throw new Error('monthly store: ' + error.message);
      mstore = data;
    }
  }
  check('月次検証専用店舗（pilot-shinjuku-monthly）を用意できた', !!mstore?.id);

  let mregister;
  {
    const { data: existing } = await admin.from('registers').select('*').eq('store_id', mstore.id).eq('name', 'レジ01').limit(1);
    if (existing?.length) mregister = existing[0];
    else {
      const { data, error } = await admin.from('registers').insert({ organization_id: org.id, store_id: mstore.id, name: 'レジ01' }).select().single();
      if (error) throw new Error('monthly register: ' + error.message);
      mregister = data;
    }
  }
  check('月次検証専用店舗のレジを用意できた', !!mregister?.id);

  async function ensureMonthlyInventoryItem(def) {
    const { data: existing } = await admin.from('inventory_items').select('*').eq('store_id', mstore.id).eq('name', def.name).limit(1);
    if (existing?.length) return existing[0];
    const { data, error } = await admin.from('inventory_items').insert({ organization_id: org.id, store_id: mstore.id, ...def }).select().single();
    if (error) throw new Error(`monthly inventory_items(${def.name}): ` + error.message);
    return data;
  }
  const minv = {
    beer: await ensureMonthlyInventoryItem({ name: '生ビールサーバー', item_kind: 'product', unit: '杯', current_quantity: 1000, reorder_point: 50, avg_cost: 200, menu_item_id: menuByName['生ビール'].id }),
    wine: await ensureMonthlyInventoryItem({ name: 'グラスワインボトル', item_kind: 'product', unit: '杯', current_quantity: 800, reorder_point: 40, avg_cost: 250, menu_item_id: menuByName['グラスワイン'].id }),
    chicken: await ensureMonthlyInventoryItem({ name: '鶏もも肉', item_kind: 'ingredient', unit: 'g', current_quantity: 80000, reorder_point: 3000, avg_cost: 2, menu_item_id: null }),
    beef: await ensureMonthlyInventoryItem({ name: '牛ひき肉', item_kind: 'ingredient', unit: 'g', current_quantity: 80000, reorder_point: 3000, avg_cost: 3, menu_item_id: null }),
    fish: await ensureMonthlyInventoryItem({ name: '本日の鮮魚', item_kind: 'ingredient', unit: 'g', current_quantity: 50000, reorder_point: 2000, avg_cost: 4, menu_item_id: null }),
    oshibori: await ensureMonthlyInventoryItem({ name: 'おしぼり', item_kind: 'supply', unit: '本', current_quantity: 3000, reorder_point: 200, avg_cost: 10, menu_item_id: null }),
    waribashi: await ensureMonthlyInventoryItem({ name: '割り箸', item_kind: 'supply', unit: '膳', current_quantity: 4000, reorder_point: 300, avg_cost: 5, menu_item_id: null }),
  };
  check('月次検証専用店舗の在庫品目7点を用意できた', Object.values(minv).every((i) => !!i?.id));

  // ---- 経費科目（organization_id スコープ・店舗非依存。get-or-create） ----
  const { data: accsForExpense } = await admin.from('accounts').select('id,code').eq('organization_id', org.id);
  const accByCodeForExpense = Object.fromEntries((accsForExpense ?? []).map((a) => [a.code, a.id]));
  const expenseAccounts = {};
  for (const [code, name, stdCode] of [
    ['EXP-SUPPLY', '[PILOT] 消耗品費', '520'],
    ['EXP-UTIL', '[PILOT] 水道光熱費', '521'],
  ]) {
    const { data, error } = await admin.from('expense_accounts')
      .upsert({ organization_id: org.id, code, name, account_id: accByCodeForExpense[stdCode] ?? null }, { onConflict: 'organization_id,code' })
      .select().single();
    if (error) throw new Error('expense_accounts: ' + error.message);
    expenseAccounts[code] = data;
  }
  check('経費科目2件（消耗品費・水道光熱費）を用意できた', !!expenseAccounts['EXP-SUPPLY'] && !!expenseAccounts['EXP-UTIL']);

  // ============================================================
  section('対象期間: 直近の1つ前の暦月を計算 → 対象日クリーンアップ');
  // ============================================================
  const [ty, tm] = todayJst().split('-').map(Number);
  let py = ty, pm = tm - 1;
  if (pm === 0) { pm = 12; py -= 1; }
  const monthStr = `${py}-${pad2(pm)}`;
  const monthStartDate = `${monthStr}-01`;
  const daysInMonth = new Date(py, pm, 0).getDate();
  const businessDates = [];
  for (let d = 1; d <= daysInMonth; d++) businessDates.push(`${monthStr}-${pad2(d)}`);
  console.log(`  対象月: ${monthStr}（${businessDates.length}日間: ${businessDates[0]} 〜 ${businessDates[businessDates.length - 1]}）`);
  check('対象期間は28-31日の1つ前の暦月', businessDates.length >= 28 && businessDates.length <= 31, `実際:${businessDates.length}日`);

  for (const d of businessDates) await cleanupPilotDay(org.id, d);
  console.log(`  対象${businessDates.length}日すべてクリーンアップ完了`);

  const owner = await loginPilotUser(staff.owner.email);

  // 月初在庫スナップショット（このスクリプト専用店舗なので「このスクリプトの実行時点」が月初に相当する）
  const trackedInv = ['beer', 'wine', 'chicken', 'beef', 'fish'];
  const invBefore = {};
  for (const key of trackedInv) {
    const { data } = await admin.from('inventory_items').select('current_quantity').eq('id', minv[key].id).single();
    invBefore[key] = Number(data.current_quantity);
  }
  const invDelta = Object.fromEntries(trackedInv.map((k) => [k, 0]));

  const WORKERS = ['manager', 'staff1', 'staff2', 'staff3', 'parttime1', 'parttime2', 'parttime3'];

  function randomItems(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ mi: pick(menuItems), qty: randInt(1, 3) });
    return out;
  }
  const karaageId = menuByName['鶏の唐揚げ'].id;
  const hamburgId = menuByName['和牛ハンバーグ'].id;
  const sashimiId = menuByName['本日の刺身盛り'].id;
  const beerId = menuByName['生ビール'].id;
  const wineId = menuByName['グラスワイン'].id;

  function mkMove(inventoryItemId, quantity, orderId, date) {
    return { id: randomUUID(), organization_id: org.id, store_id: mstore.id, inventory_item_id: inventoryItemId, movement_type: 'sale', quantity, ref_order_id: orderId, business_date: date };
  }
  function monthSaleMovements(orderId, items, date) {
    const rows = [];
    for (const { mi, qty } of items) {
      if (mi.id === beerId) { rows.push(mkMove(minv.beer.id, -qty, orderId, date)); invDelta.beer -= qty; }
      else if (mi.id === wineId) { rows.push(mkMove(minv.wine.id, -qty, orderId, date)); invDelta.wine -= qty; }
      else if (mi.id === karaageId) { const q = qty * 200; rows.push(mkMove(minv.chicken.id, -q, orderId, date)); invDelta.chicken -= q; }
      else if (mi.id === hamburgId) { const q = qty * 150; rows.push(mkMove(minv.beef.id, -q, orderId, date)); invDelta.beef -= q; }
      else if (mi.id === sashimiId) { const q = qty * 120; rows.push(mkMove(minv.fish.id, -q, orderId, date)); invDelta.fish -= q; }
    }
    return rows;
  }

  // 1日5-10取引という軽量な売上規模に対して、7名×フルシフト×31日では人件費が
  // 売上を大幅に超過してしまう（現実離れした人件費率になる）。そこで「1日2名・3時間勤務」の
  // ローテーション制（di%7とdi+3%7で必ず異なる2名を選ぶ・7名を31日で均等にカバー）にして、
  // 小規模パイロット店舗として妥当な人件費水準に調整している。
  function monthTimeEntryRows(date, di) {
    const rows = [];
    const mk = (key, inH, inM, outH, outM, breakMin) => {
      const cin = new Date(`${date}T${pad2(inH)}:${pad2(inM)}:00+09:00`);
      const cout = new Date(`${date}T${pad2(outH)}:${pad2(outM)}:00+09:00`);
      rows.push({
        id: randomUUID(), organization_id: org.id, store_id: mstore.id, profile_id: staff[key].id,
        work_date: date, clock_in_at: cin.toISOString(), clock_out_at: cout.toISOString(),
        break_minutes: breakMin, entry_type: 'normal', status: 'closed', source: 'manual',
      });
    };
    const todayWorkers = [...new Set([WORKERS[di % 7], WORKERS[(di + 3) % 7]])];
    for (const key of todayWorkers) {
      if (key === 'staff3' && di === 15) mk('staff3', 16, 0, 23, 0, 0); // 深夜割増(night_minutes>0)の実地検証用に1日だけ延長
      else mk(key, 12, 0, 15, 0, 0);
    }
    return rows;
  }

  // ============================================================
  section(`日次データ構築（${businessDates.length}日×1日5-10取引・すべて手組み）`);
  // ============================================================
  const monthRefundIds = [];
  const dayErrors = [];
  const salesByStaffDate = {}; // staffId -> subtotal合計（歩合計算用）
  let ordersGenerated = 0;

  async function buildMonthDay(date, di) {
    try {
      const sessionId = randomUUID();
      let e;
      ({ error: e } = await admin.from('register_sessions').insert({
        id: sessionId, organization_id: org.id, store_id: mstore.id, register_id: mregister.id,
        business_date: date, opened_by: staff.manager.id, opened_at: `${date}T10:00:00+09:00`,
        opening_float: 20000, status: 'open',
      }));
      if (e) throw new Error(`register_sessions: ${e.message}`);

      const txCount = randInt(5, 10);
      const orderRows = [], itemRows = [], paymentRows = [], cashRows = [], stockRows = [];
      const orderPlans = [];
      for (let i = 0; i < txCount; i++) {
        const items = randomItems(randInt(1, 3));
        const totals = computeOrderTotals(items);
        const staffKey = pick(WORKERS);
        const orderId = randomUUID();
        const openedAt = new Date(`${date}T${pad2(17 + (i % 6))}:${pad2((i * 11) % 60)}:00+09:00`);
        orderRows.push({
          id: orderId, organization_id: org.id, store_id: mstore.id, order_type: 'dine_in',
          guest_count: randInt(1, 4), staff_id: staff[staffKey].id,
          subtotal: totals.subtotal, discount_total: 0, service_charge: 0, tax_total: totals.taxTotal,
          rounding_adjustment: 0, total: totals.total, status: 'paid',
          business_date: date, opened_at: openedAt.toISOString(), closed_at: openedAt.toISOString(),
          register_session_id: sessionId,
        });
        for (const { mi, qty } of items) {
          itemRows.push({
            id: randomUUID(), organization_id: org.id, store_id: mstore.id, order_id: orderId,
            menu_item_id: mi.id, name: mi.name, unit_price: mi.price, quantity: qty,
            tax_rate: 10, tax_included: true, line_total: mi.price * qty, staff_id: staff[staffKey].id, status: 'active',
          });
        }
        const plan = paymentPlan(totals.total);
        let cashSum = 0;
        for (const p of plan) {
          paymentRows.push({
            id: randomUUID(), organization_id: org.id, store_id: mstore.id, order_id: orderId,
            register_session_id: sessionId, method: p.method, amount: p.amount,
            tendered: p.tendered ?? null, change_amount: p.tendered ? Math.max(0, p.tendered - p.amount) : null,
            status: 'completed', paid_at: openedAt.toISOString(), business_date: date,
          });
          if (p.method === 'cash') cashSum += p.amount;
        }
        if (cashSum > 0) {
          cashRows.push({
            id: randomUUID(), organization_id: org.id, store_id: mstore.id, register_session_id: sessionId,
            kind: 'sale', amount: cashSum, purpose: '[PILOT-MONTH] 売上', order_id: orderId,
            business_date: date, status: 'active', approval_status: 'approved', occurred_at: openedAt.toISOString(),
          });
        }
        stockRows.push(...monthSaleMovements(orderId, items, date));
        orderPlans.push({ orderId, total: totals.total, subtotal: totals.subtotal, staffId: staff[staffKey].id });
        salesByStaffDate[staff[staffKey].id] = (salesByStaffDate[staff[staffKey].id] ?? 0) + totals.subtotal;
      }

      ({ error: e } = await admin.from('orders').insert(orderRows)); if (e) throw new Error(`orders: ${e.message}`);
      ({ error: e } = await admin.from('order_items').insert(itemRows)); if (e) throw new Error(`order_items: ${e.message}`);
      ({ error: e } = await admin.from('payments').insert(paymentRows)); if (e) throw new Error(`payments: ${e.message}`);
      if (cashRows.length) { ({ error: e } = await admin.from('cash_transactions').insert(cashRows)); if (e) throw new Error(`cash_transactions: ${e.message}`); }
      if (stockRows.length) { ({ error: e } = await admin.from('stock_movements').insert(stockRows)); if (e) throw new Error(`stock_movements(sale): ${e.message}`); }
      ordersGenerated += orderRows.length;

      // 廃棄（毎日）
      const wasteQty = randInt(30, 100);
      ({ error: e } = await admin.from('stock_movements').insert({
        id: randomUUID(), organization_id: org.id, store_id: mstore.id, inventory_item_id: minv.chicken.id,
        movement_type: 'waste', quantity: -wasteQty, reason: '[PILOT-MONTH] 検証廃棄', business_date: date,
      }));
      if (e) throw new Error(`stock_movements(waste): ${e.message}`);
      invDelta.chicken -= wasteQty;

      // 仕入(in) 週2回（月-木）
      const dow = new Date(`${date}T12:00:00+09:00`).getDay();
      if (dow === 1 || dow === 4) {
        const key = dow === 1 ? 'chicken' : 'beef';
        const inQty = randInt(4000, 7000);
        ({ error: e } = await admin.from('stock_movements').insert({
          id: randomUUID(), organization_id: org.id, store_id: mstore.id, inventory_item_id: minv[key].id,
          movement_type: 'in', quantity: inQty, unit_cost: minv[key].avg_cost, reason: '[PILOT-MONTH] 検証仕入', business_date: date,
        }));
        if (e) throw new Error(`stock_movements(in): ${e.message}`);
        invDelta[key] += inQty;
      }

      // 返金4件（di===3,10,17,24）
      if ([3, 10, 17, 24].includes(di) && orderPlans.length) {
        const target = orderPlans[Math.floor(orderPlans.length / 2)];
        const refundAmount = Math.min(400, Math.max(1, target.total - 1));
        const refundId = randomUUID();
        ({ error: e } = await admin.from('refunds').insert({
          id: refundId, organization_id: org.id, store_id: mstore.id, order_id: target.orderId,
          register_session_id: sessionId, amount: refundAmount, method: 'cash',
          reason: '[PILOT-MONTH] 検証返金', kind: 'refund', business_date: date, refunded_at: `${date}T21:00:00+09:00`,
        }));
        if (e) throw new Error(`refunds: ${e.message}`);
        ({ error: e } = await admin.from('cash_transactions').insert({
          id: randomUUID(), organization_id: org.id, store_id: mstore.id, register_session_id: sessionId,
          kind: 'refund', amount: refundAmount, purpose: '[PILOT-MONTH] 検証返金', order_id: target.orderId,
          refund_id: refundId, business_date: date, status: 'active', approval_status: 'approved', occurred_at: `${date}T21:05:00+09:00`,
        }));
        if (e) throw new Error(`cash_transactions(refund): ${e.message}`);
        monthRefundIds.push(refundId);
      }

      // 経費（およそ週1回。di===2,9,16,23）
      if ([2, 9, 16, 23].includes(di)) {
        const acctKey = di % 2 === 0 ? 'EXP-SUPPLY' : 'EXP-UTIL';
        ({ error: e } = await admin.from('expenses').insert({
          id: randomUUID(), organization_id: org.id, store_id: mstore.id,
          expense_account_id: expenseAccounts[acctKey].id, amount: 3000 + randInt(0, 4000), tax_amount: 0,
          paid_via: 'petty_cash', vendor_name: '[PILOT-MONTH] 検証仕入先', business_date: date,
          approval_status: 'approved', status: 'active',
        }));
        if (e) throw new Error(`expenses: ${e.message}`);
      }

      // 小口現金4件（di===5:in, 12:out, 19:in, 26:out）
      if ([5, 12, 19, 26].includes(di)) {
        const isIn = di === 5 || di === 19;
        ({ error: e } = await admin.from('cash_transactions').insert({
          id: randomUUID(), organization_id: org.id, store_id: mstore.id, register_session_id: sessionId,
          kind: isIn ? 'petty_in' : 'petty_out', amount: isIn ? 12000 : 3500,
          purpose: isIn ? '[PILOT-MONTH] 小口現金補充' : '[PILOT-MONTH] 小口現金支出（雑費）',
          expense_account_id: isIn ? null : expenseAccounts['EXP-SUPPLY'].id,
          business_date: date, status: 'active', approval_status: 'approved', occurred_at: `${date}T12:00:00+09:00`,
        }));
        if (e) throw new Error(`cash_transactions(petty): ${e.message}`);
      }

      // 勤怠（7名。給与ルールがあるスタッフのみ）
      ({ error: e } = await admin.from('time_entries').insert(monthTimeEntryRows(date, di)));
      if (e) throw new Error(`time_entries: ${e.message}`);

      // レジ締め
      const { data: ct } = await admin.from('cash_transactions').select('kind,amount').eq('register_session_id', sessionId).eq('status', 'active');
      const expected = expectedCash({
        openingFloat: 20000, cashSales: sumKind(ct, 'sale'), cashRefunds: sumKind(ct, 'refund'),
        cashIn: sumKind(ct, 'deposit') + sumKind(ct, 'petty_in'), cashOut: sumKind(ct, 'withdrawal') + sumKind(ct, 'petty_out'),
      });
      ({ error: e } = await admin.from('register_sessions').update({
        status: 'closed', closed_by: staff.manager.id, closed_at: `${date}T23:50:00+09:00`,
        expected_cash: expected, counted_cash: expected, difference: 0,
      }).eq('id', sessionId));
      if (e) throw new Error(`register_sessions close: ${e.message}`);
    } catch (err) {
      dayErrors.push(`${date}: ${err.message}`);
    }
  }

  for (let di = 0; di < businessDates.length; di++) {
    await buildMonthDay(businessDates[di], di);
  }
  check(`${businessDates.length}日分の日次データ生成でエラーが0件`, dayErrors.length === 0, dayErrors.join(' / '));
  check(`月間で注文が${businessDates.length * 5}件以上生成された（1日5-10件×${businessDates.length}日）`,
    ordersGenerated >= businessDates.length * 5, `実際:${ordersGenerated}`);
  check('返金4件が記録されている', monthRefundIds.length === 4, `実際:${monthRefundIds.length}`);

  // ============================================================
  section('在庫: 1か月分の手組み効果を反映（1回のupdateで確定）');
  // ============================================================
  for (const key of trackedInv) {
    const newQty = invBefore[key] + invDelta[key];
    const { error } = await admin.from('inventory_items').update({ current_quantity: newQty }).eq('id', minv[key].id);
    check(`在庫反映: ${key}（${invBefore[key]} + ${invDelta[key]} = ${newQty}）`, !error, error?.message);
  }

  // ============================================================
  section('月末処理 1: 全日の店舗日次締め（欠損日検出0）');
  // ============================================================
  async function buildDailyClosingRow(date) {
    const { data: sessions } = await admin.from('register_sessions')
      .select('id, register_id, opening_float, expected_cash, counted_cash, difference, closed_by')
      .eq('store_id', mstore.id).eq('business_date', date).in('status', ['closed', 'approved']);
    const registerIds = [...new Set((sessions ?? []).map((s) => s.register_id))];
    const { data: regRows } = registerIds.length ? await admin.from('registers').select('id,name').in('id', registerIds) : { data: [] };
    const regNameById = Object.fromEntries((regRows ?? []).map((r) => [r.id, r.name]));
    const breakdown = [];
    let expSum = 0, cntSum = 0, diffSum = 0;
    for (const s of sessions ?? []) {
      const { data: ct } = await admin.from('cash_transactions').select('kind,amount').eq('register_session_id', s.id).eq('status', 'active');
      breakdown.push({
        register_id: s.register_id, register_name: regNameById[s.register_id] ?? null, session_id: s.id,
        opening_float: s.opening_float, cash_sales: sumKind(ct, 'sale'), cash_refunds: sumKind(ct, 'refund'),
        cash_in: sumKind(ct, 'deposit') + sumKind(ct, 'petty_in'), cash_out: sumKind(ct, 'withdrawal') + sumKind(ct, 'petty_out'),
        expected_cash: s.expected_cash, counted_cash: s.counted_cash, difference: s.difference, closed_by: s.closed_by,
      });
      expSum += s.expected_cash ?? 0; cntSum += s.counted_cash ?? 0; diffSum += s.difference ?? 0;
    }
    const { data: orders } = await admin.from('orders').select('total,discount_total,guest_count')
      .eq('store_id', mstore.id).eq('business_date', date).in('status', SETTLED_ORDER_STATUSES);
    const salesTotal = (orders ?? []).reduce((a, o) => a + o.total, 0);
    const guests = (orders ?? []).reduce((a, o) => a + (o.guest_count ?? 0), 0);
    const discountTotal = (orders ?? []).reduce((a, o) => a + (o.discount_total ?? 0), 0);
    const { data: refunds } = await admin.from('refunds').select('amount,method').eq('store_id', mstore.id).eq('business_date', date);
    const refundTotal = (refunds ?? []).reduce((a, r) => a + r.amount, 0);
    const refundBreakdown = {};
    for (const r of refunds ?? []) refundBreakdown[r.method] = (refundBreakdown[r.method] ?? 0) + r.amount;
    const { data: payments } = await admin.from('payments').select('method,amount').eq('store_id', mstore.id).eq('business_date', date).eq('status', 'completed');
    const paymentBreakdown = {};
    for (const p of payments ?? []) paymentBreakdown[p.method] = (paymentBreakdown[p.method] ?? 0) + p.amount;
    const { data: cashAll } = await admin.from('cash_transactions').select('kind,amount').eq('store_id', mstore.id).eq('business_date', date).eq('status', 'active');
    const row = {
      organization_id: org.id, store_id: mstore.id, business_date: date, register_session_id: null,
      sales_total: salesTotal, orders_count: (orders ?? []).length, guests_count: guests, discount_total: discountTotal,
      refund_total: refundTotal, net_sales: salesTotal - refundTotal,
      payment_breakdown: paymentBreakdown, refund_breakdown: refundBreakdown,
      petty_in_total: sumKind(cashAll, 'deposit') + sumKind(cashAll, 'petty_in'),
      petty_out_total: sumKind(cashAll, 'withdrawal') + sumKind(cashAll, 'petty_out'),
      expected_cash: expSum, counted_cash: cntSum, cash_difference: diffSum,
      register_breakdown: breakdown, sessions_count: breakdown.length, status: 'closed',
    };
    const { data: upserted, error } = await admin.from('daily_closings').upsert(row, { onConflict: 'store_id,business_date' }).select().single();
    if (error) throw new Error('daily_closings upsert: ' + error.message);
    return upserted;
  }
  const closingsByDate = {};
  for (const d of businessDates) closingsByDate[d] = await buildDailyClosingRow(d);
  const missingDays = businessDates.filter((d) => !closingsByDate[d]);
  check('全営業日の日次締め（daily_closings）が揃っている（欠損日検出0）', missingDays.length === 0, `欠損:${missingDays.join(',')}`);

  // ============================================================
  section('月末処理 6: 棚卸（stock_counts）確定・意図的な2品差異・確定後の改変拒否（STOCK_COUNT_LOCKED）');
  // ============================================================
  const { data: countRow, error: eCountIns } = await admin.from('stock_counts').insert({
    organization_id: org.id, store_id: mstore.id, count_date: businessDates[businessDates.length - 1],
    status: 'draft', counted_by: staff.manager.id, note: '[PILOT-MONTH] 月末棚卸',
  }).select().single();
  check('棚卸(stock_counts)をdraftで作成できる', !eCountIns && !!countRow, eCountIns?.message);
  const countId = countRow.id;

  const invNowByKey = {};
  for (const key of Object.keys(minv)) {
    const { data } = await admin.from('inventory_items').select('current_quantity').eq('id', minv[key].id).single();
    invNowByKey[key] = Number(data.current_quantity);
  }
  const countItemRows = Object.keys(minv).map((key) => ({
    id: randomUUID(), stock_count_id: countId, inventory_item_id: minv[key].id, expected_quantity: invNowByKey[key],
  }));
  const { error: eCountItems } = await admin.from('stock_count_items').insert(countItemRows);
  check('棚卸明細（全7品目の期待数量スナップショット）を作成できる', !eCountItems, eCountItems?.message);

  // 意図的な差異: chicken=-300（不足）・oshibori=+40（過剰）
  const chickenCountItem = countItemRows.find((r) => r.inventory_item_id === minv.chicken.id);
  const oshiboriCountItem = countItemRows.find((r) => r.inventory_item_id === minv.oshibori.id);
  const chickenDiff = -300;
  const oshiboriDiff = 40;
  for (const [row, diff] of [[chickenCountItem, chickenDiff], [oshiboriCountItem, oshiboriDiff]]) {
    const expected = row.expected_quantity;
    const { error } = await admin.from('stock_count_items').update({ counted_quantity: expected + diff, difference: diff }).eq('id', row.id);
    check(`棚卸: 意図的な差異(${diff > 0 ? '+' : ''}${diff})を入力できる`, !error, error?.message);
  }
  // 残りは差異なし（counted=expected）
  const otherItems = countItemRows.filter((r) => r.id !== chickenCountItem.id && r.id !== oshiboriCountItem.id);
  for (const row of otherItems) {
    await admin.from('stock_count_items').update({ counted_quantity: row.expected_quantity, difference: 0 }).eq('id', row.id);
  }

  // finalizeCount相当: 差異のある品目のみcount_adjust移動を生成し、在庫を実数へ確定
  const { data: allCountItems } = await admin.from('stock_count_items').select('*').eq('stock_count_id', countId);
  let countAdjustFinalizeFail = 0;
  for (const item of allCountItems ?? []) {
    if (item.counted_quantity == null) continue;
    const diff = Number(item.counted_quantity) - Number(item.expected_quantity);
    if (diff !== 0) {
      const { error: eAdj } = await admin.from('stock_movements').insert({
        id: randomUUID(), organization_id: org.id, store_id: mstore.id, inventory_item_id: item.inventory_item_id,
        movement_type: 'count_adjust', quantity: diff, reason: '棚卸差異調整', ref_stock_count_id: countId,
        business_date: businessDates[businessDates.length - 1],
      });
      if (eAdj) countAdjustFinalizeFail++;
    }
    const { error: eUpd } = await admin.from('inventory_items').update({ current_quantity: item.counted_quantity }).eq('id', item.inventory_item_id);
    if (eUpd) countAdjustFinalizeFail++;
  }
  check('棚卸確定: 差異のある2品目でcount_adjust移動が生成され在庫が実数へ更新される', countAdjustFinalizeFail === 0);
  const { error: eCountComplete } = await admin.from('stock_counts').update({ status: 'completed' }).eq('id', countId);
  check('棚卸をcompletedへ確定できる', !eCountComplete, eCountComplete?.message);

  // STOCK_COUNT_LOCKED（00028）の実地検証
  const { error: eLockedItemUpd } = await admin.from('stock_count_items').update({ counted_quantity: 99999 }).eq('id', chickenCountItem.id);
  check('確定後: stock_count_itemsの改変はSTOCK_COUNT_LOCKEDで拒否される',
    !!eLockedItemUpd && /STOCK_COUNT_LOCKED/.test(eLockedItemUpd.message ?? ''), eLockedItemUpd?.message);
  const { error: eLockedStatusUpd } = await admin.from('stock_counts').update({ status: 'draft' }).eq('id', countId);
  check('確定後: stock_counts.statusの巻き戻しはSTOCK_COUNT_LOCKEDで拒否される',
    !!eLockedStatusUpd && /STOCK_COUNT_LOCKED/.test(eLockedStatusUpd.message ?? ''), eLockedStatusUpd?.message);
  const { error: eLockedDelete } = await admin.from('stock_counts').delete().eq('id', countId);
  check('確定後: stock_countsの削除はSTOCK_COUNT_LOCKEDで拒否される',
    !!eLockedDelete && /STOCK_COUNT_LOCKED/.test(eLockedDelete.message ?? ''), eLockedDelete?.message);

  // ============================================================
  section('原価: 理論原価 + 廃棄 + 棚卸差異 = 実原価（lib.computeCostVarianceと一致）');
  // ============================================================
  const { data: saleMovs } = await admin.from('stock_movements').select('quantity, inventory_item_id')
    .eq('store_id', mstore.id).eq('movement_type', 'sale').gte('business_date', businessDates[0]).lte('business_date', businessDates[businessDates.length - 1]);
  const avgCostByInvId = Object.fromEntries(Object.values(minv).map((i) => [i.id, i.avg_cost]));
  const theoreticalCost = (saleMovs ?? []).reduce((a, m) => a + Math.abs(Number(m.quantity)) * (avgCostByInvId[m.inventory_item_id] ?? 0), 0);
  check('原価: 理論原価（sale movements×平均仕入単価）が正の値', theoreticalCost > 0, `理論原価:${theoreticalCost}`);

  const { data: wasteMovs } = await admin.from('stock_movements').select('quantity, inventory_item_id')
    .eq('store_id', mstore.id).eq('movement_type', 'waste').gte('business_date', businessDates[0]).lte('business_date', businessDates[businessDates.length - 1]);
  const wasteAmount = (wasteMovs ?? []).reduce((a, m) => a + Math.abs(Number(m.quantity)) * (avgCostByInvId[m.inventory_item_id] ?? 0), 0);
  check('原価: 廃棄額（waste movements×平均仕入単価）が正の値', wasteAmount > 0, `廃棄額:${wasteAmount}`);

  const { data: adjMovs } = await admin.from('stock_movements').select('quantity, inventory_item_id').eq('ref_stock_count_id', countId);
  const countAdjustmentAmount = (adjMovs ?? []).reduce((a, m) => a + -Number(m.quantity) * (avgCostByInvId[m.inventory_item_id] ?? 0), 0);
  check('原価: 棚卸差異額（不足を正の費用として算出）が期待どおり（不足300g×@2 − 過剰40本×@10 = 600-400=200）',
    countAdjustmentAmount === 200, `実際:${countAdjustmentAmount}`);

  const costVariance = computeCostVariance({ theoreticalCost, wasteAmount, countAdjustmentAmount });
  check('原価: 実原価 = 理論原価 + 廃棄 + 棚卸差異（lib.computeCostVarianceの恒等式）',
    costVariance.actualCost === theoreticalCost + wasteAmount + countAdjustmentAmount, `実原価:${costVariance.actualCost}`);
  const actualCost = costVariance.actualCost;

  // ============================================================
  section('月末処理 5: 仕入請求書2件（実原価に金額を一致させる=帳簿と実棚卸の突合を模す）');
  // ============================================================
  const invoice1Amount = Math.round(actualCost * 0.6);
  const invoice2Amount = actualCost - invoice1Amount;
  const invoiceDefs = [
    { amount: invoice1Amount, vendor_name: '[PILOT-MONTH] 検証仕入先A', issue_date: businessDates[5] },
    { amount: invoice2Amount, vendor_name: '[PILOT-MONTH] 検証仕入先B', issue_date: businessDates[20] },
  ];
  const invoiceIds = [];
  for (const def of invoiceDefs) {
    const { data, error } = await admin.from('invoices').insert({
      organization_id: org.id, store_id: mstore.id, vendor_name: def.vendor_name,
      invoice_no: `PILOTMONTH-${randomUUID().slice(0, 8)}`, issue_date: def.issue_date, due_date: def.issue_date,
      amount: def.amount, tax_amount: Math.round(def.amount * 8 / 108), status: 'approved',
    }).select().single();
    check(`仕入請求書を作成できる（${def.vendor_name}・¥${def.amount}）`, !error && !!data, error?.message);
    if (data) invoiceIds.push({ id: data.id, amount: data.amount, vendorName: data.vendor_name });
  }
  check('仕入請求書2件の合計が実原価と一致する（意図的なサイズ合わせ）',
    invoiceIds.reduce((a, i) => a + i.amount, 0) === actualCost);

  // ============================================================
  section('月末処理 2: 勤怠確定 → 給与run作成 → 計算 → 確定 → 承認（rules_snapshot・PAYROLL_RUN_LOCKED）');
  // ============================================================
  const { data: closedEntries, error: eCloseEntries } = await admin.from('time_entries')
    .update({ status: 'approved' }).eq('store_id', mstore.id).in('work_date', businessDates).eq('status', 'closed').select('id');
  check('勤怠を確定(approved)へ一括更新できる（勤怠確定→給与run対象化）', !eCloseEntries, eCloseEntries?.message);
  console.log(`  勤怠確定件数: ${closedEntries?.length ?? 0}`);

  const { data: payrollRules } = await admin.from('payroll_rules').select('*').eq('organization_id', org.id).eq('status', 'active');
  const { data: commissionRules } = await admin.from('commission_rules').select('*').eq('organization_id', org.id).eq('status', 'active');

  const { data: runRow, error: eRunIns } = await admin.from('payroll_runs').insert({
    organization_id: org.id, store_id: mstore.id, title: `[PILOT-MONTH] ${monthStr} 給与`,
    period_start: businessDates[0], period_end: businessDates[businessDates.length - 1], status: 'draft',
  }).select().single();
  check('給与run（draft）を作成できる', !eRunIns && !!runRow, eRunIns?.message);
  const runId = runRow.id;

  const { data: monthTimeEntries } = await admin.from('time_entries').select('*')
    .eq('store_id', mstore.id).in('work_date', businessDates).in('status', ['closed', 'approved']);
  const entriesByProfile = {};
  for (const e of monthTimeEntries ?? []) {
    if (!e.clock_in_at || !e.clock_out_at) continue;
    (entriesByProfile[e.profile_id] ??= []).push(e);
  }
  const payrollItemsToInsert = [];
  let laborCostFromCalc = 0;
  for (const rule of payrollRules ?? []) {
    const entries = entriesByProfile[rule.profile_id];
    if (!entries?.length) continue;
    const days = entries.map((e) => summarizeEntry({ clockInAt: new Date(e.clock_in_at), clockOutAt: new Date(e.clock_out_at), breakMinutes: e.break_minutes }));
    const applicableCommission = (commissionRules ?? []).find((c) => c.target_type === 'personal_sales' && c.profile_id === rule.profile_id);
    const salesAmount = salesByStaffDate[rule.profile_id] ?? 0;
    const commissionTotal = applicableCommission
      ? calcCommission({ targetType: applicableCommission.target_type, method: applicableCommission.method, rate: Number(applicableCommission.rate), fixedAmount: applicableCommission.fixed_amount }, salesAmount)
      : 0;
    const preview = calcPayroll({
      payType: rule.pay_type, baseAmount: rule.base_amount, overtimeRate: Number(rule.overtime_rate),
      nightRate: Number(rule.night_rate), holidayRate: Number(rule.holiday_rate),
      commuteAllowance: rule.commute_allowance, allowances: rule.allowances ?? [],
    }, days, commissionTotal);
    laborCostFromCalc += preview.grossTotal;
    payrollItemsToInsert.push({
      id: randomUUID(), organization_id: org.id, payroll_run_id: runId, profile_id: rule.profile_id, store_id: mstore.id,
      work_days: preview.workDays, work_minutes: preview.workMinutes, overtime_minutes: preview.overtimeMinutes,
      night_minutes: preview.nightMinutes, holiday_minutes: preview.holidayMinutes,
      base_pay: preview.basePay, overtime_pay: preview.overtimePay, night_pay: preview.nightPay, holiday_pay: preview.holidayPay,
      commute_pay: preview.commutePay, allowance_total: preview.allowanceTotal, commission_total: preview.commissionTotal,
      deduction_total: 0, gross_total: preview.grossTotal,
      breakdown: { calcVersion: 'pilot-month-v1', ruleId: rule.id, commissionRuleId: applicableCommission?.id ?? null, salesAmount },
    });
  }
  const { error: eItemsIns } = await admin.from('payroll_items').insert(payrollItemsToInsert);
  check(`給与明細を計算できる（対象${payrollItemsToInsert.length}名・lib/payroll.calcPayrollを直接使用）`, !eItemsIns && payrollItemsToInsert.length === 7, eItemsIns?.message);
  check('給与明細: 歩合対象（personal_sales）スタッフのcommission_totalが正の値', payrollItemsToInsert.some((i) => i.commission_total > 0));

  const { error: eConfirm } = await admin.from('payroll_runs').update({ status: 'confirmed' }).eq('id', runId);
  check('給与runを確定(confirmed)にできる', !eConfirm, eConfirm?.message);

  const rulesSnapshot = {
    calcVersion: 'pilot-month-v1', generatedAt: new Date().toISOString(),
    payrollRules: (payrollRules ?? []).map((r) => ({ id: r.id, profileId: r.profile_id, payType: r.pay_type, baseAmount: r.base_amount })),
    commissionRules: (commissionRules ?? []).map((r) => ({ id: r.id, profileId: r.profile_id, rate: r.rate })),
  };
  const { error: eApprove } = await admin.from('payroll_runs').update({
    status: 'approved', approved_by: staff.owner.id, approved_at: new Date().toISOString(), rules_snapshot: rulesSnapshot,
  }).eq('id', runId);
  check('給与runを承認(approved)できる（rules_snapshot保存）', !eApprove, eApprove?.message);
  const { data: runAfterApprove } = await admin.from('payroll_runs').select('rules_snapshot,status').eq('id', runId).single();
  check('承認後: rules_snapshotが保存されている（過去runの再現性）', !!runAfterApprove?.rules_snapshot && runAfterApprove.status === 'approved');

  // PAYROLL_RUN_LOCKED（00022）の実地検証
  const { error: eLockedItemUpdate } = await admin.from('payroll_items').update({ base_pay: 999999 }).eq('payroll_run_id', runId).limit(1);
  check('承認後: payroll_itemsの改変はPAYROLL_RUN_LOCKEDで拒否される',
    !!eLockedItemUpdate && /PAYROLL_RUN_LOCKED/.test(eLockedItemUpdate.message ?? ''), eLockedItemUpdate?.message);
  const { error: eLockedItemDelete } = await admin.from('payroll_items').delete().eq('payroll_run_id', runId).limit(1);
  check('承認後: payroll_itemsの削除はPAYROLL_RUN_LOCKEDで拒否される',
    !!eLockedItemDelete && /PAYROLL_RUN_LOCKED/.test(eLockedItemDelete.message ?? ''), eLockedItemDelete?.message);
  const { error: eLockedRunUpdate } = await admin.from('payroll_runs').update({ period_end: businessDates[0] }).eq('id', runId);
  check('承認後: payroll_runs.period_endの改変はPAYROLL_RUN_LOCKEDで拒否される',
    !!eLockedRunUpdate && /PAYROLL_RUN_LOCKED/.test(eLockedRunUpdate.message ?? ''), eLockedRunUpdate?.message);

  const laborCost = payrollItemsToInsert.reduce((a, i) => a + i.gross_total, 0);
  check('人件費: payroll_items.gross_totalの合計とcalcPayroll直接計算の合計が一致（自己整合）', laborCost === laborCostFromCalc);

  // ============================================================
  section('会計: 勘定科目マップ・仕訳投稿ヘルパー');
  // ============================================================
  const { data: accountRows } = await admin.from('accounts').select('id,code,name,category').eq('organization_id', org.id).eq('status', 'active');
  const accByCode = new Map((accountRows ?? []).map((a) => [a.code, a]));
  const postedEntryIds = [];

  async function postJournal({ entryDate, description, sourceType, sourceId, lines }) {
    const { data: existing } = await admin.from('journal_entries').select('id,status')
      .eq('organization_id', org.id).eq('source_type', sourceType).eq('source_id', sourceId).neq('status', 'voided');
    if (existing?.length) return { entryId: existing[0].id, skipped: true };
    const entryId = randomUUID();
    const { error: eEntry } = await admin.from('journal_entries').insert({
      id: entryId, organization_id: org.id, store_id: mstore.id, entry_date: entryDate,
      description, source_type: sourceType, source_id: sourceId,
    });
    if (eEntry) throw new Error(`journal_entries(${sourceType}:${sourceId}): ${eEntry.message}`);
    const lineRows = lines.map((l, i) => {
      const acc = accByCode.get(l.accountCode);
      if (!acc) throw new Error(`未導入の勘定科目コード: ${l.accountCode}`);
      return {
        id: randomUUID(), organization_id: org.id, entry_id: entryId, line_no: i + 1, account_id: acc.id,
        side: l.side, amount: l.amount, tax_treatment: l.taxTreatment, store_id: mstore.id, memo: l.memo ?? null,
      };
    });
    const { error: eLines } = await admin.from('journal_entry_lines').insert(lineRows);
    if (eLines) throw new Error(`journal_entry_lines(${sourceType}:${sourceId}): ${eLines.message}`);
    const { data: post, error: ePost } = await owner.rpc('post_journal_entry', { p_entry_id: entryId });
    if (ePost) throw new Error(`post_journal_entry(${sourceType}:${sourceId}): ${ePost.message}`);
    postedEntryIds.push(entryId);
    return { entryId, skipped: false, post };
  }

  // ============================================================
  section('事前クリーンアップ: 前回実行分の仕訳を全void（再実行時の整合性確保）');
  // ============================================================
  // orders/payments/refunds/expenses等は隔離店舗内に累積許容で残る（物理削除不可のため）。
  // そのため毎回このstore×対象月の試算表・P/Lは「累積した最新の実測値」を正としてよいが、
  // 仕訳（journal_entries）だけは前回実行分がpostedのまま残っていると source_id の冪等チェックに
  // 引っかかって「今回の累積後の金額」で新規計上できず、P/Lが古い金額のまま食い違ってしまう。
  // そこで実行のたびに、この店舗×対象月に残っている posted 仕訳を先にreopen→全voidしてから
  // 本題の仕訳計上に入る（＝毎回「まっさらな仕訳帳」から積み直す設計）。
  {
    const { data: periodRows } = await admin.from('accounting_periods').select('status').eq('organization_id', org.id).eq('month', monthStartDate);
    if ((periodRows ?? []).some((p) => p.status === 'closed')) {
      await safe('前回実行分の会計期間reopen', async () => {
        const { error } = await owner.rpc('reopen_accounting_period', { p_org: org.id, p_month: monthStartDate, p_reason: '[PILOT-MONTH] 再実行のための事前reopen' });
        if (error) throw error;
      });
    }
    const { data: priorPosted } = await admin.from('journal_entries').select('id')
      .eq('organization_id', org.id).eq('store_id', mstore.id).eq('status', 'posted')
      .gte('entry_date', businessDates[0]).lte('entry_date', businessDates[businessDates.length - 1]);
    for (const row of priorPosted ?? []) {
      await safe(`前回実行分 journal_entry ${row.id} のvoid`, async () => {
        const { error } = await owner.rpc('void_journal_entry', { p_entry_id: row.id, p_reason: '[PILOT-MONTH] 再実行のための事前void' });
        if (error) throw error;
      });
    }
    console.log(`  前回実行分の仕訳${(priorPosted ?? []).length}件をvoidしました（本実行はここから積み直す）`);
  }

  // ============================================================
  section('月末処理 8a: 月次締め（draft残の拒否を先に確認）');
  // ============================================================
  const { data: filler, error: eFillerIns } = await admin.from('journal_entries').insert({
    organization_id: org.id, store_id: mstore.id, entry_date: businessDates[0],
    description: '[PILOT-MONTH] draft残テスト用（意図的に未postで残す）', source_type: 'manual', source_id: `pilot-month-filler-${Date.now()}`,
  }).select().single();
  check('draft残テスト用の仕訳を作成できる', !eFillerIns && !!filler, eFillerIns?.message);
  await admin.from('journal_entry_lines').insert([
    { organization_id: org.id, entry_id: filler.id, line_no: 1, account_id: accByCode.get('599').id, side: 'debit', amount: 100, tax_treatment: 'taxable_standard', store_id: mstore.id },
    { organization_id: org.id, entry_id: filler.id, line_no: 2, account_id: accByCode.get('100').id, side: 'credit', amount: 100, tax_treatment: 'out_of_scope', store_id: mstore.id },
  ]);
  const { error: eCloseWithDraft } = await owner.rpc('close_accounting_period', { p_org: org.id, p_month: monthStartDate });
  check('draft仕訳が残っている状態のclose_accounting_periodはDRAFT_ENTRIES_REMAINで拒否される',
    !!eCloseWithDraft && /DRAFT_ENTRIES_REMAIN/.test(eCloseWithDraft.message ?? ''), eCloseWithDraft?.message);
  const { error: eFillerDel } = await admin.from('journal_entries').delete().eq('id', filler.id);
  check('draft仕訳は削除できる（後始末）', !eFillerDel, eFillerDel?.message);

  // ============================================================
  section('月末処理 3: 給与仕訳（buildPayrollJournal→post_journal_entry・source_type=payroll冪等）');
  // ============================================================
  const payrollJournalLines = buildPayrollJournal({ grossTotal: laborCost, periodLabel: `${monthStr} ${businessDates[0]}〜${businessDates[businessDates.length - 1]}` });
  const payrollPost = await postJournal({
    entryDate: businessDates[businessDates.length - 1], description: `[PILOT-MONTH] 給与（${monthStr}）`,
    sourceType: 'payroll', sourceId: `payroll:${runId}`, lines: payrollJournalLines,
  });
  check('給与仕訳（buildPayrollJournal）を作成・post_journal_entryで確定できる', !!payrollPost.entryId);
  const payrollPost2 = await postJournal({
    entryDate: businessDates[businessDates.length - 1], description: `[PILOT-MONTH] 給与（${monthStr}）`,
    sourceType: 'payroll', sourceId: `payroll:${runId}`, lines: payrollJournalLines,
  });
  check('給与仕訳は同一source_idで冪等（2回目はskip）', payrollPost2.skipped === true);

  // ============================================================
  section('月末処理 4: 売上・返金の自動仕訳（30日分・source_id={storeId}:{date}冪等）');
  // ============================================================
  let salesJournalCount = 0, refundJournalCount = 0, salesJournalSkipped = 0;
  for (const d of businessDates) {
    const { data: dayPayments } = await admin.from('payments').select('method,amount').eq('store_id', mstore.id).eq('business_date', d).eq('status', 'completed');
    const cashSalesStandard = (dayPayments ?? []).filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0);
    const cashlessSalesStandard = (dayPayments ?? []).filter((p) => p.method !== 'cash').reduce((a, p) => a + p.amount, 0);
    if (cashSalesStandard + cashlessSalesStandard > 0) {
      const lines = buildSalesJournal({ cashSalesStandard, cashSalesReduced: 0, cashlessSalesStandard, cashlessSalesReduced: 0 });
      const res = await postJournal({ entryDate: d, description: `[PILOT-MONTH] ${d} 売上`, sourceType: 'pos_sales', sourceId: `${mstore.id}:${d}`, lines });
      if (res.skipped) salesJournalSkipped++; else salesJournalCount++;
    }
    const { data: dayRefunds } = await admin.from('refunds').select('method,amount').eq('store_id', mstore.id).eq('business_date', d);
    const cashRefundsStandard = (dayRefunds ?? []).filter((r) => r.method === 'cash').reduce((a, r) => a + r.amount, 0);
    const cashlessRefundsStandard = (dayRefunds ?? []).filter((r) => r.method !== 'cash').reduce((a, r) => a + r.amount, 0);
    if (cashRefundsStandard + cashlessRefundsStandard > 0) {
      const lines = buildRefundJournal({ cashRefundsStandard, cashRefundsReduced: 0, cashlessRefundsStandard, cashlessRefundsReduced: 0 });
      const res = await postJournal({ entryDate: d, description: `[PILOT-MONTH] ${d} 売上返金`, sourceType: 'pos_refund', sourceId: `${mstore.id}:${d}`, lines });
      if (!res.skipped) refundJournalCount++;
    }
  }
  check(`売上仕訳が${businessDates.length}日分すべて計上された`, salesJournalCount + salesJournalSkipped === businessDates.length, `計上:${salesJournalCount} skip:${salesJournalSkipped}`);
  check('返金仕訳が4日分計上された', refundJournalCount === 4, `実際:${refundJournalCount}`);

  // 冪等性の実地検証: 同じ日をもう一度postJournalしてもskipされる
  const dRepeat = businessDates[0];
  const { data: repeatPayments } = await admin.from('payments').select('method,amount').eq('store_id', mstore.id).eq('business_date', dRepeat).eq('status', 'completed');
  const repeatLines = buildSalesJournal({
    cashSalesStandard: (repeatPayments ?? []).filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0), cashSalesReduced: 0,
    cashlessSalesStandard: (repeatPayments ?? []).filter((p) => p.method !== 'cash').reduce((a, p) => a + p.amount, 0), cashlessSalesReduced: 0,
  });
  const repeatRes = await postJournal({ entryDate: dRepeat, description: 're-post test', sourceType: 'pos_sales', sourceId: `${mstore.id}:${dRepeat}`, lines: repeatLines });
  check('売上仕訳の再postはsource_idの冪等性によりskipされる（二重計上防止）', repeatRes.skipped === true);

  // ============================================================
  section('月末処理 5: 経費・仕入仕訳');
  // ============================================================
  const { data: monthExpenses } = await admin.from('expenses').select('*').eq('store_id', mstore.id).in('business_date', businessDates).eq('status', 'active').eq('approval_status', 'approved');
  check('経費が計上されている（週1回ペース）', (monthExpenses ?? []).length >= 3, `実際:${(monthExpenses ?? []).length}`);
  const expenseAccountCodeMap = Object.fromEntries(Object.entries(expenseAccounts).map(([, v]) => [v.id, v.account_id ? [...accByCode.entries()].find(([, a]) => a.id === v.account_id)?.[0] : '599']));
  let expenseJournalCount = 0;
  for (const exp of monthExpenses ?? []) {
    const code = expenseAccountCodeMap[exp.expense_account_id] ?? '599';
    const lines = buildExpenseJournal({ amount: exp.amount, expenseAccountCode: code, paidVia: exp.paid_via, memo: exp.vendor_name });
    const res = await postJournal({ entryDate: exp.business_date, description: `[PILOT-MONTH] 経費（${exp.vendor_name}）`, sourceType: 'expense', sourceId: `expense:${exp.id}`, lines });
    if (!res.skipped) expenseJournalCount++;
  }
  check('経費仕訳（buildExpenseJournal）を全件postできた', expenseJournalCount === (monthExpenses ?? []).length);

  // 小口現金4件の仕訳（petty_in=現金振替／petty_out=経費計上。buildExpenseJournalを流用）
  const { data: monthPetty } = await admin.from('cash_transactions').select('*').eq('store_id', mstore.id).in('business_date', businessDates).in('kind', ['petty_in', 'petty_out']).eq('approval_status', 'approved');
  check('小口現金4件が計上されている', (monthPetty ?? []).length === 4, `実際:${(monthPetty ?? []).length}`);
  let pettyJournalCount = 0;
  for (const p of monthPetty ?? []) {
    const lines = p.kind === 'petty_in'
      ? [
          { accountCode: STD.pettyCash, side: 'debit', amount: p.amount, taxTreatment: 'out_of_scope', memo: p.purpose },
          { accountCode: STD.cash, side: 'credit', amount: p.amount, taxTreatment: 'out_of_scope', memo: '現金からの補充' },
        ]
      : buildExpenseJournal({ amount: p.amount, expenseAccountCode: '520', paidVia: 'petty_cash', memo: p.purpose });
    const res = await postJournal({ entryDate: p.business_date, description: `[PILOT-MONTH] 小口現金（${p.purpose}）`, sourceType: 'petty_cash', sourceId: `petty:${p.id}`, lines });
    if (!res.skipped) pettyJournalCount++;
  }
  check('小口現金仕訳を全件postできた', pettyJournalCount === (monthPetty ?? []).length);
  const pettyOutTotal = (monthPetty ?? []).filter((p) => p.kind === 'petty_out').reduce((a, p) => a + p.amount, 0);

  let purchaseJournalCount = 0;
  for (const inv of invoiceIds) {
    const lines = buildPurchaseJournal({ amount: inv.amount, vendorName: inv.vendorName });
    const res = await postJournal({ entryDate: businessDates[businessDates.length - 1], description: `[PILOT-MONTH] 仕入（${inv.vendorName}）`, sourceType: 'purchase', sourceId: `purchase:${inv.id}`, lines });
    if (!res.skipped) purchaseJournalCount++;
  }
  check('仕入仕訳（buildPurchaseJournal）2件をpostできた', purchaseJournalCount === 2, `実際:${purchaseJournalCount}`);

  const expensesTotal = (monthExpenses ?? []).reduce((a, e) => a + e.amount, 0) + pettyOutTotal;

  // ============================================================
  section('月末処理 8b: 月次締め close_accounting_period（全仕訳post後は成功）');
  // ============================================================
  const { data: closeRes, error: eCloseOk } = await owner.rpc('close_accounting_period', { p_org: org.id, p_month: monthStartDate });
  check('全仕訳post後のclose_accounting_periodは成功する', !eCloseOk && closeRes?.ok, eCloseOk?.message);

  const { data: periodRow } = await admin.from('accounting_periods').select('*').eq('organization_id', org.id).eq('month', monthStartDate).single();
  check('accounting_periods.status=closedで記録される', periodRow?.status === 'closed');

  // 締め後のpost拒否（PERIOD_CLOSED）
  const { data: postClosedEntry, error: ePostClosedIns } = await admin.from('journal_entries').insert({
    organization_id: org.id, store_id: mstore.id, entry_date: businessDates[0],
    description: '[PILOT-MONTH] 締め後postテスト用', source_type: 'manual', source_id: `pilot-month-postclosed-${Date.now()}`,
  }).select().single();
  check('締め後もdraft仕訳自体は作成できる', !ePostClosedIns && !!postClosedEntry, ePostClosedIns?.message);
  await admin.from('journal_entry_lines').insert([
    { organization_id: org.id, entry_id: postClosedEntry.id, line_no: 1, account_id: accByCode.get('599').id, side: 'debit', amount: 50, tax_treatment: 'taxable_standard', store_id: mstore.id },
    { organization_id: org.id, entry_id: postClosedEntry.id, line_no: 2, account_id: accByCode.get('100').id, side: 'credit', amount: 50, tax_treatment: 'out_of_scope', store_id: mstore.id },
  ]);
  const { error: ePostClosed } = await owner.rpc('post_journal_entry', { p_entry_id: postClosedEntry.id });
  check('締め済み期間へのpost_journal_entryはPERIOD_CLOSEDで拒否される',
    !!ePostClosed && /PERIOD_CLOSED/.test(ePostClosed.message ?? ''), ePostClosed?.message);
  await safe('締め後postテスト用draft仕訳の削除', () => admin.from('journal_entries').delete().eq('id', postClosedEntry.id));

  // ============================================================
  section('試算表・P/L・B/S（postedな仕訳から集計）');
  // ============================================================
  const postedLineRows = await fetchAllRows(() => admin.from('journal_entry_lines')
    .select('account_id, side, amount, entry_id!inner(entry_date, status, organization_id, store_id)')
    .eq('entry_id.organization_id', org.id).eq('entry_id.store_id', mstore.id).eq('entry_id.status', 'posted')
    .gte('entry_id.entry_date', businessDates[0]).lte('entry_id.entry_date', businessDates[businessDates.length - 1]));
  const postedLines = (postedLineRows ?? []).map((r) => ({ accountId: r.account_id, side: r.side, amount: r.amount }));
  check('試算表対象のposted仕訳行が取得できる', postedLines.length > 0, `件数:${postedLines.length}`);

  const debitTotalAll = postedLines.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0);
  const creditTotalAll = postedLines.filter((l) => l.side === 'credit').reduce((a, l) => a + l.amount, 0);
  check('試算表: 借方合計 = 貸方合計（posted仕訳の集計）', debitTotalAll === creditTotalAll, `借方:${debitTotalAll} 貸方:${creditTotalAll}`);

  const accountInfos = (accountRows ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name, category: a.category }));
  const tb = aggregateTrialBalance(postedLines, accountInfos);
  const tbDebit = tb.reduce((a, r) => a + r.debitTotal, 0);
  const tbCredit = tb.reduce((a, r) => a + r.creditTotal, 0);
  check('aggregateTrialBalance集計でも借方合計=貸方合計', tbDebit === tbCredit, `借方:${tbDebit} 貸方:${tbCredit}`);

  const opStatement = buildOperatingStatement(tb, classifyExpense);
  const monthOrders = await fetchAllRows(() => admin.from('orders').select('total,discount_total,guest_count,status')
    .eq('store_id', mstore.id).in('business_date', businessDates).in('status', SETTLED_ORDER_STATUSES));
  const monthRefunds = await fetchAllRows(() => admin.from('refunds').select('amount,kind').eq('store_id', mstore.id).in('business_date', businessDates));
  const monthMetrics = computeSalesMetrics(monthOrders ?? [], monthRefunds ?? []);

  check('P/L: 仕訳ベースの売上高(revenueTotal)がmetricsベースのnetSalesと一致',
    opStatement.revenueTotal === monthMetrics.netSales, `仕訳:${opStatement.revenueTotal} metrics:${monthMetrics.netSales}`);
  check('P/L: 仕訳ベースの原価(cogsTotal)がmetricsベースの実原価(actualCost)と一致（意図的にサイズを合わせた仕入請求書により）',
    opStatement.cogsTotal === actualCost, `仕訳:${opStatement.cogsTotal} metrics:${actualCost}`);
  check('P/L: 粗利(grossProfit) = 売上高 − 原価', opStatement.grossProfit === opStatement.revenueTotal - opStatement.cogsTotal);
  check('P/L: 仕訳ベースの人件費(laborTotal)がmetricsベースの人件費(laborCost)と一致',
    opStatement.laborTotal === laborCost, `仕訳:${opStatement.laborTotal} metrics:${laborCost}`);
  check('P/L: 仕訳ベースの経費(opexTotal)がmetricsベースの経費(expensesTotal)と一致',
    opStatement.opexTotal === expensesTotal, `仕訳:${opStatement.opexTotal} metrics:${expensesTotal}`);
  const operatingIncomeMetrics = monthMetrics.netSales - actualCost - laborCost - expensesTotal;
  check('P/L: 営業利益(operatingIncome)が仕訳ベースとmetricsベースで一致',
    opStatement.operatingIncome === operatingIncomeMetrics, `仕訳:${opStatement.operatingIncome} metrics:${operatingIncomeMetrics}`);

  const bs = buildBalanceSheet(tb);
  check('B/S: 資産 = 負債 + 純資産 + 当期純利益（buildBalanceSheet.balanced）', bs.balanced,
    `資産:${bs.assetTotal} 負債:${bs.liabilityTotal} 純資産:${bs.equityTotal} 当期純利益:${bs.netIncome}`);
  check('B/S: 当期純利益がP/Lの営業利益（今回のテストでは非営業項目なし）と一致', bs.netIncome === opStatement.operatingIncome);

  // ============================================================
  section('月次経営レポート項目の突合（#17・FL=原価+人件費等の恒等式）');
  // ============================================================
  const netSales = monthMetrics.netSales;
  const grossProfit = netSales - actualCost;
  const grossProfitRate = netSales > 0 ? (grossProfit / netSales) * 100 : 0;
  const laborRate = netSales > 0 ? (laborCost / netSales) * 100 : 0;
  const fl = actualCost + laborCost;
  const flRate = netSales > 0 ? (fl / netSales) * 100 : 0;
  const operatingIncome = grossProfit - laborCost - expensesTotal;
  const guests = monthMetrics.guests;
  const avgSpend = monthMetrics.avgSpend;

  check('月次レポート: FL = 原価 + 人件費（恒等式）', fl === actualCost + laborCost, `FL:${fl}`);
  check('月次レポート: FL比率 = FL ÷ 純売上 ×100', Math.abs(flRate - (fl / netSales) * 100) < 1e-9);
  check('月次レポート: 粗利率 = 粗利 ÷ 純売上 ×100（0-100%の範囲に収まる妥当な値）', grossProfitRate > 0 && grossProfitRate < 100, `粗利率:${grossProfitRate.toFixed(2)}%`);
  check('月次レポート: 人件費率が正の妥当な値', laborRate > 0 && laborRate < 100, `人件費率:${laborRate.toFixed(2)}%`);
  check('月次レポート: 営業利益 = 粗利 − 人件費 − 経費（恒等式。P/Lの仕訳ベース営業利益とも一致）',
    operatingIncome === opStatement.operatingIncome, `レポート:${operatingIncome} P/L:${opStatement.operatingIncome}`);
  check('月次レポート: 客数が正の値', guests > 0, `客数:${guests}`);
  check('月次レポート: 客単価 = 純売上 ÷ 客数（lib/metrics定義）', avgSpend === Math.floor(netSales / guests));
  check('月次レポート: 廃棄額が正の値', wasteAmount > 0, `廃棄額:${wasteAmount}`);
  check('月次レポート: 在庫差異額（棚卸差異の金額換算）が期待どおり', countAdjustmentAmount === 200, `在庫差異額:${countAdjustmentAmount}`);

  console.log('\n  --- 月次経営レポート（算出値） ---');
  console.log(`  売上高(gross): ¥${monthMetrics.grossSales.toLocaleString()} / 純売上(net): ¥${netSales.toLocaleString()}`);
  console.log(`  原価: ¥${actualCost.toLocaleString()}（理論¥${theoreticalCost.toLocaleString()}+廃棄¥${wasteAmount.toLocaleString()}+棚卸差異¥${countAdjustmentAmount.toLocaleString()}）`);
  console.log(`  粗利: ¥${grossProfit.toLocaleString()}（粗利率${grossProfitRate.toFixed(1)}%）`);
  console.log(`  人件費: ¥${laborCost.toLocaleString()}（人件費率${laborRate.toFixed(1)}%） / FL: ¥${fl.toLocaleString()}（FL比率${flRate.toFixed(1)}%）`);
  console.log(`  経費: ¥${expensesTotal.toLocaleString()} / 営業利益: ¥${operatingIncome.toLocaleString()}`);
  console.log(`  客数: ${guests}人 / 客単価: ¥${avgSpend.toLocaleString()}`);

  // ============================================================
  console.log('\n=== 検証結果 ===');
  console.log(`成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) {
    console.log('\n失敗項目:');
    failures.forEach((f) => console.log(' -', f));
  }
  console.log(`\n実行時間: ${((Date.now() - startedAt) / 1000).toFixed(1)}秒`);

  // ============================================================
  section('後始末: 会計期間をreopen → 仕訳をvoid → period行を削除（再実行可能にする）');
  // ============================================================
  // 重要: void_journal_entryもpost_journal_entryと同じくPERIOD_CLOSEDチェックを行うため、
  // 締め済みのままvoidしようとすると全件失敗する。必ず先にreopenしてからvoidする。
  await safe('会計期間のreopen', async () => {
    const { error } = await owner.rpc('reopen_accounting_period', { p_org: org.id, p_month: monthStartDate, p_reason: '[PILOT-MONTH] 検証後始末のため再オープン' });
    if (error) throw error;
  });
  for (const id of postedEntryIds) {
    await safe(`journal_entry ${id} のvoid`, async () => {
      const { error } = await owner.rpc('void_journal_entry', { p_entry_id: id, p_reason: '[PILOT-MONTH] 検証後始末のため取消' });
      if (error && !/ENTRY_NOT_POSTED/.test(error.message ?? '')) throw error;
    });
  }
  console.log(`  仕訳${postedEntryIds.length}件をvoidしました`);
  await safe('accounting_periods行の削除', async () => {
    const { error } = await admin.from('accounting_periods').delete().eq('organization_id', org.id).eq('month', monthStartDate);
    if (error) throw error;
  });
  console.log('  会計期間をreopenしaccounting_periods行を削除しました（次回実行に備えてクリーンな状態）');
  console.log('  隔離店舗(pilot-shinjuku-monthly)内の注文・支払・返金・レジ/日次締め・棚卸・給与runは');
  console.log('  物理削除不可のため残置（累積許容。店舗が本店舗と分離されているため他スクリプトに影響しない）');

  if (failures.length) process.exit(1);
}

main().catch((e) => { console.error('\n検証中断:', e.stack ?? e.message); process.exit(1); });
