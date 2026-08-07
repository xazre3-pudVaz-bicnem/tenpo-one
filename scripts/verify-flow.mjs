/**
 * TENPO ONE 実環境 総合検証スクリプト
 *
 * 使い方: node --env-file=.env.local scripts/verify-flow.mjs
 *
 * 実際のデモユーザーとして anon キーでログインし（= RLS適用状態で）、
 * 予約→台帳→割当→着席→注文→会計→返金→レジ締め の縦フローと、
 * 各モジュールのCRUD・権限・RLS分離を実データで検証する。
 *
 * 検証データには「検証」の接頭辞を付ける。会計済み取引は設計上
 * 物理削除できないため、検証取引はデモデータの一部として残る。
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

async function main() {
  console.log('=== TENPO ONE 実環境総合検証 ===');

  // ---------- 参照データ ----------
  const { data: [org] } = await admin.from('organizations').select('*').eq('is_demo', true).limit(1);
  if (!org) throw new Error('デモ企業がありません。先に seed を実行してください');
  const { data: stores } = await admin.from('stores').select('*').eq('organization_id', org.id).order('slug');
  const shibuya = stores.find((s) => s.slug === 'tenpoone-shibuya');
  const yokohama = stores.find((s) => s.slug === 'tenpoone-yokohama');
  const { data: [register] } = await admin.from('registers').select('*').eq('store_id', shibuya.id).limit(1);
  const { data: menuItems } = await admin.from('menu_items')
    .select('*').eq('organization_id', org.id).eq('status', 'active');
  const beer = menuItems.find((m) => m.name === '生ビール');
  const karaage = menuItems.find((m) => m.name === '鶏の唐揚げ');

  const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const uid = (email) => userList.users.find((u) => u.email === email)?.id;
  const staff1Id = uid('staff1@demo.tenpo.one');

  // 開きっぱなしのレジセッションがあれば事前に閉じておく（再実行可能性のため）
  await admin.from('register_sessions').update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('store_id', shibuya.id).eq('status', 'open');

  // クライアント（実ユーザー・RLS適用）
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const mgr = await loginAs('shibuya@demo.tenpo.one');       // 渋谷店長
  const mgrYokohama = await loginAs('yokohama@demo.tenpo.one'); // 横浜店長
  const hq = await loginAs('hq@demo.tenpo.one');             // 本社管理者
  const keiri = await loginAs('keiri@demo.tenpo.one');       // 本社経理
  const partTime = await loginAs('staff2@demo.tenpo.one');   // アルバイト
  const staff1 = await loginAs('staff1@demo.tenpo.one');     // 一般スタッフ
  const zeirishi = await loginAs('zeirishi@demo.tenpo.one'); // 外部会計

  // ============================================================
  section('1. 公開予約（匿名・RPC経由）');
  // ============================================================
  const bookDate = new Date(Date.now() + 3 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const guestPhone = `090${String(90000000 + Math.floor(Math.random() * 9999999)).padStart(8, '0')}`;

  const { data: bookStore, error: e1 } = await anon.rpc('get_booking_store', { p_slug: 'tenpoone-shibuya' });
  check('get_booking_store で店舗情報を取得', !e1 && bookStore?.name === 'TENPO ONE 渋谷店', e1?.message);

  const { data: slots, error: e2 } = await anon.rpc('get_booking_availability', {
    p_slug: 'tenpoone-shibuya', p_date: bookDate, p_party: 2,
  });
  const slot = (slots ?? []).find((s) => s.available);
  check('空席スロットが返る', !e2 && !!slot, e2?.message ?? 'available枠なし');

  const { data: created, error: e3 } = await anon.rpc('create_public_reservation', {
    p_slug: 'tenpoone-shibuya', p_date: bookDate, p_time: slot?.time ?? '18:00',
    p_party: 2, p_adults: 2, p_children: 0,
    p_name: '検証 太郎', p_kana: 'ケンショウ タロウ', p_phone: guestPhone,
    p_email: 'kensho@example.com', p_allergy: 'そば', p_request: '窓際希望（検証データ）',
    p_consent: true,
  });
  check('公開予約を作成できる', !e3 && !!created?.code, e3?.message);
  const resCode = created?.code;

  const { data: pubRes } = await anon.rpc('get_public_reservation', { p_code: resCode, p_phone: guestPhone });
  check('予約コード+電話番号で照会できる', pubRes?.guest_name === '検証 太郎');

  // ============================================================
  section('2. 予約台帳（店長）→ テーブル割当 → 着席');
  // ============================================================
  const { data: [reservation] } = await mgr.from('reservations').select('*').eq('code', resCode);
  check('台帳（店長）から予約が見える', !!reservation);
  check('顧客が自動作成され予約に紐付く', !!reservation?.customer_id);
  const customerId = reservation.customer_id;

  const { data: tables } = await mgr.from('restaurant_tables')
    .select('*').eq('store_id', shibuya.id).eq('status', 'active').order('sort_order');
  const table = tables.find((t) => t.name === 'T1');
  const { error: e4 } = await mgr.from('reservation_tables')
    .upsert({ reservation_id: reservation.id, table_id: table.id }, { onConflict: 'reservation_id,table_id' });
  check('テーブル割当を保存できる', !e4, e4?.message);

  const { error: e5 } = await mgr.from('reservations')
    .update({ status: 'seated' }).eq('id', reservation.id);
  const { error: e5b } = await mgr.from('restaurant_tables')
    .update({ current_status: 'seated' }).eq('id', table.id);
  check('着席状態へ変更できる', !e5 && !e5b, e5?.message ?? e5b?.message);

  // ============================================================
  section('3. 注文（同一 reservation_id / customer_id で連動）');
  // ============================================================
  const { data: [order], error: e6 } = await mgr.from('orders').insert({
    organization_id: org.id, store_id: shibuya.id,
    reservation_id: reservation.id, customer_id: customerId, table_id: table.id,
    order_type: 'dine_in', guest_count: 2, staff_id: staff1Id,
  }).select();
  check('予約から注文を作成できる', !e6 && !!order, e6?.message);

  const { error: e7 } = await mgr.from('order_items').insert([
    { organization_id: org.id, store_id: shibuya.id, order_id: order.id,
      menu_item_id: beer.id, name: beer.name, unit_price: beer.price, quantity: 2,
      tax_rate: 10, tax_included: true, line_total: beer.price * 2, staff_id: staff1Id },
    { organization_id: org.id, store_id: shibuya.id, order_id: order.id,
      menu_item_id: karaage.id, name: karaage.name, unit_price: karaage.price, quantity: 1,
      tax_rate: 10, tax_included: true, line_total: karaage.price, staff_id: staff1Id },
  ]);
  check('商品を注文できる（生ビール×2・唐揚げ×1）', !e7, e7?.message);

  await mgr.rpc('recalc_order_totals', { p_order_id: order.id });
  const { data: [calced] } = await mgr.from('orders').select('*').eq('id', order.id);
  const expectedTotal = beer.price * 2 + karaage.price; // 2180
  check(`合計金額が再計算される（¥${expectedTotal}）`, calced?.total === expectedTotal,
    `実際: ${calced?.total}`);
  check('内税額が整数円で計算される', Number.isInteger(calced?.tax_total) && calced.tax_total > 0);

  // ============================================================
  section('4. レジ開局 → 会計（現金+クレジット併用）');
  // ============================================================
  const { data: opened, error: e8 } = await mgr.rpc('open_register_session', {
    p_store_id: shibuya.id, p_register_id: register.id, p_opening_float: 30000,
  });
  check('レジを開局できる（釣銭準備金3万円）', !e8 && opened?.ok, e8?.message);
  const sessionId = opened?.session_id;

  const { data: beerStockBefore } = await mgr.from('inventory_items')
    .select('current_quantity').eq('store_id', shibuya.id).eq('menu_item_id', beer.id).single();

  const cashPart = 1180;
  const creditPart = expectedTotal - cashPart;
  const { data: fin, error: e9 } = await mgr.rpc('finalize_order', {
    p_order_id: order.id,
    p_payments: [
      { method: 'cash', amount: cashPart, tendered: 2000 },
      { method: 'credit', amount: creditPart },
    ],
    p_register_session_id: sessionId,
  });
  check('複数支払方法の併用で会計を確定できる', !e9 && fin?.ok, e9?.message);

  // ============================================================
  section('5. 会計後の自動連動（7系統）');
  // ============================================================
  const { data: [paidOrder] } = await mgr.from('orders').select('*').eq('id', order.id);
  check('① 売上: 注文が paid になり営業日が記録される',
    paidOrder?.status === 'paid' && paidOrder?.business_date === todayJst());

  const { data: pays } = await mgr.from('payments').select('*').eq('order_id', order.id);
  const paySum = (pays ?? []).reduce((a, p) => a + p.amount, 0);
  const cashPay = (pays ?? []).find((p) => p.method === 'cash');
  check('② 支払方法別売上: 現金/クレジット2行・合計一致', pays?.length === 2 && paySum === expectedTotal);
  check('   現金のお釣りが記録される（¥820）', cashPay?.change_amount === 2000 - cashPart,
    `実際: ${cashPay?.change_amount}`);

  const { data: [cust] } = await mgr.from('customers').select('*').eq('id', customerId);
  check('③ 顧客履歴: 来店回数+1・累計利用額に反映',
    cust?.visit_count === 1 && cust?.total_spent === expectedTotal,
    `visit=${cust?.visit_count} spent=${cust?.total_spent}`);

  const { data: cashTx } = await mgr.from('cash_transactions')
    .select('*').eq('order_id', order.id).eq('kind', 'sale');
  check('④ レジ残高: 現金分がレジ台帳へ記録される', cashTx?.length === 1 && cashTx[0].amount === cashPart);
  check('   レジセッションIDと注文IDで紐付く',
    cashTx?.[0]?.register_session_id === sessionId);

  const { data: [afterRes] } = await mgr.from('reservations').select('status').eq('id', reservation.id);
  check('⑤ 予約: completed へ自動遷移', afterRes?.status === 'completed');

  const { data: [afterTable] } = await mgr.from('restaurant_tables').select('current_status').eq('id', table.id);
  check('⑥ テーブル: 清掃中へ自動遷移', afterTable?.current_status === 'cleaning');

  const { data: beerStockAfter } = await mgr.from('inventory_items')
    .select('current_quantity').eq('store_id', shibuya.id).eq('menu_item_id', beer.id).single();
  check('⑦ 在庫: 生ビールが2減算される',
    Number(beerStockAfter?.current_quantity) === Number(beerStockBefore.current_quantity) - 2,
    `${beerStockBefore?.current_quantity} → ${beerStockAfter?.current_quantity}`);
  const { data: mov } = await mgr.from('stock_movements')
    .select('*').eq('ref_order_id', order.id).eq('movement_type', 'sale');
  check('   在庫移動履歴が注文IDと紐付く', mov?.length === 1 && Number(mov[0].quantity) === -2);

  check('⑧ スタッフ実績: 担当スタッフが記録される', paidOrder?.staff_id === staff1Id);

  const { data: auditFinalize } = await mgr.from('audit_logs')
    .select('*').eq('target_table', 'orders').eq('target_id', order.id).eq('action', 'order.finalize');
  check('⑨ 監査ログ: 会計確定が記録される', (auditFinalize?.length ?? 0) >= 1);

  // ============================================================
  section('6. 返金（元取引との関連保持）・権限');
  // ============================================================
  const { data: refunded, error: e10 } = await mgr.rpc('refund_order', {
    p_order_id: order.id, p_amount: 500, p_method: 'cash',
    p_reason: '料理提供遅延のお詫び（検証）', p_register_session_id: sessionId,
  });
  check('店長は一部返金できる', !e10 && refunded?.ok, e10?.message);

  const { data: refunds } = await mgr.from('refunds').select('*').eq('order_id', order.id);
  check('返金が元注文IDと紐付いて保存される', refunds?.length === 1 && refunds[0].amount === 500);
  const { data: [custAfterRefund] } = await mgr.from('customers').select('total_spent').eq('id', customerId);
  check('顧客累計額から返金分が減算される', custAfterRefund?.total_spent === expectedTotal - 500);
  const { data: refundTx } = await mgr.from('cash_transactions')
    .select('*').eq('refund_id', refunds[0].id).eq('kind', 'refund');
  check('現金返金がレジ台帳へ記録される', refundTx?.length === 1 && refundTx[0].amount === 500);

  const { error: ePtRefund } = await partTime.rpc('refund_order', {
    p_order_id: order.id, p_amount: 100, p_method: 'cash', p_reason: '不正試行',
  });
  check('アルバイトの返金は拒否される（FORBIDDEN）', !!ePtRefund, '拒否されるべき操作が成功');

  // ============================================================
  section('7. 決済済み取引の物理削除防止');
  // ============================================================
  const { error: eDelPay } = await mgr.from('payments').delete().eq('order_id', order.id);
  check('payments の物理削除はDBトリガーで拒否される', !!eDelPay);
  const { error: eDelOrder } = await mgr.from('orders').delete().eq('id', order.id);
  const { data: stillThere } = await mgr.from('orders').select('id').eq('id', order.id);
  check('会計済み注文の物理削除は拒否される', !!eDelOrder || stillThere?.length === 1);

  // ============================================================
  section('8. レジ締め → 日次締め → レポート反映');
  // ============================================================
  const expectedCash = 30000 + cashPart - 500;
  const { data: closed, error: e11 } = await mgr.rpc('close_register_session', {
    p_session_id: sessionId, p_counted_cash: expectedCash, p_difference_reason: null,
  });
  check('レジ締めができる', !e11 && closed?.ok, e11?.message);
  check(`理論現金が正しい（¥${expectedCash} = 3万+現金売上−現金返金）`,
    closed?.expected === expectedCash, `実際: ${closed?.expected}`);
  check('差異0で締まる', closed?.difference === 0);

  const { data: [closing] } = await mgr.from('daily_closings')
    .select('*').eq('store_id', shibuya.id).eq('business_date', todayJst());
  check('日次締めサマリが作成される', !!closing && closing.sales_total >= expectedTotal);
  check('支払方法別内訳が記録される',
    (closing?.payment_breakdown?.cash ?? 0) >= cashPart && (closing?.payment_breakdown?.credit ?? 0) >= creditPart);

  // ダッシュボード・レポートのデータソース検証（当日売上に反映されているか）
  const { data: todayOrders } = await mgr.from('orders')
    .select('total').eq('store_id', shibuya.id).eq('business_date', todayJst()).eq('status', 'paid');
  const todaySales = (todayOrders ?? []).reduce((a, o) => a + o.total, 0);
  check('ダッシュボード当日売上に本取引が含まれる', todaySales >= expectedTotal, `当日売上: ${todaySales}`);

  const { data: hqClosings } = await hq.from('daily_closings')
    .select('store_id').eq('business_date', todayJst());
  check('本社アカウントから本日の締めが見える', (hqClosings ?? []).some((c) => c.store_id === shibuya.id));

  // ============================================================
  section('9. RLS: 店舗間分離');
  // ============================================================
  const { data: xRes } = await mgrYokohama.from('reservations').select('id').eq('id', reservation.id);
  check('横浜店長は渋谷の予約IDを直接指定しても取得できない', (xRes ?? []).length === 0);
  const { data: xOrder } = await mgrYokohama.from('orders').select('id').eq('id', order.id);
  check('横浜店長は渋谷の注文を取得できない', (xOrder ?? []).length === 0);
  const { data: xSession } = await mgrYokohama.from('register_sessions').select('id').eq('id', sessionId);
  check('横浜店長は渋谷のレジセッションを取得できない', (xSession ?? []).length === 0);
  const { data: hqOrder } = await hq.from('orders').select('id').eq('id', order.id);
  check('本社は全店舗の注文を閲覧できる', (hqOrder ?? []).length === 1);
  const { data: zOrder } = await zeirishi.from('orders').select('id').eq('id', order.id);
  check('外部会計は閲覧できる（読み取り専用ロール）', (zOrder ?? []).length === 1);
  const { error: zWrite } = await zeirishi.from('orders')
    .update({ memo: '不正試行' }).eq('id', order.id).select().single();
  const { data: [zCheck] } = await hq.from('orders').select('memo').eq('id', order.id);
  check('外部会計の書込は拒否される', !!zWrite || zCheck?.memo !== '不正試行');

  // ============================================================
  section('10. RLS: 企業間完全分離');
  // ============================================================
  const { data: [org2] } = await admin.from('organizations').insert({
    name: 'RLS検証用企業（削除予定）', status: 'active', is_demo: false,
  }).select();
  const { data: [store2] } = await admin.from('stores').insert({
    organization_id: org2.id, slug: `rls-test-${Date.now()}`, name: 'RLS検証店舗',
  }).select();
  const { data: [cust2] } = await admin.from('customers').insert({
    organization_id: org2.id, name: '他社顧客', phone: '0000000000',
  }).select();

  const { data: xOrg } = await mgr.from('organizations').select('id').eq('id', org2.id);
  check('他企業の組織情報を取得できない', (xOrg ?? []).length === 0);
  const { data: xStore } = await hq.from('stores').select('id').eq('id', store2.id);
  check('本社アカウントでも他企業の店舗を取得できない', (xStore ?? []).length === 0);
  const { data: xCust } = await mgr.from('customers').select('id').eq('id', cust2.id);
  check('他企業の顧客をIDを直接指定しても取得できない', (xCust ?? []).length === 0);
  const { data: xUpd } = await mgr.from('customers')
    .update({ name: '改ざん試行' }).eq('id', cust2.id).select();
  check('他企業データの更新は0件（改ざん不可）', (xUpd ?? []).length === 0);

  await admin.from('customers').delete().eq('id', cust2.id);
  await admin.from('stores').delete().eq('id', store2.id);
  await admin.from('organizations').delete().eq('id', org2.id);

  // ============================================================
  section('11. 権限: ロール別アクセス制御');
  // ============================================================
  const { data: ptCust } = await partTime.from('customers').select('id').limit(5);
  check('アルバイトは顧客個人情報を閲覧できない', (ptCust ?? []).length === 0);
  const { data: acCust } = await keiri.from('customers').select('id').limit(5);
  check('経理担当は顧客個人情報を閲覧できない', (acCust ?? []).length === 0);
  const { data: s1Cust } = await staff1.from('customers').select('id').limit(5);
  check('一般スタッフは顧客を閲覧できる', (s1Cust ?? []).length > 0);

  const { data: ptRules } = await partTime.from('payroll_rules').select('profile_id');
  const ptOthers = (ptRules ?? []).filter((r) => r.profile_id !== uid('staff2@demo.tenpo.one'));
  check('アルバイトは他人の給与ルールを閲覧できない（00006修正）', ptOthers.length === 0,
    `他人の行が${ptOthers.length}件見えている`);
  const { data: acRules } = await keiri.from('payroll_rules').select('id');
  check('経理は全給与ルールを閲覧できる', (acRules ?? []).length >= 6);
  const { data: ptItems } = await partTime.from('payroll_items').select('id').limit(5);
  check('アルバイトは他人の給与明細を閲覧できない', (ptItems ?? []).length === 0);

  // ============================================================
  section('12. 各モジュールのCRUD永続化');
  // ============================================================
  // 顧客
  const { data: [newCust], error: eC1 } = await mgr.from('customers').insert({
    organization_id: org.id, primary_store_id: shibuya.id,
    name: '検証 花子', phone: '09088887777',
  }).select();
  check('顧客: 登録できる', !eC1 && !!newCust, eC1?.message);
  await mgr.from('customers').update({ preference_note: '辛いもの好き' }).eq('id', newCust.id);
  const { data: [custReload] } = await mgr.from('customers').select('preference_note').eq('id', newCust.id);
  check('顧客: 編集が永続化される（再読込相当）', custReload?.preference_note === '辛いもの好き');

  // 小口現金（店長登録 → 経理承認）
  const { data: [acct] } = await mgr.from('expense_accounts')
    .select('*').eq('organization_id', org.id).eq('code', '521').limit(1);
  const { data: [petty], error: eP1 } = await mgr.from('cash_transactions').insert({
    organization_id: org.id, store_id: shibuya.id, kind: 'petty_out', amount: 1200,
    purpose: '検証: 洗剤購入', expense_account_id: acct?.id ?? null, approval_status: 'pending',
  }).select();
  check('小口現金: 出金を登録できる', !eP1 && !!petty, eP1?.message);
  const { error: eP2 } = await keiri.from('cash_transactions')
    .update({ approval_status: 'approved', approved_by: uid('keiri@demo.tenpo.one'), approved_at: new Date().toISOString() })
    .eq('id', petty.id);
  const { data: [pettyAfter] } = await keiri.from('cash_transactions').select('approval_status').eq('id', petty.id);
  check('小口現金: 経理が承認できる', !eP2 && pettyAfter?.approval_status === 'approved');

  // 経費
  const { data: [expense], error: eE1 } = await mgr.from('expenses').insert({
    organization_id: org.id, store_id: shibuya.id, expense_account_id: acct?.id ?? null,
    amount: 3300, tax_amount: 300, paid_via: 'petty_cash', vendor_name: '検証商店', memo: '検証データ',
  }).select();
  check('経費: 登録できる', !eE1 && !!expense, eE1?.message);

  // 請求書（経理）
  const { data: [invoice], error: eI1 } = await keiri.from('invoices').insert({
    organization_id: org.id, store_id: shibuya.id, vendor_name: '検証仕入株式会社',
    invoice_no: `VERIFY-${Date.now()}`, amount: 55000, tax_amount: 5000,
    due_date: new Date(Date.now() + 14 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
    status: 'open',
  }).select();
  check('請求書: 登録できる', !eI1 && !!invoice, eI1?.message);
  await keiri.from('invoices').update({ status: 'review' }).eq('id', invoice.id);
  await keiri.from('invoices').update({ status: 'approved', approved_by: uid('keiri@demo.tenpo.one') }).eq('id', invoice.id);
  const { data: [invAfter] } = await keiri.from('invoices').select('status').eq('id', invoice.id);
  check('請求書: 状態遷移（未処理→確認→承認）が保存される', invAfter?.status === 'approved');

  // 仕入先
  const { data: [vendor], error: eV1 } = await mgr.from('vendors').insert({
    organization_id: org.id, name: '検証青果株式会社', phone: '03-0000-0000', closing_day: 31, payment_day: 25,
  }).select();
  check('仕入先: 登録できる', !eV1 && !!vendor, eV1?.message);

  // 発注 → 入荷 → 在庫加算
  const { data: riceItem } = await mgr.from('inventory_items')
    .select('*').eq('store_id', shibuya.id).eq('name', '米 10kg').single();
  const { data: [po], error: ePO1 } = await mgr.from('purchase_orders').insert({
    organization_id: org.id, store_id: shibuya.id, vendor_id: vendor.id, status: 'draft', total: 8400,
  }).select();
  check('発注: 発注書を作成できる', !ePO1 && !!po, ePO1?.message);
  await mgr.from('purchase_order_items').insert({
    organization_id: org.id, purchase_order_id: po.id, inventory_item_id: riceItem.id,
    name: riceItem.name, quantity: 2, unit: '袋', unit_cost: 4200,
  });
  await mgr.from('purchase_orders').update({ status: 'approved', approved_by: uid('shibuya@demo.tenpo.one') }).eq('id', po.id);
  await mgr.from('purchase_orders').update({ status: 'ordered', ordered_at: new Date().toISOString() }).eq('id', po.id);
  // 入荷
  const riceBefore = Number(riceItem.current_quantity);
  await mgr.from('stock_movements').insert({
    organization_id: org.id, store_id: shibuya.id, inventory_item_id: riceItem.id,
    movement_type: 'in', quantity: 2, unit_cost: 4200, ref_purchase_order_id: po.id,
  });
  await mgr.from('inventory_items').update({ current_quantity: riceBefore + 2 }).eq('id', riceItem.id);
  await mgr.from('purchase_orders').update({ status: 'received' }).eq('id', po.id);
  const { data: riceAfter } = await mgr.from('inventory_items').select('current_quantity').eq('id', riceItem.id).single();
  check('発注: 入荷で在庫が加算される', Number(riceAfter.current_quantity) === riceBefore + 2);

  // 在庫: 廃棄
  await mgr.from('stock_movements').insert({
    organization_id: org.id, store_id: shibuya.id, inventory_item_id: riceItem.id,
    movement_type: 'waste', quantity: -1, reason: '検証: 破損',
  });
  await mgr.from('inventory_items').update({ current_quantity: riceBefore + 1 }).eq('id', riceItem.id);
  const { data: riceAfter2 } = await mgr.from('inventory_items').select('current_quantity').eq('id', riceItem.id).single();
  check('在庫: 廃棄で減算される', Number(riceAfter2.current_quantity) === riceBefore + 1);

  // 勤怠打刻（本人）
  const { data: punchIn, error: ePu1 } = await staff1.rpc('apply_punch', {
    p_store_id: shibuya.id, p_profile_id: staff1Id, p_event_type: 'clock_in', p_source: 'personal',
  });
  check('勤怠: 出勤打刻できる', !ePu1 && punchIn?.ok, ePu1?.message);
  const { data: punchOut, error: ePu2 } = await staff1.rpc('apply_punch', {
    p_store_id: shibuya.id, p_profile_id: staff1Id, p_event_type: 'clock_out', p_source: 'personal',
  });
  check('勤怠: 退勤打刻できる', !ePu2 && punchOut?.ok, ePu2?.message);
  const { data: [entry] } = await staff1.from('time_entries')
    .select('*').eq('profile_id', staff1Id).eq('work_date', todayJst())
    .order('created_at', { ascending: false }).limit(1);
  check('勤怠: 打刻がDBへ保存される（出退勤揃い）', !!entry?.clock_in_at && !!entry?.clock_out_at);

  // シフト（店長）
  const { data: [shift], error: eS1 } = await mgr.from('shifts').insert({
    organization_id: org.id, store_id: shibuya.id, profile_id: staff1Id,
    shift_date: new Date(Date.now() + 7 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
    start_time: '11:00', end_time: '19:00', kind: 'confirmed', status: 'published',
  }).select();
  check('シフト: 作成・公開できる', !eS1 && !!shift, eS1?.message);

  // 給与ルール（本社）
  const { data: hqRules } = await hq.from('payroll_rules').select('*').eq('profile_id', staff1Id);
  check('給与: スタッフの給与ルールを参照できる', (hqRules ?? []).length >= 1);

  // 検証用CRUDデータのクリーンアップ（会計済み取引は残す）
  await admin.from('shifts').delete().eq('id', shift.id);
  await admin.from('purchase_order_items').delete().eq('purchase_order_id', po.id);
  await admin.from('stock_movements').delete().eq('ref_purchase_order_id', po.id);
  await admin.from('purchase_orders').delete().eq('id', po.id);
  await admin.from('vendors').delete().eq('id', vendor.id);
  await admin.from('invoices').delete().eq('id', invoice.id);
  await admin.from('expenses').delete().eq('id', expense.id);
  await admin.from('customers').delete().eq('id', newCust.id);

  // ============================================================
  console.log('\n=== 検証結果 ===');
  console.log(`成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) {
    console.log('\n失敗項目:');
    failures.forEach((f) => console.log(' -', f));
    process.exit(1);
  }
}

main().catch((e) => { console.error('\n検証中断:', e.message); process.exit(1); });
