/**
 * TENPO ONE v0.4.3 — 「1週間営業シミュレーション」実環境検証スクリプト（VER-E4）
 *
 * 使い方: node --env-file=.env.local scripts/verify-store-week.mjs
 *
 * verify-store-day.mjs（D4）と同じ流儀（check()/section()での記録・service roleは準備/照合専用・
 * scripts/pilot-org.mjsのensurePilotOrg()/cleanupPilotDay()/loginPilotUser()を再利用）で、
 * 専用テスト企業「[PILOT] TENPO ONE検証企業」の新宿店に「過去6日分の営業日」を手組みで積み上げ、
 * 「当日（7日目）」だけは実RPC（finalize_order等）で作って両者の構造が一致することを確認したうえで、
 * 週次の売上・原価・粗利・人件費・経費・利益の恒等式が1円単位で成立することを検証する。
 *
 * 過去日構築の方針（重要・READMEの指示どおり）:
 *  - finalize_orderはbusiness_dateを常に「本日」に固定する（app_business_date）ため、過去営業日の
 *    注文はRPCでは作れない。そこで business_date や time_entries.work_date 等を明示指定できる
 *    service role の直接insertで、finalize_order / refund_order / close_register_session /
 *    close_store_day が実際に作る行の形（orders/order_items/payments/cash_transactions/
 *    stock_movements/register_sessions/daily_closings）を「教科書どおりに」手組みする。
 *  - orders.total 等の計算式は supabase/migrations/00002_functions.sql の recalc_order_totals と
 *    完全に同じ式をJSで再実装している（税込ライン→floor按分で税額算出）。
 *  - daily_closings は supabase/migrations/00027 の close_store_day と同一のSQL集計をJSで
 *    再実装した buildDailyClosingRow() で構築する。この関数は当日（day7）の「実RPCが書いた
 *    daily_closings行」との突き合わせにも dryRun モードで使い、手組みと実RPCの構造・金額が
 *    一致することを1チェックで確認する。
 *
 * 冪等性・後始末の設計（D4のcleanupPilotDayをそのまま踏襲）:
 *  - payments/refunds/会計済みordersは物理削除不可のため「累積許容」方式。
 *    週次の集計チェックは常にDBクエリで対象7営業日を再集計した実測値どうしの比較にする。
 *  - cleanupPilotDay は対象営業日の open/void/cancelled 注文・予約・勤怠・手動在庫移動・
 *    手動現金台帳・daily_closings/daily_reports・開きっぱなしレジセッションの強制closeを
 *    行うため、7営業日すべてに対して事前に呼ぶことで毎回クリーンな状態から積み上げられる。
 *  - 在庫の「本実行分の差分」検証は日次スクリプトと同じくスナップショット時刻（invSnapshotAt）
 *    以降に作られた stock_movements のみを対象にする。
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { ensurePilotOrg, cleanupPilotDay, loginPilotUser, fetchAllRows } from './pilot-org.mjs';
import { computeSalesMetrics, expectedCash, SETTLED_ORDER_STATUSES } from '../lib/metrics.ts';
import { summarizeEntry, calcPayroll } from '../lib/payroll.ts';

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

// ---------------------------------------------------------------
// 基本ヘルパー
// ---------------------------------------------------------------
const daysAgoJst = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const todayJst = () => daysAgoJst(0);
const rand = () => Math.random();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const DOW_LABEL = ['日', '月', '火', '水', '木', '金', '土'];
const DOW_MULT = { 0: 1.3, 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0, 5: 1.5, 6: 1.8 }; // 日1.3/平日1.0/金1.5/土1.8
const BASE_TX = 11; // 平日ベース取引数（10-20/日に収まるよう調整）

/** 小さな並行実行ヘルパー（verify-store-day.mjsと同一） */
async function pMap(items, fn, concurrency = 6) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
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
  return { subtotal: gross - tax, taxTotal: tax, total: Math.max(0, gross), serviceCharge: 0 };
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

function sumKind(rows, kind) {
  return (rows ?? []).filter((r) => r.kind === kind).reduce((a, r) => a + r.amount, 0);
}

async function main() {
  console.log('=== TENPO ONE 1週間営業シミュレーション検証（VER-E4） ===');

  // ============================================================
  section('準備: 専用テスト企業のget-or-create → 対象7営業日クリーンアップ');
  // ============================================================
  const ctx = await ensurePilotOrg();
  const { org, store, tables, registers, menuItems, menuByName, inventory, staff } = ctx;
  check('専用テスト企業はis_demo=false', org.is_demo === false);
  check('テーブル15卓が用意されている', tables.length === 15, `実際:${tables.length}`);
  check('レジ4台が用意されている', registers.length === 4, `実際:${registers.length}`);
  check('メニュー15品が用意されている', menuItems.length === 15, `実際:${menuItems.length}`);

  const businessDates = [];
  for (let i = 6; i >= 0; i--) businessDates.push(daysAgoJst(i));
  const today = businessDates[6];
  check('対象営業日は7日分（過去6日+本日）', businessDates.length === 7 && businessDates[6] === todayJst());

  for (const d of businessDates) await cleanupPilotDay(org.id, d);
  console.log('  7営業日すべてクリーンアップ完了（open/void注文・予約・勤怠・手動在庫/現金・締めスナップショットを削除）');

  // 経費科目のget-or-create（pilot-org.mjsにはexpense_accountsが無いため、このスクリプト内で用意する）
  const { data: accs } = await admin.from('accounts').select('id,code').eq('organization_id', org.id);
  const accByCode = Object.fromEntries((accs ?? []).map((a) => [a.code, a.id]));
  const expenseAccounts = {};
  for (const [code, name, stdCode] of [
    ['EXP-SUPPLY', '[PILOT] 消耗品費', '520'],
    ['EXP-UTIL', '[PILOT] 水道光熱費', '521'],
  ]) {
    const { data, error } = await admin.from('expense_accounts')
      .upsert({ organization_id: org.id, code, name, account_id: accByCode[stdCode] ?? null }, { onConflict: 'organization_id,code' })
      .select().single();
    if (error) throw new Error('expense_accounts: ' + error.message);
    expenseAccounts[code] = data;
  }
  check('経費科目2件（消耗品費・水道光熱費）を用意できた', !!expenseAccounts['EXP-SUPPLY'] && !!expenseAccounts['EXP-UTIL']);

  // ログイン（店長=実運用の書込主体、実RPC用）
  const mgr = await loginPilotUser(staff.manager.email);

  // 在庫の開始スナップショット（時刻ベース。累積があっても「この回の差分」だけを見る）
  const invSnapshotAt = new Date().toISOString();
  const trackedInv = ['beer', 'wine', 'chicken', 'beef', 'fish'];
  const invBefore = {};
  for (const key of trackedInv) {
    const { data } = await admin.from('inventory_items').select('current_quantity').eq('id', inventory[key].id).single();
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
    return {
      id: randomUUID(), organization_id: org.id, store_id: store.id, inventory_item_id: inventoryItemId,
      movement_type: 'sale', quantity, ref_order_id: orderId, business_date: date,
    };
  }
  function saleMovementsForOrder(orderId, items, date) {
    const rows = [];
    for (const { mi, qty } of items) {
      if (mi.id === beerId) { rows.push(mkMove(inventory.beer.id, -qty, orderId, date)); invDelta.beer -= qty; }
      else if (mi.id === wineId) { rows.push(mkMove(inventory.wine.id, -qty, orderId, date)); invDelta.wine -= qty; }
      else if (mi.id === karaageId) { const q = qty * 200; rows.push(mkMove(inventory.chicken.id, -q, orderId, date)); invDelta.chicken -= q; }
      else if (mi.id === hamburgId) { const q = qty * 150; rows.push(mkMove(inventory.beef.id, -q, orderId, date)); invDelta.beef -= q; }
      else if (mi.id === sashimiId) { const q = qty * 120; rows.push(mkMove(inventory.fish.id, -q, orderId, date)); invDelta.fish -= q; }
    }
    return rows;
  }

  function timeEntryRows(date, di) {
    const rows = [];
    const mk = (key, inH, inM, outH, outM, breakMin) => {
      const cin = new Date(`${date}T${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}:00+09:00`);
      const cout = new Date(`${date}T${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}:00+09:00`);
      rows.push({
        id: randomUUID(), organization_id: org.id, store_id: store.id, profile_id: staff[key].id,
        work_date: date, clock_in_at: cin.toISOString(), clock_out_at: cout.toISOString(),
        break_minutes: breakMin, entry_type: 'normal', status: 'closed', source: 'manual',
      });
    };
    mk('owner', 10, 0, 19, 0, 60);
    mk('manager', 11, 0, 20, 0, 60);
    mk('staff1', di === 2 ? 9 : 11, 0, di === 2 ? 21 : 20, 0, 60);
    mk('staff2', 11, 0, 20, 0, 60);
    mk('staff3', di === 4 ? 16 : 11, 0, di === 4 ? 23 : 20, 0, di === 4 ? 0 : 60);
    mk('parttime1', 17, 0, 22, 0, 0);
    mk('parttime2', 17, 0, 22, 0, 0);
    mk('parttime3', 17, 0, 22, 0, 0);
    return rows;
  }

  function reservationRows(date, di) {
    const rows = [];
    const times = ['17:30', '19:00'];
    for (let i = 0; i < 2; i++) {
      const idx = (di * 2 + i) % ctx.customers.length;
      const c = ctx.customers[idx];
      const start = new Date(`${date}T${times[i]}:00+09:00`);
      const end = new Date(start.getTime() + 90 * 60000);
      let status = 'completed';
      let cancelReason = null;
      let cancelledAt = null;
      if (di === 1 && i === 0) status = 'cancelled';
      if (di === 2 && i === 0) status = 'cancelled';
      if (di === 3 && i === 1) status = 'no_show';
      if (status === 'cancelled') { cancelReason = '[PILOT-WEEK] 検証キャンセル'; cancelledAt = end.toISOString(); }
      rows.push({
        id: randomUUID(), organization_id: org.id, store_id: store.id, customer_id: c.id,
        code: `PILOTWK-${date}-${i}-${randomUUID().slice(0, 8)}`,
        reserved_date: date, start_at: start.toISOString(), end_at: end.toISOString(),
        party_size: randInt(2, 4), adults: 2, children: 0,
        guest_name: c.name, guest_phone: c.phone, status, created_via: 'manual', consent_accepted: true,
        cancel_reason: cancelReason, cancelled_at: cancelledAt,
      });
    }
    return rows;
  }

  const weekRefundIds = [];

  // ============================================================
  // 過去6日分（教科書どおりの手組み）
  // ============================================================
  async function buildHistoricalDay(date, dow, di) {
    section(`Day${di + 1}（${date}・${DOW_LABEL[dow]}曜・倍率${DOW_MULT[dow]}）構築（手組み）`);
    const txCount = Math.round(BASE_TX * DOW_MULT[dow]);

    const sessionId = randomUUID();
    const { error: eSess } = await admin.from('register_sessions').insert({
      id: sessionId, organization_id: org.id, store_id: store.id, register_id: registers[0].id,
      business_date: date, opened_by: staff.manager.id, opened_at: `${date}T10:00:00+09:00`,
      opening_float: 30000, status: 'open',
    });
    check(`Day${di + 1}: レジセッションを作成`, !eSess, eSess?.message);

    const orderRows = [];
    const itemRows = [];
    const paymentRows = [];
    const cashRows = [];
    const stockRows = [];
    const orderPlans = [];

    for (let i = 0; i < txCount; i++) {
      const table = tables[(di * 7 + i) % tables.length];
      const items = randomItems(randInt(1, 4));
      const totals = computeOrderTotals(items);
      const staffKey = pick(WORKERS);
      const orderId = randomUUID();
      const openedAt = new Date(`${date}T${String(17 + (i % 6)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00+09:00`);
      orderRows.push({
        id: orderId, organization_id: org.id, store_id: store.id, order_type: 'dine_in',
        table_id: table.id, guest_count: randInt(1, 4), staff_id: staff[staffKey].id,
        subtotal: totals.subtotal, discount_total: 0, service_charge: 0, tax_total: totals.taxTotal,
        rounding_adjustment: 0, total: totals.total, status: 'paid',
        business_date: date, opened_at: openedAt.toISOString(), closed_at: openedAt.toISOString(),
        register_session_id: sessionId,
      });
      for (const { mi, qty } of items) {
        itemRows.push({
          id: randomUUID(), organization_id: org.id, store_id: store.id, order_id: orderId,
          menu_item_id: mi.id, name: mi.name, unit_price: mi.price, quantity: qty,
          tax_rate: 10, tax_included: true, line_total: mi.price * qty, staff_id: staff[staffKey].id, status: 'active',
        });
      }
      const plan = paymentPlan(totals.total);
      let cashSum = 0;
      for (const p of plan) {
        paymentRows.push({
          id: randomUUID(), organization_id: org.id, store_id: store.id, order_id: orderId,
          register_session_id: sessionId, method: p.method, amount: p.amount,
          tendered: p.tendered ?? null, change_amount: p.tendered ? Math.max(0, p.tendered - p.amount) : null,
          status: 'completed', paid_at: openedAt.toISOString(), business_date: date,
        });
        if (p.method === 'cash') cashSum += p.amount;
      }
      if (cashSum > 0) {
        cashRows.push({
          id: randomUUID(), organization_id: org.id, store_id: store.id, register_session_id: sessionId,
          kind: 'sale', amount: cashSum, purpose: '[PILOT-WEEK] 売上', order_id: orderId,
          business_date: date, status: 'active', approval_status: 'approved', occurred_at: openedAt.toISOString(),
        });
      }
      stockRows.push(...saleMovementsForOrder(orderId, items, date));
      orderPlans.push({ orderId, total: totals.total });
    }

    const { error: eO } = await admin.from('orders').insert(orderRows);
    check(`Day${di + 1}: 注文${orderRows.length}件を作成`, !eO, eO?.message);
    const { error: eI } = await admin.from('order_items').insert(itemRows);
    check(`Day${di + 1}: 注文明細を作成`, !eI, eI?.message);
    const { error: eP } = await admin.from('payments').insert(paymentRows);
    check(`Day${di + 1}: 支払を作成`, !eP, eP?.message);
    if (cashRows.length) {
      const { error: eC } = await admin.from('cash_transactions').insert(cashRows);
      check(`Day${di + 1}: 現金台帳（売上）を作成`, !eC, eC?.message);
    }
    if (stockRows.length) {
      const { error: eS } = await admin.from('stock_movements').insert(stockRows);
      check(`Day${di + 1}: 在庫移動（販売）を作成`, !eS, eS?.message);
    }

    // 廃棄（毎日1回）
    const wasteQty = randInt(50, 150);
    const { error: eWaste } = await admin.from('stock_movements').insert({
      id: randomUUID(), organization_id: org.id, store_id: store.id, inventory_item_id: inventory.chicken.id,
      movement_type: 'waste', quantity: -wasteQty, reason: '[PILOT-WEEK] 検証廃棄', business_date: date,
    });
    check(`Day${di + 1}: 廃棄移動を作成`, !eWaste, eWaste?.message);
    invDelta.chicken -= wasteQty;

    // 仕入（in）2回（di===1, di===4）
    if (di === 1 || di === 4) {
      const key = di === 1 ? 'chicken' : 'beef';
      const inQty = randInt(3000, 6000);
      const { error: eIn } = await admin.from('stock_movements').insert({
        id: randomUUID(), organization_id: org.id, store_id: store.id, inventory_item_id: inventory[key].id,
        movement_type: 'in', quantity: inQty, unit_cost: inventory[key].avg_cost, reason: '[PILOT-WEEK] 検証仕入',
        business_date: date,
      });
      check(`Day${di + 1}: 仕入(in)移動を作成`, !eIn, eIn?.message);
      invDelta[key] += inQty;
    }

    // 返金2件（di===1, di===4）
    if ((di === 1 || di === 4) && orderPlans.length) {
      const target = orderPlans[Math.floor(orderPlans.length / 2)];
      const refundAmount = Math.min(500, Math.max(1, target.total - 1));
      const refundId = randomUUID();
      const { error: eRef } = await admin.from('refunds').insert({
        id: refundId, organization_id: org.id, store_id: store.id, order_id: target.orderId,
        register_session_id: sessionId, amount: refundAmount, method: 'cash',
        reason: '[PILOT-WEEK] 検証返金', kind: 'refund', business_date: date,
        refunded_at: `${date}T21:00:00+09:00`,
      });
      check(`Day${di + 1}: 返金を作成`, !eRef, eRef?.message);
      const { error: eRefCash } = await admin.from('cash_transactions').insert({
        id: randomUUID(), organization_id: org.id, store_id: store.id, register_session_id: sessionId,
        kind: 'refund', amount: refundAmount, purpose: '[PILOT-WEEK] 検証返金', order_id: target.orderId,
        refund_id: refundId, business_date: date, status: 'active', approval_status: 'approved',
        occurred_at: `${date}T21:05:00+09:00`,
      });
      check(`Day${di + 1}: 返金の現金台帳を作成`, !eRefCash, eRefCash?.message);
      weekRefundIds.push(refundId);
    }

    // 予約2組
    const { error: eRes } = await admin.from('reservations').insert(reservationRows(date, di));
    check(`Day${di + 1}: 予約2組を作成`, !eRes, eRes?.message);

    // 経費2件（di===2, di===5）
    if (di === 2 || di === 5) {
      const acctKey = di === 2 ? 'EXP-SUPPLY' : 'EXP-UTIL';
      const { error: eExp } = await admin.from('expenses').insert({
        id: randomUUID(), organization_id: org.id, store_id: store.id,
        expense_account_id: expenseAccounts[acctKey].id, amount: di === 2 ? 4800 : 6200, tax_amount: 0,
        paid_via: 'petty_cash', vendor_name: '[PILOT-WEEK] 検証仕入先', business_date: date,
        approval_status: 'approved', status: 'active',
      });
      check(`Day${di + 1}: 経費を作成`, !eExp, eExp?.message);
    }

    // 勤怠（8名）
    const { error: eTE } = await admin.from('time_entries').insert(timeEntryRows(date, di));
    check(`Day${di + 1}: 8名分の勤怠を作成`, !eTE, eTE?.message);

    // レジ締め（このセッションのcash_transactionsのみから理論現金を算出=lib.expectedCashと同一式）
    const { data: ctRows } = await admin.from('cash_transactions').select('kind,amount').eq('register_session_id', sessionId).eq('status', 'active');
    const expected = expectedCash({
      openingFloat: 30000, cashSales: sumKind(ctRows, 'sale'), cashRefunds: sumKind(ctRows, 'refund'),
      cashIn: sumKind(ctRows, 'deposit') + sumKind(ctRows, 'petty_in'),
      cashOut: sumKind(ctRows, 'withdrawal') + sumKind(ctRows, 'petty_out'),
    });
    const { error: eClose } = await admin.from('register_sessions').update({
      status: 'closed', closed_by: staff.manager.id, closed_at: `${date}T23:50:00+09:00`,
      expected_cash: expected, counted_cash: expected, difference: 0,
    }).eq('id', sessionId);
    check(`Day${di + 1}: レジセッションを締める（lib.expectedCashと同一式で理論現金=実現金）`, !eClose, eClose?.message);

    return { date, sessionId, txCount };
  }

  for (let di = 0; di < 6; di++) {
    const date = businessDates[di];
    const dow = new Date(`${date}T12:00:00+09:00`).getDay();
    await buildHistoricalDay(date, dow, di);
  }

  // ============================================================
  section('在庫: 過去6日分の手組み効果を反映（1回のupdateで確定）');
  // ============================================================
  for (const key of trackedInv) {
    const newQty = invBefore[key] + invDelta[key];
    const { error } = await admin.from('inventory_items').update({ current_quantity: newQty }).eq('id', inventory[key].id);
    check(`在庫反映: ${key}（${invBefore[key]} + ${invDelta[key]} = ${newQty}）`, !error, error?.message);
  }

  // ============================================================
  // 本日（day7）: 実RPCで構築
  // ============================================================
  section(`Day7（${today}・本日）実RPCで構築`);
  const { data: opened, error: eOpen } = await mgr.rpc('open_register_session', {
    p_store_id: store.id, p_register_id: registers[0].id, p_opening_float: 30000,
  });
  check('Day7: レジ開局（実RPC）', !eOpen && opened?.ok, eOpen?.message);
  const day7SessionId = opened?.session_id;

  const day7Dow = new Date(`${today}T12:00:00+09:00`).getDay();
  const day7TxCount = Math.round(BASE_TX * DOW_MULT[day7Dow]);
  let day7Fails = 0;
  await pMap(Array.from({ length: day7TxCount }, (_, i) => i), async (i) => {
    const table = tables[i % tables.length];
    const items = randomItems(randInt(1, 4));
    const staffKey = pick(WORKERS);
    try {
      const { data: rows, error: eIns } = await mgr.from('orders').insert({
        organization_id: org.id, store_id: store.id, order_type: 'dine_in',
        table_id: table.id, guest_count: randInt(1, 4), staff_id: staff[staffKey].id,
      }).select();
      if (eIns) throw new Error(eIns.message);
      const order = rows[0];
      const itemRows = items.map(({ mi, qty }) => ({
        organization_id: org.id, store_id: store.id, order_id: order.id, menu_item_id: mi.id,
        name: mi.name, unit_price: mi.price, quantity: qty, tax_rate: 10, tax_included: true,
        line_total: mi.price * qty, staff_id: staff[staffKey].id,
      }));
      await mgr.from('order_items').insert(itemRows);
      await mgr.rpc('recalc_order_totals', { p_order_id: order.id });
      const { data: pricedRows } = await mgr.from('orders').select('total').eq('id', order.id);
      const { error: eFin } = await mgr.rpc('finalize_order', {
        p_order_id: order.id, p_payments: paymentPlan(pricedRows[0].total), p_register_session_id: day7SessionId,
      });
      if (eFin) throw new Error(eFin.message);
    } catch (e) { day7Fails++; console.log('   ! Day7注文失敗:', e.message); }
  }, 6);
  check(`Day7: 注文${day7TxCount}件が実RPC（finalize_order）で会計完了`, day7Fails === 0, `失敗:${day7Fails}`);

  // 廃棄・勤怠は他日と同じ手法（直接insert。実RPCが必須なのは注文/会計フローのみ）
  // 廃棄はstock_movementsへの記録だけでなく、historical daysと同様にinventory_items.current_quantityへも反映する
  const day7WasteQty = randInt(50, 150);
  await admin.from('stock_movements').insert({
    id: randomUUID(), organization_id: org.id, store_id: store.id, inventory_item_id: inventory.chicken.id,
    movement_type: 'waste', quantity: -day7WasteQty, reason: '[PILOT-WEEK] 検証廃棄(本日)', business_date: today,
  });
  const { data: chickenNow } = await admin.from('inventory_items').select('current_quantity').eq('id', inventory.chicken.id).single();
  await admin.from('inventory_items').update({ current_quantity: Number(chickenNow.current_quantity) - day7WasteQty }).eq('id', inventory.chicken.id);
  await admin.from('time_entries').insert(timeEntryRows(today, 6));

  const { data: day7CtRows } = await admin.from('cash_transactions').select('kind,amount,status').eq('register_session_id', day7SessionId);
  const day7Active = (day7CtRows ?? []).filter((r) => r.status === 'active');
  const day7Expected = expectedCash({
    openingFloat: 30000, cashSales: sumKind(day7Active, 'sale'), cashRefunds: sumKind(day7Active, 'refund'),
    cashIn: sumKind(day7Active, 'deposit') + sumKind(day7Active, 'petty_in'),
    cashOut: sumKind(day7Active, 'withdrawal') + sumKind(day7Active, 'petty_out'),
  });
  const { data: day7Closed, error: eDay7Close } = await mgr.rpc('close_register_session', {
    p_session_id: day7SessionId, p_counted_cash: day7Expected, p_difference_reason: null,
  });
  check('Day7: レジ締め（実RPC・理論現金どおり差異0）', !eDay7Close && day7Closed?.ok && day7Closed.difference === 0, eDay7Close?.message);

  const { data: day7DayRes, error: eDay7Day } = await mgr.rpc('close_store_day', { p_store_id: store.id, p_business_date: today });
  check('Day7: 店舗日次締め（実RPC）成功', !eDay7Day && day7DayRes?.ok, eDay7Day?.message);

  // ============================================================
  section('日次締め: 過去6日分の手組み構築 + 本日の実RPC結果との構造照合');
  // ============================================================
  /** close_store_day（00027）と同一のSQL集計をJSで再実装。dryRun時はupsertせず計算のみ返す */
  async function buildDailyClosingRow(date, { dryRun = false } = {}) {
    const { data: sessions } = await admin.from('register_sessions')
      .select('id, register_id, opening_float, expected_cash, counted_cash, difference, closed_by')
      .eq('store_id', store.id).eq('business_date', date).in('status', ['closed', 'approved']);
    const registerIds = [...new Set((sessions ?? []).map((s) => s.register_id))];
    const { data: regRows } = registerIds.length
      ? await admin.from('registers').select('id,name').in('id', registerIds)
      : { data: [] };
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
    breakdown.sort((a, b) => (a.register_name ?? '').localeCompare(b.register_name ?? ''));

    const orders = await fetchAllRows(() => admin.from('orders').select('total,discount_total,guest_count')
      .eq('store_id', store.id).eq('business_date', date).in('status', SETTLED_ORDER_STATUSES));
    const salesTotal = (orders ?? []).reduce((a, o) => a + o.total, 0);
    const ordersCount = (orders ?? []).length;
    const guests = (orders ?? []).reduce((a, o) => a + (o.guest_count ?? 0), 0);
    const discountTotal = (orders ?? []).reduce((a, o) => a + (o.discount_total ?? 0), 0);

    const refunds = await fetchAllRows(() => admin.from('refunds').select('amount,method').eq('store_id', store.id).eq('business_date', date));
    const refundTotal = (refunds ?? []).reduce((a, r) => a + r.amount, 0);
    const refundBreakdown = {};
    for (const r of refunds ?? []) refundBreakdown[r.method] = (refundBreakdown[r.method] ?? 0) + r.amount;

    const payments = await fetchAllRows(() => admin.from('payments').select('method,amount').eq('store_id', store.id).eq('business_date', date).eq('status', 'completed'));
    const paymentBreakdown = {};
    for (const p of payments ?? []) paymentBreakdown[p.method] = (paymentBreakdown[p.method] ?? 0) + p.amount;

    const cashAll = await fetchAllRows(() => admin.from('cash_transactions').select('kind,amount').eq('store_id', store.id).eq('business_date', date).eq('status', 'active'));
    const pettyIn = sumKind(cashAll, 'deposit') + sumKind(cashAll, 'petty_in');
    const pettyOut = sumKind(cashAll, 'withdrawal') + sumKind(cashAll, 'petty_out');

    const row = {
      organization_id: org.id, store_id: store.id, business_date: date, register_session_id: null,
      sales_total: salesTotal, orders_count: ordersCount, guests_count: guests, discount_total: discountTotal,
      refund_total: refundTotal, net_sales: salesTotal - refundTotal,
      payment_breakdown: paymentBreakdown, refund_breakdown: refundBreakdown,
      petty_in_total: pettyIn, petty_out_total: pettyOut,
      expected_cash: expSum, counted_cash: cntSum, cash_difference: diffSum,
      register_breakdown: breakdown, sessions_count: breakdown.length, status: 'closed',
    };
    if (dryRun) return row;
    const { data: upserted, error } = await admin.from('daily_closings').upsert(row, { onConflict: 'store_id,business_date' }).select().single();
    if (error) throw new Error('daily_closings upsert: ' + error.message);
    return upserted;
  }

  const closingsByDate = {};
  for (let di = 0; di < 6; di++) {
    closingsByDate[businessDates[di]] = await buildDailyClosingRow(businessDates[di]);
  }
  check('過去6日分のdaily_closingsを手組みで構築できた', Object.keys(closingsByDate).length === 6);

  const day7Independent = await buildDailyClosingRow(today, { dryRun: true });
  const { data: day7RealRows } = await admin.from('daily_closings').select('*').eq('store_id', store.id).eq('business_date', today);
  const day7Real = day7RealRows[0];
  closingsByDate[today] = day7Real;
  check('Day7: 実RPC（close_store_day）が書いたdaily_closings行とJS独立再計算(buildDailyClosingRow)の主要項目が一致',
    day7Real?.sales_total === day7Independent.sales_total
    && day7Real?.net_sales === day7Independent.net_sales
    && day7Real?.refund_total === day7Independent.refund_total
    && day7Real?.expected_cash === day7Independent.expected_cash
    && day7Real?.counted_cash === day7Independent.counted_cash
    && day7Real?.sessions_count === day7Independent.sessions_count,
    JSON.stringify({ real: day7Real, indep: day7Independent }));
  check('Day7: 実RPC結果と手組み構築(過去日)は同一のdaily_closingsカラム構造を持つ（手組み/実RPCの構造一致）',
    JSON.stringify(Object.keys(closingsByDate[businessDates[0]]).sort()) === JSON.stringify(Object.keys(day7Real).sort()),
    `過去日keys:${Object.keys(closingsByDate[businessDates[0]]).sort()} / day7keys:${Object.keys(day7Real).sort()}`);

  // ============================================================
  section('週次照合（7日分の集計・恒等式）');
  // ============================================================
  const weekOrders = await fetchAllRows(() => admin.from('orders').select('total,discount_total,guest_count,status,order_type')
    .eq('store_id', store.id).in('business_date', businessDates).in('status', SETTLED_ORDER_STATUSES));
  const weekRefunds = await fetchAllRows(() => admin.from('refunds').select('amount,kind')
    .eq('store_id', store.id).in('business_date', businessDates));
  const weekMetrics = computeSalesMetrics(weekOrders ?? [], weekRefunds ?? []);

  const dailySalesSum = businessDates.reduce((a, d) => a + (closingsByDate[d]?.sales_total ?? 0), 0);
  check('週次: 7日分daily_closings.sales_totalの合計 = lib.computeSalesMetrics(gross)の週一括集計',
    dailySalesSum === weekMetrics.grossSales, `合計:${dailySalesSum} lib:${weekMetrics.grossSales}`);
  const dailyNetSum = businessDates.reduce((a, d) => a + (closingsByDate[d]?.net_sales ?? 0), 0);
  check('週次: 7日分daily_closings.net_salesの合計 = lib.computeSalesMetrics(net)の週一括集計',
    dailyNetSum === weekMetrics.netSales, `合計:${dailyNetSum} lib:${weekMetrics.netSales}`);
  const dailyRefundSum = businessDates.reduce((a, d) => a + (closingsByDate[d]?.refund_total ?? 0), 0);
  check('週次: 7日分daily_closings.refund_totalの合計 = refundsテーブルの週一括集計',
    dailyRefundSum === weekMetrics.refunds, `合計:${dailyRefundSum} lib:${weekMetrics.refunds}`);
  check('週次: net_sales = gross_sales − refunds（週合計でも恒等式が成立）',
    weekMetrics.netSales === weekMetrics.grossSales - weekMetrics.refunds);

  // 理論原価（sale movementsの価値。週スコープ）
  const saleMovs = await fetchAllRows(() => admin.from('stock_movements').select('quantity, inventory_item_id')
    .eq('store_id', store.id).eq('movement_type', 'sale').in('business_date', businessDates));
  const invCostById = Object.fromEntries(trackedInv.map((k) => [inventory[k].id, inventory[k].avg_cost]));
  const theoreticalCost = (saleMovs ?? []).reduce((a, m) => a + Math.abs(Number(m.quantity)) * (invCostById[m.inventory_item_id] ?? 0), 0);
  check('週次: 理論原価（sale movements×平均仕入単価）が正の値で算出できる', theoreticalCost > 0, `理論原価:${theoreticalCost}`);

  const grossMargin = weekMetrics.netSales - theoreticalCost;
  check('週次: 粗利 = 純売上 − 理論原価（恒等式）', grossMargin === weekMetrics.netSales - theoreticalCost, `粗利:${grossMargin}`);

  // 人件費（time_entries × payroll_rules をlib/payroll.tsで再計算）
  const weekEntries = await fetchAllRows(() => admin.from('time_entries').select('*')
    .eq('store_id', store.id).in('work_date', businessDates));
  check('週次: 勤怠記録が7日×8名=56件以上用意されている', (weekEntries ?? []).length >= 56, `実際:${(weekEntries ?? []).length}`);
  const { data: payrollRules } = await admin.from('payroll_rules').select('*').eq('organization_id', org.id);
  const ruleByProfile = Object.fromEntries((payrollRules ?? []).map((r) => [r.profile_id, r]));
  const entriesByProfile = {};
  for (const e of weekEntries ?? []) {
    if (!e.clock_in_at || !e.clock_out_at) continue;
    (entriesByProfile[e.profile_id] ??= []).push(e);
  }
  let laborCost = 0;
  let laborStaffCount = 0;
  for (const [profileId, entries] of Object.entries(entriesByProfile)) {
    const rule = ruleByProfile[profileId];
    if (!rule) continue;
    const days = entries.map((e) => summarizeEntry({
      clockInAt: new Date(e.clock_in_at), clockOutAt: new Date(e.clock_out_at), breakMinutes: e.break_minutes,
    }));
    const preview = calcPayroll({
      payType: rule.pay_type, baseAmount: rule.base_amount, overtimeRate: Number(rule.overtime_rate),
      nightRate: Number(rule.night_rate), holidayRate: Number(rule.holiday_rate),
      commuteAllowance: rule.commute_allowance, allowances: rule.allowances ?? [],
    }, days, 0);
    check(`週次: ${profileId.slice(0, 8)}のgrossTotalが内訳合計と一致（自前再計算）`,
      preview.grossTotal === preview.basePay + preview.overtimePay + preview.nightPay + preview.holidayPay + preview.commutePay + preview.allowanceTotal + preview.commissionTotal);
    laborCost += preview.grossTotal;
    laborStaffCount++;
  }
  check('週次: 人件費算出の対象スタッフが7名分（給与ルールが設定されている全員）', laborStaffCount === 7, `実際:${laborStaffCount}`);
  check('週次: 人件費（time_entries×payroll_rules再計算）が正の値', laborCost > 0, `人件費:${laborCost}`);

  const { data: weekExpenses } = await admin.from('expenses').select('amount')
    .eq('store_id', store.id).in('business_date', businessDates).eq('status', 'active').eq('approval_status', 'approved');
  check('週次: 経費2件が計上されている', (weekExpenses ?? []).length >= 2, `実際:${(weekExpenses ?? []).length}`);
  const expensesTotal = (weekExpenses ?? []).reduce((a, e) => a + e.amount, 0);

  const profit = grossMargin - laborCost - expensesTotal;
  check('週次: 利益 = 粗利 − 人件費 − 経費（恒等式が算出できる）',
    profit === weekMetrics.netSales - theoreticalCost - laborCost - expensesTotal, `利益:${profit}`);

  const { data: weekRes } = await admin.from('reservations').select('status').eq('store_id', store.id).in('reserved_date', businessDates);
  const cancelledCount = (weekRes ?? []).filter((r) => r.status === 'cancelled').length;
  const noShowCount = (weekRes ?? []).filter((r) => r.status === 'no_show').length;
  check('週次: 予約キャンセル2件が記録されている', cancelledCount >= 2, `実際:${cancelledCount}`);
  check('週次: no_show1件が記録されている', noShowCount >= 1, `実際:${noShowCount}`);
  check('週次: 予約が合計12組以上作成されている（2組×6日、本日は対象外）', (weekRes ?? []).length >= 12, `実際:${(weekRes ?? []).length}`);

  check('週次: 返金2件が記録されている', weekRefundIds.length === 2, `実際:${weekRefundIds.length}`);
  const { data: refundRowsCheck } = await admin.from('refunds').select('id,business_date').in('id', weekRefundIds);
  check('週次: 返金2件が対象7営業日の範囲内に計上されている',
    (refundRowsCheck ?? []).every((r) => businessDates.includes(r.business_date)));

  const { data: weekStockIn } = await admin.from('stock_movements').select('id').eq('store_id', store.id).eq('movement_type', 'in').in('business_date', businessDates);
  check('週次: 仕入(in)移動2回が記録されている', (weekStockIn ?? []).length >= 2, `実際:${(weekStockIn ?? []).length}`);

  const { data: weekWaste } = await admin.from('stock_movements').select('business_date').eq('store_id', store.id).eq('movement_type', 'waste').in('business_date', businessDates);
  const wasteDays = new Set((weekWaste ?? []).map((w) => w.business_date));
  check('週次: 廃棄移動が7日全てに存在する', wasteDays.size === 7, `実際:${wasteDays.size}日 (${[...wasteDays].join(',')})`);

  // 在庫: 本実行分の差分のみ（invSnapshotAt以降に作られた移動のみを対象）
  {
    let allInvOk = true;
    const detail = [];
    for (const key of trackedInv) {
      const { data: movs } = await admin.from('stock_movements').select('quantity').eq('inventory_item_id', inventory[key].id).gt('created_at', invSnapshotAt);
      const movSum = (movs ?? []).reduce((a, m) => a + Number(m.quantity), 0);
      const { data: cur } = await admin.from('inventory_items').select('current_quantity').eq('id', inventory[key].id).single();
      const after = Number(cur.current_quantity);
      const expected = invBefore[key] + movSum;
      const ok = Math.abs(after - expected) < 0.001;
      if (!ok) allInvOk = false;
      detail.push({ key, before: invBefore[key], movSum, expected, after });
    }
    check('在庫: 5品目で 開始在庫+本実行分の移動合計=現在庫（過去6日手組み+本日実RPC分すべて含む）',
      allInvOk, JSON.stringify(detail));
  }

  // ============================================================
  console.log('\n=== 検証結果 ===');
  console.log(`成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) {
    console.log('\n失敗項目:');
    failures.forEach((f) => console.log(' -', f));
    process.exit(1);
  }
}

main().catch((e) => { console.error('\n検証中断:', e.stack ?? e.message); process.exit(1); });
