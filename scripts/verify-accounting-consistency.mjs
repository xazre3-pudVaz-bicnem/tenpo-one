/**
 * TENPO ONE v0.4.2 返金・会計整合 実環境検証スクリプト（VER-D3）
 *
 * 使い方: node --env-file=.env.local scripts/verify-accounting-consistency.mjs
 *
 * verify-flow.mjs / verify-backoffice.mjs と同じ流儀（実ユーザーとして anon キーで
 * ログイン=RLS適用、check()/section() での記録、service role は準備・後始末のみ）で、
 * refund_order v3（明細返金・在庫戻し・営業日境界・二重/超過返金拒否）と
 * daily_closings（gross/refund/net snapshot）・返金の不変性・返金仕訳→P/Lの
 * 整合性を実データで検証する。
 *
 * 冪等性・後始末の設計:
 *  - 会計済み注文・返金レコードは設計上、物理削除できない（orders: paid/refunded の
 *    削除トリガー、refunds: REFUND_IMMUTABLE 不変トリガー）。検証取引は
 *    reason/description に「[検証]」接頭辞を付けたうえでデモデータの一部として残す
 *    （verify-flow.mjs と同じ方針）。
 *  - 累積汚染を避けるため、注文・返金は同じ検証用顧客（固定電話番号で find-or-create）・
 *    同じ検証用テーブル（T3）を使い回し、金額は各CASEの要件を満たす最小限にする。
 *  - レジセッションは開局→CASE1-7で使用→CASE8で閉局して残す（verify-flow と同じ）。
 *  - 返金仕訳（CASE11）は post 後 void_journal_entry で取消のみ（物理削除しない）。
 *  - CASE10 の journal_entry_id リンク用に作った draft 仕訳は、後始末で
 *    refunds.journal_entry_id を null に戻してから物理削除する（FK制約のため）。
 *  - CASE4/5 用の一時レシピ（menu_item_ingredients）・一時在庫品目は後始末で削除する
 *    （verify-flow.mjs 16章の一時在庫品目と同じ扱い）。
 *  - CASE12 の他企業ユーザー・組織・店舗はCASE内で完結して削除する。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.DEMO_PASSWORD || 'TenpoOne-Demo1!';
if (!url || !anonKey || !serviceKey) {
  console.error('環境変数（URL / ANON_KEY / SERVICE_ROLE_KEY）を設定してください');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function loginAs(email) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`ログイン失敗 ${email}: ${error.message}`);
  return c;
}

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

const todayJst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const daysAgoJst = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

// 日次集計（close_register_session / daily_closings と同一の定義。admin=完全可視で照会）
async function computeDailyAggregates(storeId, businessDate) {
  const { data: orders } = await admin.from('orders')
    .select('total').eq('store_id', storeId).eq('business_date', businessDate)
    .in('status', ['paid', 'refunded']);
  const salesTotal = (orders ?? []).reduce((a, o) => a + o.total, 0);
  const { data: refunds } = await admin.from('refunds')
    .select('amount, method').eq('store_id', storeId).eq('business_date', businessDate);
  const refundTotal = (refunds ?? []).reduce((a, r) => a + r.amount, 0);
  const refundBreakdown = {};
  for (const r of refunds ?? []) refundBreakdown[r.method] = (refundBreakdown[r.method] ?? 0) + r.amount;
  return { salesTotal, refundTotal, netSales: salesTotal - refundTotal, refundBreakdown };
}

// 理論現金（lib/metrics.ts expectedCash と同一定義）
async function computeExpectedCash(sessionId, openingFloat) {
  const { data: rows } = await admin.from('cash_transactions')
    .select('kind, amount').eq('register_session_id', sessionId).eq('status', 'active');
  let sales = 0, refunds = 0, depositIn = 0, withdrawal = 0;
  for (const r of rows ?? []) {
    if (r.kind === 'sale') sales += r.amount;
    else if (r.kind === 'refund') refunds += r.amount;
    else if (r.kind === 'deposit' || r.kind === 'petty_in') depositIn += r.amount;
    else if (r.kind === 'withdrawal' || r.kind === 'petty_out') withdrawal += r.amount;
  }
  return openingFloat + sales - refunds + depositIn - withdrawal;
}

async function findOrCreateCustomer(orgId, storeId, name, phone) {
  const { data: existing } = await admin.from('customers')
    .select('*').eq('organization_id', orgId).eq('phone', phone).limit(1);
  if (existing?.[0]) return existing[0];
  const { data: created } = await admin.from('customers')
    .insert({ organization_id: orgId, primary_store_id: storeId, name, phone }).select().single();
  return created;
}

async function safe(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`  ! 後始末で警告: ${label}: ${e.message ?? e}`);
  }
}

async function main() {
  console.log('=== TENPO ONE 返金・会計整合 検証（VER-D3）===');

  // ---------- 参照データ ----------
  const { data: [org] } = await admin.from('organizations').select('*').eq('is_demo', true).limit(1);
  if (!org) throw new Error('デモ企業がありません。先に seed を実行してください');
  const { data: stores } = await admin.from('stores').select('*').eq('organization_id', org.id).order('slug');
  const shibuya = stores.find((s) => s.slug === 'tenpoone-shibuya');
  const { data: [register] } = await admin.from('registers').select('*').eq('store_id', shibuya.id).limit(1);
  const { data: menuItems } = await admin.from('menu_items')
    .select('*').eq('organization_id', org.id).eq('status', 'active');
  const beer = menuItems.find((m) => m.name === '生ビール');
  const karaage = menuItems.find((m) => m.name === '鶏の唐揚げ');
  const { data: t3 } = await admin.from('restaurant_tables')
    .select('*').eq('store_id', shibuya.id).eq('name', 'T3').single();

  // 開きっぱなしのレジセッションがあれば事前に閉じておく（再実行可能性のため）
  await admin.from('register_sessions').update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('store_id', shibuya.id).eq('status', 'open');

  const mgr = await loginAs('shibuya@demo.tenpo.one'); // 渋谷店長
  const keiri = await loginAs('keiri@demo.tenpo.one');  // 本社経理

  await keiri.rpc('install_standard_accounts', { p_org: org.id }); // 冪等
  const { data: acctRows } = await admin.from('accounts')
    .select('id, code').eq('organization_id', org.id).eq('status', 'active');
  const acctByCode = new Map((acctRows ?? []).map((a) => [a.code, a]));
  function accId(code) {
    const a = acctByCode.get(code);
    if (!a) throw new Error(`勘定科目コード ${code} が未導入です`);
    return a.id;
  }

  const custMain = await findOrCreateCustomer(org.id, shibuya.id, '[検証] 返金太郎', '09099990001');
  const custPoint = await findOrCreateCustomer(org.id, shibuya.id, '[検証] 返金花子', '09099990002');

  // 後始末対象
  const postedEntryIds = [];      // void_journal_entry で取消のみ
  let linkEntryId = null;         // CASE10用（draft・最後にrefundsのFKを外してから物理削除）
  let linkedRefundId = null;
  let tempIngredientItemId = null;
  let tempRecipeId = null;
  let case9SyntheticClosingId = null;
  let org2ToCleanup = null;

  // ============================================================
  section('準備: レジ開局');
  // ============================================================
  const { data: opened, error: eOpen } = await mgr.rpc('open_register_session', {
    p_store_id: shibuya.id, p_register_id: register.id, p_opening_float: 30000,
  });
  check('検証用レジを開局できる（釣銭準備金3万円）', !eOpen && opened?.ok, eOpen?.message);
  const sessionId = opened?.session_id;

  // ============================================================
  section('CASE1: 部分返金の縦フロー');
  // ============================================================
  const { data: [order1] } = await mgr.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id, order_type: 'dine_in',
    table_id: t3.id, customer_id: custMain.id, guest_count: 2,
  }).select();
  await mgr.from('order_items').insert({
    organization_id: org.id, store_id: shibuya.id, order_id: order1.id,
    name: '[検証] 返金検証商品A', unit_price: 10000, quantity: 1,
    tax_rate: 10, tax_included: true, line_total: 10000,
  });
  await mgr.rpc('recalc_order_totals', { p_order_id: order1.id });

  const { data: custBefore1 } = await mgr.from('customers').select('total_spent').eq('id', custMain.id).single();

  const { data: fin1, error: eFin1 } = await mgr.rpc('finalize_order', {
    p_order_id: order1.id,
    p_payments: [{ method: 'cash', amount: 10000, tendered: 10000 }],
    p_register_session_id: sessionId,
  });
  check('¥10,000注文を現金で会計確定できる', !eFin1 && fin1?.ok, eFin1?.message);

  const { data: ref1, error: eRef1 } = await mgr.rpc('refund_order', {
    p_order_id: order1.id, p_amount: 3000, p_method: 'cash',
    p_reason: '[検証] 部分返金CASE1', p_register_session_id: sessionId,
  });
  check('¥3,000部分返金ができる', !eRef1 && ref1?.ok, eRef1?.message);
  const refund1Id = ref1?.refund_id;

  const { data: [refundRow1] } = await mgr.from('refunds').select('*').eq('id', refund1Id);
  check('(a) refunds.kind=refund で business_date=営業日',
    refundRow1?.kind === 'refund' && refundRow1?.business_date === todayJst(),
    `kind=${refundRow1?.kind} business_date=${refundRow1?.business_date}`);

  const { data: [orderAfter1] } = await mgr.from('orders').select('status, total').eq('id', order1.id);
  check('(b) orders.status は paid のまま・total は¥10,000のまま（gross保持）',
    orderAfter1?.status === 'paid' && orderAfter1?.total === 10000,
    `status=${orderAfter1?.status} total=${orderAfter1?.total}`);

  const { data: custAfter1 } = await mgr.from('customers').select('total_spent').eq('id', custMain.id).single();
  check('(c) customers.total_spent が¥3,000減る',
    custAfter1.total_spent === custBefore1.total_spent + 10000 - 3000,
    `before=${custBefore1.total_spent} after=${custAfter1.total_spent}`);

  const { data: refundTx1 } = await mgr.from('cash_transactions')
    .select('*').eq('refund_id', refund1Id).eq('kind', 'refund');
  check('(d) cash_transactionsにrefund行が記録される', refundTx1?.length === 1 && refundTx1[0].amount === 3000);

  const { data: [orderForMetrics1] } = await mgr.from('orders').select('total, status').eq('id', order1.id);
  const { data: refundsForMetrics1 } = await mgr.from('refunds').select('amount').eq('order_id', order1.id);
  const gross1 = orderForMetrics1.total; // lib/metrics.ts: grossSales = paid+refunded注文のtotal合計
  const refundSum1 = (refundsForMetrics1 ?? []).reduce((a, r) => a + r.amount, 0);
  const net1 = gross1 - refundSum1; // lib/metrics.ts: netSales = grossSales - refunds
  check('(e) metrics定義でnet=¥7,000になる（gross-refunds）', net1 === 7000, `gross=${gross1} refunds=${refundSum1} net=${net1}`);

  // ============================================================
  section('CASE2: 返金可能額（超過拒否・全額到達・境界1円）');
  // ============================================================
  const { error: eOver2 } = await mgr.rpc('refund_order', {
    p_order_id: order1.id, p_amount: 8000, p_method: 'cash',
    p_reason: '[検証] 超過返金試行', p_register_session_id: sessionId,
  });
  check('¥8,000返金はREFUND_EXCEEDS_PAIDで拒否される',
    !!eOver2 && /REFUND_EXCEEDS_PAID/.test(eOver2.message ?? ''), eOver2?.message);

  const { data: ref2, error: eRef2 } = await mgr.rpc('refund_order', {
    p_order_id: order1.id, p_amount: 7000, p_method: 'cash',
    p_reason: '[検証] 残額全返金', p_register_session_id: sessionId,
  });
  check('¥7,000返金は成功する（残額ちょうど）', !eRef2 && ref2?.ok, eRef2?.message);

  const { data: [orderAfter2] } = await mgr.from('orders').select('status').eq('id', order1.id);
  check('全額返金でstatus=refundedへ遷移する', orderAfter2?.status === 'refunded');

  const { data: allRefunds2 } = await mgr.from('refunds').select('amount').eq('order_id', order1.id);
  const refundSumAll2 = (allRefunds2 ?? []).reduce((a, r) => a + r.amount, 0);
  check('合計返金額=支払額（¥10,000）', refundSumAll2 === 10000, `実際: ${refundSumAll2}`);

  const { error: eOver2b } = await mgr.rpc('refund_order', {
    p_order_id: order1.id, p_amount: 1, p_method: 'cash',
    p_reason: '[検証] 全額返金後の1円返金試行', p_register_session_id: sessionId,
  });
  check('全額返金後の¥1返金もREFUND_EXCEEDS_PAIDで拒否される',
    !!eOver2b && /REFUND_EXCEEDS_PAID/.test(eOver2b.message ?? ''), eOver2b?.message);

  // ============================================================
  section('CASE3: 同時部分返金レース（FOR UPDATE直列化）');
  // ============================================================
  const { data: [order2] } = await mgr.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id, order_type: 'takeout',
    customer_id: custMain.id, guest_count: 1,
  }).select();
  await mgr.from('order_items').insert({
    organization_id: org.id, store_id: shibuya.id, order_id: order2.id,
    name: '[検証] 返金検証商品B', unit_price: 5000, quantity: 1,
    tax_rate: 10, tax_included: true, line_total: 5000,
  });
  await mgr.rpc('recalc_order_totals', { p_order_id: order2.id });
  const { data: fin2, error: eFin2 } = await mgr.rpc('finalize_order', {
    p_order_id: order2.id,
    p_payments: [{ method: 'cash', amount: 5000, tendered: 5000 }],
    p_register_session_id: sessionId,
  });
  check('¥5,000注文を会計確定できる（CASE3準備）', !eFin2 && fin2?.ok, eFin2?.message);

  const raceResults = await Promise.allSettled([
    mgr.rpc('refund_order', {
      p_order_id: order2.id, p_amount: 3000, p_method: 'cash',
      p_reason: '[検証] 同時返金A', p_register_session_id: sessionId,
    }),
    mgr.rpc('refund_order', {
      p_order_id: order2.id, p_amount: 3000, p_method: 'cash',
      p_reason: '[検証] 同時返金B', p_register_session_id: sessionId,
    }),
  ]);
  const raceOk = raceResults.filter((r) => r.status === 'fulfilled' && r.value.data?.ok);
  check('同時に¥3,000×2を投げても成功は最大1件', raceOk.length === 1, `成功数: ${raceOk.length}`);

  const { data: order2Refunds } = await mgr.from('refunds').select('amount').eq('order_id', order2.id);
  const order2RefundSum = (order2Refunds ?? []).reduce((a, r) => a + r.amount, 0);
  check('refunds合計が¥5,000を超過しない（直列化で合計超過なし）', order2RefundSum <= 5000, `実際: ${order2RefundSum}`);

  // ============================================================
  section('CASE4: 商品単位返金+在庫戻し（レシピ経由）');
  // ============================================================
  // 実デモの menu_item_ingredients は空（生ビールは inventory_items.menu_item_id への
  // 直接紐付けで、レシピ経由ではない）。restock機能はレシピ経由(menu_item_ingredients)
  // のみを対象に設計されているため、検証用の一時レシピを唐揚げに追加して実際の
  // restockフローを検証する（後始末で削除）。
  const { data: tempIng, error: eTempIng } = await admin.from('inventory_items').insert({
    organization_id: org.id, store_id: shibuya.id, name: '[検証] CASE4/5用ハーブチキン',
    item_kind: 'ingredient', unit: '個', current_quantity: 1000, avg_cost: 10,
  }).select().single();
  check('CASE4/5用の一時在庫品目を作成できる', !eTempIng && !!tempIng, eTempIng?.message);
  tempIngredientItemId = tempIng?.id ?? null;

  const { data: tempRecipe, error: eTempRecipe } = await admin.from('menu_item_ingredients').insert({
    organization_id: org.id, menu_item_id: karaage.id, inventory_item_id: tempIngredientItemId, quantity: 1,
  }).select().single();
  check('唐揚げに一時レシピ（1個消費）を追加できる', !eTempRecipe && !!tempRecipe, eTempRecipe?.message);
  tempRecipeId = tempRecipe?.id ?? null;

  const { data: [order3] } = await mgr.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id, order_type: 'takeout',
    customer_id: custMain.id, guest_count: 1,
  }).select();
  const { data: [oi3] } = await mgr.from('order_items').insert({
    organization_id: org.id, store_id: shibuya.id, order_id: order3.id,
    menu_item_id: karaage.id, name: karaage.name, unit_price: karaage.price, quantity: 2,
    tax_rate: 8, tax_included: true, line_total: karaage.price * 2,
  }).select();
  await mgr.rpc('recalc_order_totals', { p_order_id: order3.id });

  const { data: stockBefore4 } = await admin.from('inventory_items')
    .select('current_quantity').eq('id', tempIngredientItemId).single();

  const { data: fin3, error: eFin3 } = await mgr.rpc('finalize_order', {
    p_order_id: order3.id,
    p_payments: [{ method: 'cash', amount: karaage.price * 2, tendered: karaage.price * 2 }],
    p_register_session_id: sessionId,
  });
  check('唐揚げ×2（レシピ在庫あり）を会計確定できる', !eFin3 && fin3?.ok, eFin3?.message);

  const { data: stockAfterSale4 } = await admin.from('inventory_items')
    .select('current_quantity').eq('id', tempIngredientItemId).single();
  check('会計でレシピ理論在庫が2減算される（1000→998）',
    Number(stockAfterSale4.current_quantity) === Number(stockBefore4.current_quantity) - 2,
    `${stockBefore4.current_quantity} → ${stockAfterSale4.current_quantity}`);

  const { data: ref4, error: eRef4 } = await mgr.rpc('refund_order', {
    p_order_id: order3.id, p_amount: karaage.price, p_method: 'cash',
    p_reason: '[検証] 商品単位返金（在庫戻しあり）', p_register_session_id: sessionId,
    p_kind: 'refund',
    p_items: [{ order_item_id: oi3.id, quantity: 1, amount: karaage.price, restock: true }],
  });
  check('商品単位返金（1個・restock=true）が成功する', !eRef4 && ref4?.ok, eRef4?.message);
  const refund4Id = ref4?.refund_id;

  const { data: refundItems4 } = await mgr.from('refund_items').select('*').eq('refund_id', refund4Id);
  check('(a) refund_items行が正しく記録される（数量1・restock=true）',
    refundItems4?.length === 1 && refundItems4[0].order_item_id === oi3.id
    && Number(refundItems4[0].quantity) === 1 && refundItems4[0].restock === true,
    JSON.stringify(refundItems4));

  const { data: returnMovs4 } = await admin.from('stock_movements')
    .select('*').eq('inventory_item_id', tempIngredientItemId).eq('movement_type', 'return')
    .eq('ref_order_id', order3.id);
  check('(b) stock_movements に refund参照のreturn行が存在する',
    returnMovs4?.length === 1 && (returnMovs4[0].reason ?? '').includes(refund4Id),
    JSON.stringify(returnMovs4));

  const { data: stockAfterRefund4 } = await admin.from('inventory_items')
    .select('current_quantity').eq('id', tempIngredientItemId).single();
  check('(c) inventory_items残高が1個増える（998→999）',
    Number(stockAfterRefund4.current_quantity) === Number(stockAfterSale4.current_quantity) + 1,
    `${stockAfterSale4.current_quantity} → ${stockAfterRefund4.current_quantity}`);

  const { error: eRef4b } = await mgr.rpc('refund_order', {
    p_order_id: order3.id, p_amount: karaage.price, p_method: 'cash',
    p_reason: '[検証] 同一商品の数量超過再返金試行', p_register_session_id: sessionId,
    p_kind: 'refund',
    p_items: [{ order_item_id: oi3.id, quantity: 2, amount: karaage.price, restock: false }],
  });
  check('(d) 同じorder_itemの数量超過再返金はREFUND_ITEM_QTY_EXCEEDEDで拒否される',
    !!eRef4b && /REFUND_ITEM_QTY_EXCEEDED/.test(eRef4b.message ?? ''), eRef4b?.message);

  // ============================================================
  section('CASE5: 在庫戻しなし返金（restock=false）');
  // ============================================================
  const { data: [order4] } = await mgr.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id, order_type: 'takeout',
    customer_id: custMain.id, guest_count: 1,
  }).select();
  const { data: [oi4] } = await mgr.from('order_items').insert({
    organization_id: org.id, store_id: shibuya.id, order_id: order4.id,
    menu_item_id: karaage.id, name: karaage.name, unit_price: karaage.price, quantity: 1,
    tax_rate: 8, tax_included: true, line_total: karaage.price,
  }).select();
  await mgr.rpc('recalc_order_totals', { p_order_id: order4.id });
  await mgr.rpc('finalize_order', {
    p_order_id: order4.id,
    p_payments: [{ method: 'cash', amount: karaage.price, tendered: karaage.price }],
    p_register_session_id: sessionId,
  });

  const { data: returnMovsBefore5 } = await admin.from('stock_movements')
    .select('id').eq('inventory_item_id', tempIngredientItemId).eq('movement_type', 'return');
  const { data: stockBefore5 } = await admin.from('inventory_items')
    .select('current_quantity').eq('id', tempIngredientItemId).single();

  const { data: ref5, error: eRef5 } = await mgr.rpc('refund_order', {
    p_order_id: order4.id, p_amount: karaage.price, p_method: 'cash',
    p_reason: '[検証] 商品単位返金（在庫戻しなし）', p_register_session_id: sessionId,
    p_kind: 'refund',
    p_items: [{ order_item_id: oi4.id, quantity: 1, amount: karaage.price, restock: false }],
  });
  check('restock=falseの商品単位返金が成功する', !eRef5 && ref5?.ok, eRef5?.message);

  const { data: returnMovsAfter5 } = await admin.from('stock_movements')
    .select('id').eq('inventory_item_id', tempIngredientItemId).eq('movement_type', 'return');
  check('restock=falseならstock_movements returnが増えない',
    (returnMovsAfter5?.length ?? 0) === (returnMovsBefore5?.length ?? 0),
    `before=${returnMovsBefore5?.length} after=${returnMovsAfter5?.length}`);

  const { data: stockAfter5 } = await admin.from('inventory_items')
    .select('current_quantity').eq('id', tempIngredientItemId).single();
  check('restock=falseなら在庫残高が変わらない',
    Number(stockAfter5.current_quantity) === Number(stockBefore5.current_quantity),
    `${stockBefore5.current_quantity} → ${stockAfter5.current_quantity}`);

  // ---- 追加検証: 直接紐付き商品（生ビール）の返金restock ----
  // 生ビールはレシピ(menu_item_ingredients)ではなく inventory_items.menu_item_id への
  // 直接リンクで理論在庫を減算している（finalize_order の別ループ）。
  // refund_order v3 の restock 実装は menu_item_ingredients 経由のループしか持たないため、
  // 直接リンク商品の restock が実際に機能するかをここで確認する。
  section('CASE4補足: 直接紐付き商品（生ビール）のrestock動作確認');
  const { data: [orderBeer] } = await mgr.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id, order_type: 'takeout',
    customer_id: custMain.id, guest_count: 1,
  }).select();
  const { data: [oiBeer] } = await mgr.from('order_items').insert({
    organization_id: org.id, store_id: shibuya.id, order_id: orderBeer.id,
    menu_item_id: beer.id, name: beer.name, unit_price: beer.price, quantity: 1,
    tax_rate: 10, tax_included: true, line_total: beer.price,
  }).select();
  await mgr.rpc('recalc_order_totals', { p_order_id: orderBeer.id });

  const { data: beerInv } = await admin.from('inventory_items')
    .select('id, current_quantity').eq('store_id', shibuya.id).eq('menu_item_id', beer.id).single();
  const { data: beerStockBeforeSale } = await admin.from('inventory_items')
    .select('current_quantity').eq('id', beerInv.id).single();

  await mgr.rpc('finalize_order', {
    p_order_id: orderBeer.id,
    p_payments: [{ method: 'cash', amount: beer.price, tendered: beer.price }],
    p_register_session_id: sessionId,
  });
  const { data: beerStockAfterSale } = await admin.from('inventory_items')
    .select('current_quantity').eq('id', beerInv.id).single();
  check('生ビール会計で直接リンク在庫が1減算される',
    Number(beerStockAfterSale.current_quantity) === Number(beerStockBeforeSale.current_quantity) - 1,
    `${beerStockBeforeSale.current_quantity} → ${beerStockAfterSale.current_quantity}`);

  const { data: refBeer, error: eRefBeer } = await mgr.rpc('refund_order', {
    p_order_id: orderBeer.id, p_amount: beer.price, p_method: 'cash',
    p_reason: '[検証] 直接紐付き商品のrestock確認', p_register_session_id: sessionId,
    p_kind: 'refund',
    p_items: [{ order_item_id: oiBeer.id, quantity: 1, amount: beer.price, restock: true }],
  });
  check('生ビールの商品単位返金（restock=true）自体は成功する', !eRefBeer && refBeer?.ok, eRefBeer?.message);

  const { data: beerStockAfterRefund } = await admin.from('inventory_items')
    .select('current_quantity').eq('id', beerInv.id).single();
  const { data: beerReturnMovs } = await admin.from('stock_movements')
    .select('id').eq('inventory_item_id', beerInv.id).eq('movement_type', 'return').eq('ref_order_id', orderBeer.id);
  check('直接リンク商品もrestock=trueで在庫が実際に戻る（本体バグ検出用）',
    Number(beerStockAfterRefund.current_quantity) === Number(beerStockAfterSale.current_quantity) + 1
    && (beerReturnMovs?.length ?? 0) === 1,
    `在庫: ${beerStockAfterSale.current_quantity} → ${beerStockAfterRefund.current_quantity} / return行数: ${beerReturnMovs?.length}`);

  // レシピ後始末（CASE4/5で使用した一時レシピ・一時在庫）
  await safe('CASE4/5一時データの後始末', async () => {
    await admin.from('stock_movements').delete().eq('inventory_item_id', tempIngredientItemId);
    if (tempRecipeId) await admin.from('menu_item_ingredients').delete().eq('id', tempRecipeId);
    if (tempIngredientItemId) await admin.from('inventory_items').delete().eq('id', tempIngredientItemId);
  });

  // ============================================================
  section('CASE6: VOID（取引取消・全額のみ）');
  // ============================================================
  const { data: [order6] } = await mgr.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id, order_type: 'dine_in',
    table_id: t3.id, customer_id: custMain.id, guest_count: 1,
  }).select();
  await mgr.from('order_items').insert({
    organization_id: org.id, store_id: shibuya.id, order_id: order6.id,
    name: '[検証] VOID検証商品', unit_price: 4000, quantity: 1,
    tax_rate: 10, tax_included: true, line_total: 4000,
  });
  await mgr.rpc('recalc_order_totals', { p_order_id: order6.id });
  await mgr.rpc('finalize_order', {
    p_order_id: order6.id,
    p_payments: [{ method: 'cash', amount: 4000, tendered: 4000 }],
    p_register_session_id: sessionId,
  });

  const { data: voidRes6, error: eVoid6 } = await mgr.rpc('refund_order', {
    p_order_id: order6.id, p_amount: 4000, p_method: 'cash',
    p_reason: '[検証] 全額VOID', p_register_session_id: sessionId, p_kind: 'void',
  });
  check('全額VOIDが成功する', !eVoid6 && voidRes6?.ok, eVoid6?.message);
  const { data: [voidRefundRow6] } = await mgr.from('refunds').select('kind').eq('id', voidRes6?.refund_id);
  check('refunds.kind=void で記録される', voidRefundRow6?.kind === 'void');

  const { data: [order7] } = await mgr.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id, order_type: 'dine_in',
    table_id: t3.id, customer_id: custMain.id, guest_count: 1,
  }).select();
  await mgr.from('order_items').insert({
    organization_id: org.id, store_id: shibuya.id, order_id: order7.id,
    name: '[検証] VOID部分試行検証商品', unit_price: 2000, quantity: 1,
    tax_rate: 10, tax_included: true, line_total: 2000,
  });
  await mgr.rpc('recalc_order_totals', { p_order_id: order7.id });
  await mgr.rpc('finalize_order', {
    p_order_id: order7.id,
    p_payments: [{ method: 'cash', amount: 2000, tendered: 2000 }],
    p_register_session_id: sessionId,
  });
  const { error: eVoidPartial7 } = await mgr.rpc('refund_order', {
    p_order_id: order7.id, p_amount: 1000, p_method: 'cash',
    p_reason: '[検証] 部分VOID試行', p_register_session_id: sessionId, p_kind: 'void',
  });
  check('部分金額でのVOIDはVOID_MUST_BE_FULLで拒否される',
    !!eVoidPartial7 && /VOID_MUST_BE_FULL/.test(eVoidPartial7.message ?? ''), eVoidPartial7?.message);

  // ============================================================
  section('CASE7: ポイント整合（商品単位返金経由での比例取消）');
  // ============================================================
  // 再実行冪等性: 固定検証顧客は前回実行分の残高を持つため、絶対値でなく増減で検証する
  const { data: custPointBefore9 } = await admin.from('customers').select('point_balance').eq('id', custPoint.id).single();
  const { data: [order9] } = await mgr.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id, order_type: 'takeout',
    customer_id: custPoint.id, guest_count: 1,
  }).select();
  const { data: [oi9] } = await mgr.from('order_items').insert({
    organization_id: org.id, store_id: shibuya.id, order_id: order9.id,
    name: '[検証] ポイント整合検証商品', unit_price: 1000, quantity: 2,
    tax_rate: 10, tax_included: true, line_total: 2000,
  }).select();
  await mgr.rpc('recalc_order_totals', { p_order_id: order9.id });
  const { data: fin9 } = await mgr.rpc('finalize_order', {
    p_order_id: order9.id,
    p_payments: [{ method: 'cash', amount: 2000, tendered: 2000 }],
    p_register_session_id: sessionId,
  });
  check('会計時にポイントが付与される（¥2,000→20pt）', fin9?.points_earned === 20, `実際: ${fin9?.points_earned}`);

  const { data: ref9, error: eRef9 } = await mgr.rpc('refund_order', {
    p_order_id: order9.id, p_amount: 1000, p_method: 'cash',
    p_reason: '[検証] 商品単位返金でのポイント取消確認', p_register_session_id: sessionId,
    p_kind: 'refund',
    p_items: [{ order_item_id: oi9.id, quantity: 1, amount: 1000, restock: false }],
  });
  check('商品単位返金（半額）が成功する', !eRef9 && ref9?.ok, eRef9?.message);
  check('付与ポイントが比例取消される（20→10pt。商品単位返金経由）', ref9?.points_revoked === 10, `実際: ${ref9?.points_revoked}`);

  const { data: pointTx9 } = await admin.from('point_transactions')
    .select('*').eq('order_id', order9.id).eq('kind', 'revoke');
  check('point_transactionsにrevoke行が記録される', pointTx9?.length === 1 && pointTx9[0].points === -10);

  const { data: custPointAfter9 } = await admin.from('customers').select('point_balance').eq('id', custPoint.id).single();
  check('顧客のポイント残高が一致する（+20付与−10取消=+10増）',
    custPointAfter9.point_balance === custPointBefore9.point_balance + 10,
    `前: ${custPointBefore9.point_balance} 後: ${custPointAfter9.point_balance}`);

  // ============================================================
  section('CASE8: レジ締めsnapshot（gross/refund/net・理論現金）');
  // ============================================================
  const { data: sessionRow8 } = await admin.from('register_sessions').select('opening_float').eq('id', sessionId).single();
  const expectedCash8 = await computeExpectedCash(sessionId, sessionRow8.opening_float);
  const aggBefore8 = await computeDailyAggregates(shibuya.id, todayJst());

  const { data: closed8, error: eClose8 } = await mgr.rpc('close_register_session', {
    p_session_id: sessionId, p_counted_cash: expectedCash8, p_difference_reason: null,
  });
  check('レジを締められる', !eClose8 && closed8?.ok, eClose8?.message);
  check('理論現金が formula通り（開始+現金売上-現金返金+入金-出金）と一致する',
    closed8?.expected === expectedCash8, `期待:${expectedCash8} 実際:${closed8?.expected}`);
  check('差異0で締まる（実現金=理論現金で渡した）', closed8?.difference === 0);

  const { data: [closingRow8] } = await mgr.from('daily_closings')
    .select('*').eq('store_id', shibuya.id).eq('business_date', todayJst());
  check('sales_total（gross）がクエリ集計と一致する', closingRow8?.sales_total === aggBefore8.salesTotal,
    `snapshot:${closingRow8?.sales_total} query:${aggBefore8.salesTotal}`);
  check('refund_totalがクエリ集計と一致する', closingRow8?.refund_total === aggBefore8.refundTotal,
    `snapshot:${closingRow8?.refund_total} query:${aggBefore8.refundTotal}`);
  check('net_sales = sales_total - refund_totalで保存される',
    closingRow8?.net_sales === closingRow8?.sales_total - closingRow8?.refund_total,
    `net=${closingRow8?.net_sales} gross=${closingRow8?.sales_total} refund=${closingRow8?.refund_total}`);
  check('refund_breakdown（cash）がクエリ集計と一致する',
    (closingRow8?.refund_breakdown?.cash ?? 0) === (aggBefore8.refundBreakdown.cash ?? 0),
    `snapshot:${closingRow8?.refund_breakdown?.cash} query:${aggBefore8.refundBreakdown.cash}`);
  check('expected_cashが保存される（理論現金と一致）', closingRow8?.expected_cash === expectedCash8);
  check('counted_cashが保存される（渡した実現金と一致）', closingRow8?.counted_cash === expectedCash8);

  // ============================================================
  section('CASE9: 締め後返金の日付分離（過去締めの不変）');
  // ============================================================
  const { data: pastClosings9 } = await admin.from('daily_closings')
    .select('*').eq('store_id', shibuya.id).eq('status', 'closed')
    .lt('business_date', todayJst()).order('business_date', { ascending: false }).limit(1);
  let pastClosing9 = pastClosings9?.[0];
  let pastDate9;
  if (pastClosing9) {
    pastDate9 = pastClosing9.business_date;
  } else {
    // 既存の過去締めが無い環境向けフォールバック: 検証用に一つ作る
    pastDate9 = daysAgoJst(2);
    const agg9 = await computeDailyAggregates(shibuya.id, pastDate9);
    const { data: created9 } = await admin.from('daily_closings').insert({
      organization_id: org.id, store_id: shibuya.id, business_date: pastDate9,
      sales_total: agg9.salesTotal, refund_total: agg9.refundTotal, net_sales: agg9.netSales,
      refund_breakdown: agg9.refundBreakdown, status: 'closed', note: '[検証] CASE9用の締めsnapshot',
    }).select().single();
    pastClosing9 = created9;
    case9SyntheticClosingId = created9?.id ?? null;
    pastDate9 = created9.business_date;
  }
  check('CASE9対象の過去営業日締め行を用意できた', !!pastClosing9, `pastDate=${pastDate9}`);

  const { data: [pastOrder9] } = await admin.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id, order_type: 'takeout',
    status: 'paid', business_date: pastDate9, total: 500, subtotal: 500,
    memo: '[検証] CASE9 過去日付注文',
  }).select();
  await admin.from('payments').insert({
    organization_id: org.id, store_id: shibuya.id, order_id: pastOrder9.id,
    method: 'cash', amount: 500, status: 'completed', business_date: pastDate9,
  });
  check('過去営業日の会計済み注文を用意できた（service role・finalize_order不使用）', !!pastOrder9);

  const { data: refPast9, error: eRefPast9 } = await mgr.rpc('refund_order', {
    p_order_id: pastOrder9.id, p_amount: 500, p_method: 'cash',
    p_reason: '[検証] 締め後の翌営業日返金', p_register_session_id: null,
  });
  check('締め済み過去営業日の注文を「今日」返金できる', !eRefPast9 && refPast9?.ok, eRefPast9?.message);

  const { data: [refundRowPast9] } = await mgr.from('refunds').select('business_date').eq('id', refPast9?.refund_id);
  check('refunds.business_dateは返金日（今日）側になる（元取引の営業日ではない）',
    refundRowPast9?.business_date === todayJst() && refundRowPast9?.business_date !== pastDate9,
    `refund business_date=${refundRowPast9?.business_date} 元取引=${pastDate9}`);

  const { data: [pastClosingAfter9] } = await admin.from('daily_closings')
    .select('*').eq('store_id', shibuya.id).eq('business_date', pastDate9);
  check('過去締め済みのdaily_closings行は変わらない（sales_total/refund_total/net_sales）',
    pastClosingAfter9?.sales_total === pastClosing9.sales_total
    && pastClosingAfter9?.refund_total === pastClosing9.refund_total
    && pastClosingAfter9?.net_sales === pastClosing9.net_sales,
    `前: sales=${pastClosing9.sales_total} refund=${pastClosing9.refund_total} net=${pastClosing9.net_sales} / `
    + `後: sales=${pastClosingAfter9?.sales_total} refund=${pastClosingAfter9?.refund_total} net=${pastClosingAfter9?.net_sales}`);

  // ============================================================
  section('CASE10: 返金の不変性');
  // ============================================================
  const { data: linkEntry10, error: eLinkEntry10 } = await keiri.from('journal_entries').insert({
    organization_id: org.id, store_id: shibuya.id, entry_date: todayJst(),
    description: '[検証] CASE10 journal_entry_idリンク用（draft）',
    source_type: 'manual', source_id: `verify-case10-link-${Date.now()}`,
  }).select().single();
  check('リンク用の仕訳（draft）を作成できる', !eLinkEntry10 && !!linkEntry10, eLinkEntry10?.message);
  linkEntryId = linkEntry10?.id ?? null;

  const { data: linkUpd10, error: eLinkUpd10 } = await mgr.from('refunds')
    .update({ journal_entry_id: linkEntryId }).eq('id', refund1Id).select();
  check('journal_entry_idのUPDATEは成功する（後付けリンク許可）', !eLinkUpd10 && linkUpd10?.length === 1, eLinkUpd10?.message);
  linkedRefundId = refund1Id;

  const { error: eAmountUpd10 } = await mgr.from('refunds').update({ amount: 999 }).eq('id', refund1Id);
  check('refunds.amountのUPDATEはREFUND_IMMUTABLEで拒否される',
    !!eAmountUpd10 && /REFUND_IMMUTABLE/.test(eAmountUpd10.message ?? ''), eAmountUpd10?.message);

  const { error: eDel10 } = await mgr.from('refunds').delete().eq('id', refund1Id);
  const { data: stillThere10 } = await mgr.from('refunds').select('id').eq('id', refund1Id);
  check('refundsのDELETEは拒否される', !!eDel10 || stillThere10?.length === 1);

  // ============================================================
  section('CASE11: 返金仕訳→P/L（buildRefundJournal相当）');
  // ============================================================
  const d11 = todayJst();
  const sourceId11 = `${shibuya.id}:${d11}`;
  const refundJournalAmount11 = 3000;

  const { data: revenueBefore11 } = await admin.from('journal_entry_lines')
    .select('side, amount, entry_id!inner(entry_date, status)')
    .eq('account_id', accId('400')).eq('entry_id.entry_date', d11).eq('entry_id.status', 'posted');
  const revNetBefore11 = (revenueBefore11 ?? []).reduce((a, l) => a + (l.side === 'credit' ? l.amount : -l.amount), 0);

  const { data: entry11, error: eEntry11 } = await keiri.from('journal_entries').insert({
    organization_id: org.id, store_id: shibuya.id, entry_date: d11,
    description: '[検証] 売上返金仕訳（buildRefundJournal相当）',
    source_type: 'pos_refund', source_id: sourceId11,
  }).select().single();
  check('返金仕訳（draft）を作成できる', !eEntry11 && !!entry11, eEntry11?.message);
  await keiri.from('journal_entry_lines').insert([
    { organization_id: org.id, entry_id: entry11.id, line_no: 1, account_id: accId('400'),
      side: 'debit', amount: refundJournalAmount11, tax_treatment: 'taxable_standard', store_id: shibuya.id },
    { organization_id: org.id, entry_id: entry11.id, line_no: 2, account_id: accId('100'),
      side: 'credit', amount: refundJournalAmount11, tax_treatment: 'out_of_scope', store_id: shibuya.id },
  ]);
  const { data: postRes11, error: ePost11 } = await keiri.rpc('post_journal_entry', { p_entry_id: entry11.id });
  check('返金仕訳（借方売上高/貸方現金）を確定できる', !ePost11 && postRes11?.ok, ePost11?.message);
  postedEntryIds.push(entry11.id);

  // 再実行冪等性: 前回実行が後始末でvoid済みにした同一source_id仕訳が残るため、有効(非void)のみで判定
  const { data: dupEntries11 } = await admin.from('journal_entries')
    .select('id').eq('organization_id', org.id).eq('source_type', 'pos_refund').eq('source_id', sourceId11)
    .neq('status', 'voided');
  check('同一source_idの有効な返金仕訳は1件のみ存在する', dupEntries11?.length === 1 && dupEntries11[0].id === entry11.id);

  const { data: revenueAfter11 } = await admin.from('journal_entry_lines')
    .select('side, amount, entry_id!inner(entry_date, status)')
    .eq('account_id', accId('400')).eq('entry_id.entry_date', d11).eq('entry_id.status', 'posted');
  const revNetAfter11 = (revenueAfter11 ?? []).reduce((a, l) => a + (l.side === 'credit' ? l.amount : -l.amount), 0);
  check('売上高のposted集計が返金分だけ減る（net一致）',
    revNetBefore11 - revNetAfter11 === refundJournalAmount11,
    `before=${revNetBefore11} after=${revNetAfter11} diff=${revNetBefore11 - revNetAfter11}`);

  // ============================================================
  section('CASE12: 企業間分離（refunds / refund_items）');
  // ============================================================
  const { data: org2 } = await admin.from('organizations').insert({
    name: '[検証] 返金RLSテスト用他社（削除予定）', status: 'active', is_demo: false,
  }).select().single();
  org2ToCleanup = org2.id;
  const { data: store2 } = await admin.from('stores').insert({
    organization_id: org2.id, slug: `verify-refund-rls-${Date.now()}`, name: '検証店舗2',
  }).select().single();
  const otherEmail12 = `verify-refund-other-${Date.now()}@example.com`;
  const { data: newUser12, error: eNewUser12 } = await admin.auth.admin.createUser({
    email: otherEmail12, password: PASSWORD, email_confirm: true,
  });
  check('検証用の他社ユーザーを作成できる', !eNewUser12 && !!newUser12?.user, eNewUser12?.message);
  await admin.from('memberships').insert({
    organization_id: org2.id, profile_id: newUser12.user.id, role: 'org_owner', status: 'active',
  });
  const otherClient12 = await loginAs(otherEmail12);

  const { data: xRefunds12 } = await otherClient12.from('refunds')
    .select('id').in('id', [refund1Id, refund4Id, voidRes6?.refund_id].filter(Boolean));
  check('他企業ユーザーはdemo企業のrefundsを取得できない', (xRefunds12 ?? []).length === 0);

  const { data: xRefundItems12 } = await otherClient12.from('refund_items')
    .select('id').in('refund_id', [refund4Id].filter(Boolean));
  check('他企業ユーザーはdemo企業のrefund_itemsを取得できない', (xRefundItems12 ?? []).length === 0);

  await admin.from('memberships').delete().eq('organization_id', org2.id).eq('profile_id', newUser12.user.id);
  await admin.auth.admin.deleteUser(newUser12.user.id);
  await admin.from('stores').delete().eq('id', store2.id);
  await admin.from('organizations').delete().eq('id', org2.id);
  org2ToCleanup = null;

  // ============================================================
  console.log('\n=== 検証結果 ===');
  console.log(`成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) {
    console.log('\n失敗項目:');
    failures.forEach((f) => console.log(' -', f));
  }

  await cleanup();

  if (failures.length) process.exit(1);

  async function cleanup() {
    console.log('\n■ 後始末');

    for (const id of postedEntryIds) {
      await safe(`journal_entry ${id} のvoid`, async () => {
        const { error } = await keiri.rpc('void_journal_entry', { p_entry_id: id, p_reason: '[検証] 後始末のため取消' });
        if (error && !/ENTRY_NOT_POSTED/.test(error.message ?? '')) throw error;
      });
    }

    // CASE10のリンク用draft仕訳: refunds.journal_entry_id を null に戻してから物理削除（FK制約）
    if (linkEntryId) {
      await safe('CASE10リンク仕訳の後始末', async () => {
        if (linkedRefundId) {
          await admin.from('refunds').update({ journal_entry_id: null }).eq('id', linkedRefundId);
        }
        await admin.from('journal_entries').delete().eq('id', linkEntryId);
      });
    }

    if (case9SyntheticClosingId) {
      await safe('CASE9合成daily_closings行の削除', () =>
        admin.from('daily_closings').delete().eq('id', case9SyntheticClosingId));
    }

    if (org2ToCleanup) {
      await safe('org2 の削除（保険）', () => admin.from('organizations').delete().eq('id', org2ToCleanup));
    }

    console.log('  後始末完了');
  }
}

main().catch((e) => { console.error('\n検証中断:', e.message); process.exit(1); });
