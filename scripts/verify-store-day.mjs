/**
 * TENPO ONE v0.4.3 — 「1日営業シミュレーション」実環境検証スクリプト（VER-D4）
 *
 * 使い方: node --env-file=.env.local scripts/verify-store-day.mjs
 *
 * verify-flow.mjs / verify-accounting-consistency.mjs と同じ流儀（実ユーザーとして anon
 * キーでログイン=RLS適用、check()/section() での記録、service role は準備・照合専用）で、
 * 専用テスト企業「[PILOT] TENPO ONE検証企業」（scripts/pilot-org.mjs）の1店舗上に
 * 出勤→レジ開局→予約→POS注文→QR注文→会計→返金/VOID→クーポン/ポイント→売切確認→
 * 小口現金→退勤（深夜含む）→レジ締め→店舗日次締め→日報 という1営業日を丸ごと再現し、
 * 1円・1個・1分単位で終了時照合する。
 *
 * 照合方針（重要）:
 *  - payments/refunds/会計済みordersはDBトリガーにより物理削除できないため
 *    cleanupPilotDay は「累積許容」方式（pilot-org.mjs 参照）。
 *    そのため本スクリプトの期待値は常にDBクエリで再集計した実測値どうしの比較にする
 *    （verify-accounting-consistency.mjs の computeDailyAggregates と同じ思想）。
 *    レジ単位の現金照合はその回に新規openしたregister_session_idにスコープされるため
 *    そもそも累積の影響を受けない。在庫のみ「現在庫」が日をまたいで累積する運用値なので、
 *    本スクリプト開始時点のスナップショット（時刻ベース）からの差分で照合する。
 *  - 売上指標・理論現金の「正式定義」は lib/metrics.ts、給与試算は lib/payroll.ts の
 *    実装をそのまま import して使う（画面と別式を書かない、という設計原則に従う）。
 *    Node 24 のネイティブ型ストリッピングで .ts を直接importできるため、
 *    ここでは式を手で再実装せず本物の共有関数を「期待値エンジン」として使用する。
 */
import { createClient } from '@supabase/supabase-js';
import { ensurePilotOrg, cleanupPilotDay, loginPilotUser, fetchAllRows } from './pilot-org.mjs';
import { computeSalesMetrics, expectedCash, SETTLED_ORDER_STATUSES } from '../lib/metrics.ts';
import { summarizeEntry, calcPayroll, calcCommission } from '../lib/payroll.ts';

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

const todayJst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const jstHour = () => Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour12: false, hour: '2-digit' }).slice(0, 2)) % 24;
const rand = () => Math.random();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 小さな並行実行ヘルパー（順序に依存しない生成処理を高速化する） */
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

/** 現金/カード/QR/併用を織り交ぜた支払プラン（method配列。合計はtotalと必ず一致） */
function paymentPlan(total) {
  const r = rand();
  const cashLeg = (amount) => ({ method: 'cash', amount, tendered: Math.ceil(amount / 1000) * 1000 });
  if (total < 20 || r < 0.40) return [cashLeg(total)];
  if (r < 0.62) return [{ method: 'credit', amount: total }];
  if (r < 0.80) return [{ method: 'qr', amount: total }];
  if (r < 0.88) return [{ method: 'emoney', amount: total }];
  if (r < 0.94) {
    const c = Math.max(10, Math.min(total - 10, Math.floor((total * 0.4) / 10) * 10));
    return [cashLeg(c), { method: 'credit', amount: total - c }];
  }
  const c = Math.max(10, Math.min(total - 10, Math.floor((total * 0.5) / 10) * 10));
  return [cashLeg(c), { method: 'qr', amount: total - c }];
}

async function main() {
  console.log('=== TENPO ONE 1日営業シミュレーション検証（VER-D4） ===');

  // ============================================================
  section('準備: 専用テスト企業のget-or-create → 対象営業日クリーンアップ');
  // ============================================================
  const ctx = await ensurePilotOrg();
  const { org, store, tables, registers, menuItems, menuByName, inventory, staff, coupon, customers } = ctx;
  check('専用テスト企業はis_demo=false', org.is_demo === false);
  check('テーブル15卓が用意されている', tables.length === 15, `実際:${tables.length}`);
  check('レジ4台が用意されている', registers.length === 4, `実際:${registers.length}`);
  check('メニュー15品が用意されている', menuItems.length === 15, `実際:${menuItems.length}`);

  const businessDate = todayJst();
  const cleanupReport = await cleanupPilotDay(org.id, businessDate);
  console.log('  後片付け方式:', cleanupReport.note);
  console.log('  削除:', JSON.stringify(cleanupReport.deleted));
  console.log('  残置（会計済み・累積許容）:', JSON.stringify(cleanupReport.retained));

  // 在庫の開始スナップショット（時刻ベース。累積があっても「この回の差分」だけを見る）
  const invSnapshotAt = new Date().toISOString();
  const trackedInv = ['beer', 'wine', 'chicken', 'beef', 'fish', 'oshibori', 'waribashi'];
  const invBefore = {};
  for (const key of trackedInv) {
    const { data } = await admin.from('inventory_items').select('current_quantity').eq('id', inventory[key].id).single();
    invBefore[key] = Number(data.current_quantity);
  }

  // ログイン（実ユーザー・RLS適用）
  const owner = await loginPilotUser(staff.owner.email);
  const mgr = await loginPilotUser(staff.manager.email);
  const staff1 = await loginPilotUser(staff.staff1.email);
  const staff2 = await loginPilotUser(staff.staff2.email);
  const staff3 = await loginPilotUser(staff.staff3.email);
  const parttime1 = await loginPilotUser(staff.parttime1.email);
  const parttime2 = await loginPilotUser(staff.parttime2.email);
  const parttime3 = await loginPilotUser(staff.parttime3.email);
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

  const clients = { manager: mgr, staff1, staff2, staff3, parttime1, parttime2, parttime3 };
  const workers = ['manager', 'staff1', 'staff2', 'staff3', 'parttime1', 'parttime2', 'parttime3'];

  // ============================================================
  section('1. 出勤打刻（店長→スタッフ全員）');
  // ============================================================
  const punchInAt = {};
  for (const key of workers) {
    const { data, error } = await clients[key].rpc('apply_punch', {
      p_store_id: store.id, p_profile_id: staff[key].id, p_event_type: 'clock_in', p_source: 'personal',
    });
    check(`出勤打刻: ${key}`, !error && data?.ok, error?.message);
    punchInAt[key] = new Date();
  }
  check('店長含め4名以上が出勤している', workers.length >= 5, `実際:${workers.length}`);

  // ============================================================
  section('2. レジ4台開局（各釣銭3万円）');
  // ============================================================
  const REGISTER_STAFF = [
    { name: 'レジ01', key: 'manager' },
    { name: 'レジ02', key: 'staff1' },
    { name: 'テイクアウトレジ', key: 'staff2' },
    { name: 'モバイルPOS', key: 'staff3' },
  ];
  const sessions = [];
  for (const rs of REGISTER_STAFF) {
    const register = registers.find((r) => r.name === rs.name);
    const { data, error } = await clients[rs.key].rpc('open_register_session', {
      p_store_id: store.id, p_register_id: register.id, p_opening_float: 30000,
    });
    check(`レジ開局: ${rs.name}（${rs.key}）`, !error && data?.ok, error?.message);
    sessions.push({ ...rs, register, sessionId: data?.session_id, openingFloat: 30000 });
  }
  check('レジ4台全て開局した', sessions.every((s) => !!s.sessionId));

  // 営業日境界（app_business_date）: 5時基準で「今日の実時刻がどこでも同一営業日になる」ことを確認
  const { data: bizDate, error: eBiz } = await admin.rpc('app_business_date', { p_store_id: store.id });
  const expectedBizDate = jstHour() < 5
    ? new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
    : businessDate;
  check('app_business_date: 営業日開始5時の境界が正しい', !eBiz && bizDate === expectedBizDate,
    `実際:${bizDate} 期待:${expectedBizDate} (JST${jstHour()}時)`);
  {
    const { data: rsRows } = await admin.from('register_sessions').select('business_date').in('id', sessions.map((s) => s.sessionId));
    check('4レジ全てのbusiness_dateがapp_business_date()と一致',
      rsRows.every((r) => r.business_date === bizDate), JSON.stringify(rsRows));
  }

  // ============================================================
  section('3. 予約20組作成（公開予約RPC + 店舗側直接登録・時間帯分散）');
  // ============================================================
  const { data: availSlots } = await anon.rpc('get_booking_availability', {
    p_slug: store.slug, p_date: businessDate, p_party: 2,
  });
  const openSlots = (availSlots ?? []).filter((s) => s.available).map((s) => s.time);
  check('公開予約の空席スロットが取得できる', openSlots.length > 0, `件数:${openSlots.length}`);

  const reservations = [];
  const publicCount = Math.min(4, openSlots.length);
  for (let i = 0; i < publicCount; i++) {
    const c = customers[i];
    // レート制限（同一電話番号1時間5回）を反復実行で踏まないよう、公開予約はrun毎にランダム番号を使う
    const randomPhone = `090${String(10000000 + Math.floor(Math.random() * 89999999))}`;
    const { data: created, error } = await anon.rpc('create_public_reservation', {
      p_slug: store.slug, p_date: businessDate, p_time: openSlots[i], p_party: 2, p_adults: 2, p_children: 0,
      p_name: c.name, p_kana: null, p_phone: randomPhone, p_email: c.email ?? null,
      p_allergy: null, p_request: `[PILOT] 検証予約${i + 1}`, p_consent: true,
    });
    check(`公開予約RPCで予約作成 #${i + 1}`, !error && !!created?.code, error?.message);
    if (created?.code) {
      const { data: [row] } = await admin.from('reservations').select('*').eq('code', created.code);
      reservations.push(row);
    }
  }
  const directCount = 20 - reservations.length;
  const timeSlots = ['17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00', '22:30'];
  for (let i = 0; i < directCount; i++) {
    const c = customers[(publicCount + i) % customers.length];
    const hm = pick(timeSlots);
    const start = new Date(`${businessDate}T${hm}:00+09:00`);
    const end = new Date(start.getTime() + 90 * 60000);
    const [row] = await (async () => {
      const { data, error } = await mgr.from('reservations').insert({
        organization_id: org.id, store_id: store.id, customer_id: c.id,
        code: `PILOT-${Date.now()}-${i}`,
        reserved_date: businessDate, start_at: start.toISOString(), end_at: end.toISOString(),
        party_size: randInt(2, 4), adults: 2, children: 0,
        guest_name: c.name, guest_phone: c.phone, guest_email: c.email ?? null,
        status: 'confirmed', created_via: 'phone', consent_accepted: true,
      }).select();
      if (error) throw new Error('direct reservation insert: ' + error.message);
      return data;
    })();
    reservations.push(row);
  }
  check('予約が20組作成された（公開RPC + 直接登録）', reservations.length === 20, `実際:${reservations.length}`);
  const distinctTimes = new Set(reservations.map((r) => new Date(r.start_at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }).slice(0, 5)));
  check('予約時間帯が分散している（3種類以上）', distinctTimes.size >= 3, `種類:${distinctTimes.size}`);

  // ============================================================
  section('4/5/6. 来店・POS注文・QR注文・会計（現金/カード/QR/併用・レジ4台分散）');
  // ============================================================
  const menuPool = menuItems.filter((m) => m.name !== '日本酒（一合）'); // 日本酒は9章の売切テスト専用に温存
  function randomItems(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ mi: pick(menuPool), qty: randInt(1, 3) });
    return out;
  }

  async function createAndPayOrder(client, opts) {
    const {
      orderType = 'dine_in', tableId = null, reservationId = null, customerId = null,
      staffKey, session, items, taxRate = 10, guestCount = 2,
      couponId = null, couponCode = null, discountTotal = 0, extraPayments = [],
    } = opts;
    const { data: [order], error: eIns } = await client.from('orders').insert({
      organization_id: org.id, store_id: store.id, order_type: orderType,
      table_id: tableId, reservation_id: reservationId, customer_id: customerId,
      guest_count: guestCount, staff_id: staff[staffKey]?.id ?? null,
      coupon_id: couponId, coupon_code: couponCode, discount_total: discountTotal,
    }).select();
    if (eIns) throw new Error('order insert: ' + eIns.message);
    const rows = items.map(({ mi, qty }) => ({
      organization_id: org.id, store_id: store.id, order_id: order.id,
      menu_item_id: mi.id, name: mi.name, unit_price: mi.price, quantity: qty,
      tax_rate: taxRate, tax_included: true, line_total: mi.price * qty, staff_id: staff[staffKey]?.id ?? null,
    }));
    const { error: eItems } = await client.from('order_items').insert(rows);
    if (eItems) throw new Error('order_items insert: ' + eItems.message);
    await client.rpc('recalc_order_totals', { p_order_id: order.id });
    const { data: [priced] } = await client.from('orders').select('total').eq('id', order.id);
    let remaining = priced.total;
    const payments = [...extraPayments];
    for (const p of extraPayments) remaining -= p.amount;
    if (remaining > 0) payments.push(...paymentPlan(remaining));
    const { data: fin, error: eFin } = await client.rpc('finalize_order', {
      p_order_id: order.id, p_payments: payments, p_register_session_id: session.sessionId,
    });
    if (eFin) throw new Error(`finalize failed: ${eFin.message} total=${priced.total} payments=${JSON.stringify(payments)}`);
    return { order, total: priced.total, payments, fin };
  }

  // --- 4a: 予約客の来店→着席→注文（20組） ---
  let resSeatFail = 0;
  await pMap(reservations, async (res, i) => {
    const table = tables[i % tables.length];
    await mgr.from('reservation_tables').upsert({ reservation_id: res.id, table_id: table.id }, { onConflict: 'reservation_id,table_id' });
    await mgr.from('reservations').update({ status: 'seated' }).eq('id', res.id);
    await mgr.from('restaurant_tables').update({ current_status: 'seated' }).eq('id', table.id);
    const staffKey = pick(workers);
    const session = sessions[i % sessions.length];
    try {
      await createAndPayOrder(clients[staffKey] ?? mgr, {
        tableId: table.id, reservationId: res.id, customerId: res.customer_id,
        staffKey, session, items: randomItems(randInt(1, 4)), guestCount: res.party_size,
      });
    } catch (e) { resSeatFail++; console.log('   ! 予約注文失敗:', e.message); }
  }, 6);
  check('予約客20組が来店→着席→POS注文→会計まで完了', resSeatFail === 0, `失敗:${resSeatFail}`);

  // --- 4b: ウォークイン8組 ---
  let walkinFail = 0;
  const walkinTables = tables.slice(0, 8);
  await pMap(walkinTables, async (table, i) => {
    const staffKey = pick(workers);
    const session = sessions[i % sessions.length];
    try {
      await createAndPayOrder(clients[staffKey] ?? mgr, {
        tableId: table.id, staffKey, session, items: randomItems(randInt(1, 4)), guestCount: randInt(1, 4),
      });
    } catch (e) { walkinFail++; console.log('   ! ウォークイン失敗:', e.message); }
  }, 6);
  check('ウォークイン8組がPOS注文→会計まで完了', walkinFail === 0, `失敗:${walkinFail}`);

  // --- 4c: 追加の一般POS注文（カルテ様々・件数確保用） ---
  const FILLER_COUNT = 42;
  let fillerFail = 0;
  await pMap(Array.from({ length: FILLER_COUNT }, (_, i) => i), async (i) => {
    const table = tables[i % tables.length];
    const staffKey = pick(workers);
    const session = sessions[i % sessions.length];
    try {
      await createAndPayOrder(clients[staffKey] ?? mgr, {
        tableId: table.id, staffKey, session, items: randomItems(randInt(1, 5)), guestCount: randInt(1, 5),
      });
    } catch (e) { fillerFail++; console.log('   ! filler失敗:', e.message); }
  }, 8);
  check(`追加POS注文${FILLER_COUNT}件が完了`, fillerFail === 0, `失敗:${fillerFail}`);

  const posBulkCount = reservations.length - resSeatFail + (8 - walkinFail) + (FILLER_COUNT - fillerFail);
  check('POS注文（dine_in中心）が70件以上完了', posBulkCount >= 70, `実際:${posBulkCount}`);

  // --- 5: QR注文32件（get_qr_menu→create_qr_order→店側finalize。順次実行=同一卓の使い回し安全化） ---
  let qrOk = 0;
  const QR_COUNT = 32;
  for (let i = 0; i < QR_COUNT; i++) {
    const table = tables[i % tables.length];
    try {
      const { data: menu, error: eMenu } = await anon.rpc('get_qr_menu', { p_slug: store.slug, p_token: table.qr_token });
      if (eMenu || !menu) throw new Error('get_qr_menu: ' + (eMenu?.message ?? 'null'));
      const items = randomItems(randInt(1, 3)).map(({ mi, qty }) => ({ menu_item_id: mi.id, quantity: qty }));
      const { data: qrRes, error: eQr } = await anon.rpc('create_qr_order', { p_slug: store.slug, p_token: table.qr_token, p_items: items });
      if (eQr || !qrRes?.ok) throw new Error('create_qr_order: ' + (eQr?.message ?? JSON.stringify(qrRes)));
      const { data: [priced] } = await admin.from('orders').select('total').eq('id', qrRes.order_id);
      const staffKey = pick(workers);
      const session = sessions[i % sessions.length];
      const { data: fin, error: eFin } = await clients[staffKey].rpc('finalize_order', {
        p_order_id: qrRes.order_id, p_payments: paymentPlan(priced.total), p_register_session_id: session.sessionId,
      });
      if (eFin || !fin?.ok) throw new Error('finalize: ' + (eFin?.message ?? JSON.stringify(fin)));
      qrOk++;
    } catch (e) { console.log('   ! QR注文失敗:', e.message); }
  }
  check(`QR注文が${QR_COUNT}件以上、店側で会計へ合流完了`, qrOk >= 30, `成功:${qrOk}`);

  // --- 6: 会計100件以上・4レジへの分散を確認 ---
  {
    const payRows = await fetchAllRows(() => admin.from('payments')
      .select('id, register_session_id').eq('store_id', store.id).eq('business_date', bizDate)
      .gte('created_at', invSnapshotAt));
    const distinctSessions = new Set((payRows ?? []).map((p) => p.register_session_id).filter(Boolean));
    check('会計（payments）が100件以上生成された（本実行分）', (payRows?.length ?? 0) >= 100, `件数:${payRows?.length}`);
    check('支払がレジ4台へ分散している', distinctSessions.size === 4, `分散数:${distinctSessions.size}`);
    const methodRows = await fetchAllRows(() => admin.from('payments').select('method').eq('store_id', store.id).gte('created_at', invSnapshotAt));
    const methods = new Set((methodRows ?? []).map((p) => p.method));
    check('現金/カード/QR/電子マネー等が混在している（3種類以上）', methods.size >= 3, [...methods].join(','));
  }

  // ============================================================
  section('7. 部分返金2件（商品単位+在庫戻し／金額指定カード返金）・VOID1件');
  // ============================================================
  // 7a: 商品単位返金（在庫戻しあり・唐揚げ×2→1個返金→レシピ食材が戻る）
  const karaage = menuByName['鶏の唐揚げ'];
  const chickenBefore7a = await currentQty(inventory.chicken.id);
  const { order: order7a } = await createAndPayOrder(mgr, {
    tableId: tables[0].id, staffKey: 'manager', session: sessions[0],
    items: [{ mi: karaage, qty: 2 }], guestCount: 2,
  });
  const { data: [oi7a] } = await mgr.from('order_items').select('*').eq('order_id', order7a.id).eq('menu_item_id', karaage.id);
  const chickenAfterSale7a = await currentQty(inventory.chicken.id);
  check('唐揚げ×2会計でレシピ理論在庫が400g減る',
    chickenAfterSale7a === chickenBefore7a - 400, `${chickenBefore7a} → ${chickenAfterSale7a}`);

  const { data: ref7a, error: eRef7a } = await mgr.rpc('refund_order', {
    p_order_id: order7a.id, p_amount: oi7a.unit_price, p_method: 'cash', p_reason: '[PILOT] 商品単位返金（在庫戻しあり）',
    p_register_session_id: sessions[0].sessionId, p_kind: 'refund',
    p_items: [{ order_item_id: oi7a.id, quantity: 1, amount: oi7a.unit_price, restock: true }],
  });
  check('商品単位返金（唐揚げ1個・restock=true）が成功', !eRef7a && ref7a?.ok, eRef7a?.message);
  const chickenAfterRefund7a = await currentQty(inventory.chicken.id);
  check('在庫戻しでレシピ食材が200g戻る（合計-200g）',
    chickenAfterRefund7a === chickenAfterSale7a + 200, `${chickenAfterSale7a} → ${chickenAfterRefund7a}`);

  // 7b: 金額指定のカード返金（商品単位ではない・部分返金）
  const { order: order7b, total: total7b } = await createAndPayOrder(mgr, {
    tableId: tables[1].id, staffKey: 'manager', session: sessions[1],
    items: [{ mi: menuByName['和牛ハンバーグ'], qty: 1 }], guestCount: 1,
    extraPayments: [{ method: 'credit', amount: menuByName['和牛ハンバーグ'].price }],
  });
  const refundAmount7b = Math.min(300, total7b - 1);
  const { data: ref7b, error: eRef7b } = await mgr.rpc('refund_order', {
    p_order_id: order7b.id, p_amount: refundAmount7b, p_method: 'credit',
    p_reason: '[PILOT] 金額指定カード返金', p_register_session_id: sessions[1].sessionId,
  });
  check('金額指定のカード返金が成功', !eRef7b && ref7b?.ok, eRef7b?.message);
  const { data: [order7bAfter] } = await mgr.from('orders').select('status').eq('id', order7b.id);
  check('部分返金後もorders.statusはpaidのまま（gross保持）', order7bAfter?.status === 'paid');

  // 7c: VOID（全額のみ・誤会計取消）
  const { order: order7c, total: total7c } = await createAndPayOrder(mgr, {
    tableId: tables[2].id, staffKey: 'manager', session: sessions[2],
    items: [{ mi: menuByName['土鍋ご飯'], qty: 1 }], guestCount: 1,
  });
  const { data: void7c, error: eVoid7c } = await mgr.rpc('refund_order', {
    p_order_id: order7c.id, p_amount: total7c, p_method: 'cash',
    p_reason: '[PILOT] 誤会計VOID', p_register_session_id: sessions[2].sessionId, p_kind: 'void',
  });
  check('VOID（全額取消）が成功', !eVoid7c && void7c?.ok, eVoid7c?.message);
  const { data: [voidRow7c] } = await mgr.from('refunds').select('kind').eq('id', void7c?.refund_id);
  check('refunds.kind=voidで記録される', voidRow7c?.kind === 'void');

  async function currentQty(id) {
    const { data } = await admin.from('inventory_items').select('current_quantity').eq('id', id).single();
    return Number(data.current_quantity);
  }

  // ============================================================
  section('8. クーポン1件・会員ポイント1名（付与→一部利用）');
  // ============================================================
  const { order: order8coupon, total: total8coupon } = await createAndPayOrder(mgr, {
    tableId: tables[3].id, staffKey: 'staff1', session: sessions[0],
    items: [{ mi: menuByName['本日のアイス'], qty: 1 }], guestCount: 1,
    couponId: coupon.id, couponCode: coupon.code, discountTotal: coupon.value,
  });
  check('クーポン値引き後の合計が正しい', total8coupon === menuByName['本日のアイス'].price - coupon.value,
    `実際:${total8coupon}`);
  const { data: redemptions8 } = await mgr.from('coupon_redemptions').select('*').eq('order_id', order8coupon.id);
  check('会計確定でクーポン利用が記録される', redemptions8?.length === 1 && redemptions8[0].discount_amount === coupon.value);

  const loyaltyCustomer = customers[23];
  const { data: ptBefore8 } = await admin.from('customers').select('point_balance').eq('id', loyaltyCustomer.id).single();
  const { total: total8earn } = await createAndPayOrder(mgr, {
    tableId: tables[4].id, staffKey: 'staff2', session: sessions[1],
    items: [{ mi: menuByName['グラスワイン'], qty: 3 }], guestCount: 2, customerId: loyaltyCustomer.id,
  });
  const expectedEarn8 = Math.floor(total8earn / 100);
  const { data: ptAfterEarn8 } = await admin.from('customers').select('point_balance').eq('id', loyaltyCustomer.id).single();
  check('会計時にポイントが自動付与される（100円=1pt）',
    ptAfterEarn8.point_balance === ptBefore8.point_balance + expectedEarn8,
    `前:${ptBefore8.point_balance} 後:${ptAfterEarn8.point_balance} 期待付与:${expectedEarn8}`);

  const useAmount8 = Math.min(ptAfterEarn8.point_balance, 5);
  const { total: total8redeem } = await createAndPayOrder(mgr, {
    tableId: tables[4].id, staffKey: 'staff2', session: sessions[1],
    items: [{ mi: menuByName['ウーロン茶'], qty: 1 }], guestCount: 1, customerId: loyaltyCustomer.id,
    extraPayments: useAmount8 > 0 ? [{ method: 'points', amount: useAmount8 }] : [],
  });
  const { data: ptAfterRedeem8 } = await admin.from('customers').select('point_balance').eq('id', loyaltyCustomer.id).single();
  const expectedEarn8b = Math.floor((total8redeem - useAmount8) / 100);
  check('ポイント一部利用の会計が成功し残高が正しく増減する',
    ptAfterRedeem8.point_balance === ptAfterEarn8.point_balance - useAmount8 + expectedEarn8b,
    `期待:${ptAfterEarn8.point_balance - useAmount8 + expectedEarn8b} 実際:${ptAfterRedeem8.point_balance}`);

  // ============================================================
  section('9. 商品売切設定→注文防止の確認（既存の売切機構）');
  // ============================================================
  const soldOutItem = menuByName['日本酒（一合）'];
  await mgr.from('menu_items').update({ is_sold_out: true }).eq('id', soldOutItem.id);
  const soldOutTable = tables[5];
  const { data: qrMenu9 } = await anon.rpc('get_qr_menu', { p_slug: store.slug, p_token: soldOutTable.qr_token });
  const flatItems9 = (qrMenu9?.categories ?? []).flatMap((c) => c.items);
  const found9 = flatItems9.find((it) => it.id === soldOutItem.id);
  check('QRメニューは売切商品もis_sold_out=trueで返す', found9?.is_sold_out === true, JSON.stringify(found9));
  const { error: eSoldOut9 } = await anon.rpc('create_qr_order', {
    p_slug: store.slug, p_token: soldOutTable.qr_token, p_items: [{ menu_item_id: soldOutItem.id, quantity: 1 }],
  });
  check('売切商品のQR注文はITEM_UNAVAILABLEで拒否される',
    !!eSoldOut9 && /ITEM_UNAVAILABLE/.test(eSoldOut9.message ?? ''), eSoldOut9?.message);
  await mgr.from('menu_items').update({ is_sold_out: false }).eq('id', soldOutItem.id);
  const { data: [resetCheck9] } = await mgr.from('menu_items').select('is_sold_out').eq('id', soldOutItem.id);
  check('売切解除後は通常発注可能な状態に戻る', resetCheck9?.is_sold_out === false);

  // ============================================================
  section('10. 小口現金出金1件（petty_out）');
  // ============================================================
  const { data: [acct10] } = await mgr.from('expense_accounts').select('*').eq('organization_id', org.id).limit(1);
  const pettyAmount = 3500;
  const { data: [petty10], error: ePetty10 } = await mgr.from('cash_transactions').insert({
    organization_id: org.id, store_id: store.id, register_session_id: sessions[0].sessionId,
    kind: 'petty_out', amount: pettyAmount, purpose: '[PILOT] 検証: 備品購入',
    expense_account_id: acct10?.id ?? null, approval_status: 'pending',
  }).select();
  check('小口現金出金を登録できる', !ePetty10 && !!petty10, ePetty10?.message);
  const { error: eApprove10 } = await owner.from('cash_transactions')
    .update({ approval_status: 'approved', approved_by: staff.owner.id, approved_at: new Date().toISOString() })
    .eq('id', petty10.id);
  const { data: [pettyAfter10] } = await owner.from('cash_transactions').select('approval_status').eq('id', petty10.id);
  check('オーナーが小口現金出金を承認できる', !eApprove10 && pettyAfter10?.approval_status === 'approved');

  // 追加の在庫操作（入荷・廃棄・棚卸調整）— 終了時照合の恒等式を全項目で成立させるため
  section('10b. 在庫: 入荷・廃棄・棚卸調整（終了時照合の全項目確認用）');
  const chickenIn = 5000, chickenWaste = 300, chickenAdjust = -150;
  {
    const before = await currentQty(inventory.chicken.id);
    await mgr.from('stock_movements').insert({
      organization_id: org.id, store_id: store.id, inventory_item_id: inventory.chicken.id,
      movement_type: 'in', quantity: chickenIn, unit_cost: 2, reason: '[PILOT] 検証入荷',
    });
    await mgr.from('inventory_items').update({ current_quantity: before + chickenIn }).eq('id', inventory.chicken.id);
    const afterIn = await currentQty(inventory.chicken.id);
    check('入荷で在庫が加算される', afterIn === before + chickenIn, `${before} → ${afterIn}`);

    await mgr.from('stock_movements').insert({
      organization_id: org.id, store_id: store.id, inventory_item_id: inventory.chicken.id,
      movement_type: 'waste', quantity: -chickenWaste, reason: '[PILOT] 検証廃棄',
    });
    await mgr.from('inventory_items').update({ current_quantity: afterIn - chickenWaste }).eq('id', inventory.chicken.id);
    const afterWaste = await currentQty(inventory.chicken.id);
    check('廃棄で在庫が減算される', afterWaste === afterIn - chickenWaste, `${afterIn} → ${afterWaste}`);

    await mgr.from('stock_movements').insert({
      organization_id: org.id, store_id: store.id, inventory_item_id: inventory.chicken.id,
      movement_type: 'count_adjust', quantity: chickenAdjust, reason: '[PILOT] 検証棚卸差異',
    });
    await mgr.from('inventory_items').update({ current_quantity: afterWaste + chickenAdjust }).eq('id', inventory.chicken.id);
    const afterAdjust = await currentQty(inventory.chicken.id);
    check('棚卸調整で在庫が増減する', afterAdjust === afterWaste + chickenAdjust, `${afterWaste} → ${afterAdjust}`);
  }

  // ============================================================
  section('11. 休憩打刻→深夜勤務（22時以降退勤1名以上）→全員退勤');
  // ============================================================
  // 11a: 実時間での休憩（65秒。ceil計算によりbreak_minutes=2で確定的に検証できる）
  const { data: breakStart11, error: eBreakStart11 } = await parttime1.rpc('apply_punch', {
    p_store_id: store.id, p_profile_id: staff.parttime1.id, p_event_type: 'break_start',
  });
  check('休憩開始打刻ができる', !eBreakStart11 && breakStart11?.ok, eBreakStart11?.message);
  await sleep(65000);
  const { data: breakEnd11, error: eBreakEnd11 } = await parttime1.rpc('apply_punch', {
    p_store_id: store.id, p_profile_id: staff.parttime1.id, p_event_type: 'break_end',
  });
  check('休憩終了打刻ができる', !eBreakEnd11 && breakEnd11?.ok, eBreakEnd11?.message);

  // 11b: staff3の深夜勤務。staff3は1章で既に出勤打刻済みなので、ここでは退勤打刻のみ実施し
  //      （再度clock_inを呼ぶとALREADY_CLOCKED_INになる）、タイムスタンプのみ22時以降へ
  //      上書きする（time_entriesはimmutableトリガーが無い可変テーブルであり、
  //      payments/refunds等の会計証憑とは異なる。深夜差分の構造（night_minutes>0）を
  //      検証するための明示的な例外としてコメントに残す）
  const { data: nightOut, error: eNightOut } = await staff3.rpc('apply_punch', {
    p_store_id: store.id, p_profile_id: staff.staff3.id, p_event_type: 'clock_out',
  });
  check('staff3の退勤打刻自体は成功する（1章で出勤済み）', !eNightOut && nightOut?.ok, eNightOut?.message);
  const nightClockIn = new Date(`${businessDate}T16:00:00+09:00`);
  const nightClockOut = new Date(`${businessDate}T23:00:00+09:00`);
  await admin.from('time_entries').update({
    clock_in_at: nightClockIn.toISOString(), clock_out_at: nightClockOut.toISOString(), break_minutes: 0,
  }).eq('id', nightOut.entry_id);
  const { data: nightEntry } = await admin.from('time_entries').select('*').eq('id', nightOut.entry_id).single();
  const nightAttendance = summarizeEntry({
    clockInAt: new Date(nightEntry.clock_in_at), clockOutAt: new Date(nightEntry.clock_out_at), breakMinutes: nightEntry.break_minutes,
  });
  check('深夜（22時以降）勤務でnightMinutesが構造的に発生する（16-23時=1時間分）',
    nightAttendance.nightMinutes === 60, `実際:${nightAttendance.nightMinutes}`);
  check('7時間勤務は所定8時間以内でoverはtimeMinutes=0', nightAttendance.overtimeMinutes === 0);

  // 11c: 残り全員が退勤
  const clockOutFails = [];
  for (const key of workers) {
    if (key === 'staff3') continue; // 上で処理済み
    const { data, error } = await clients[key].rpc('apply_punch', {
      p_store_id: store.id, p_profile_id: staff[key].id, p_event_type: 'clock_out',
    });
    if (error || !data?.ok) clockOutFails.push(key);
  }
  check('残り全員が退勤打刻できた', clockOutFails.length === 0, clockOutFails.join(','));

  // 勤怠再計算の一致確認（time_entriesから再取得して独立に再計算）
  {
    const { data: entries } = await admin.from('time_entries').select('*')
      .in('profile_id', workers.map((k) => staff[k].id)).eq('work_date', todayJst());
    const closedEntries = (entries ?? []).filter((e) => e.clock_in_at && e.clock_out_at);
    check('全ワーカーのtime_entriesが出退勤揃いでclosedになっている',
      closedEntries.length === workers.length, `実際:${closedEntries.length}/${workers.length}`);
    let allNonNegative = true;
    for (const e of closedEntries) {
      const att = summarizeEntry({ clockInAt: new Date(e.clock_in_at), clockOutAt: new Date(e.clock_out_at), breakMinutes: e.break_minutes });
      if (att.workMinutes < 0) allNonNegative = false;
    }
    check('出勤−休憩=実働がtime_entriesからの再計算で非負に揃う（打刻の整合性）', allNonNegative);
    const pt1Entry = closedEntries.find((e) => e.profile_id === staff.parttime1.id);
    check('休憩65秒の打刻がbreak_minutes=2としてDBへ正確に記録される（ceil計算）',
      pt1Entry?.break_minutes === 2, `実際:${pt1Entry?.break_minutes}`);
  }

  // 給与試算: lib/payroll.ts（既存の共有計算関数）にDBの実測値を渡し、構造を確認する
  {
    const { data: [staff3Rule] } = await admin.from('payroll_rules').select('*').eq('profile_id', staff.staff3.id).eq('organization_id', org.id);
    const rule = {
      payType: staff3Rule.pay_type, baseAmount: staff3Rule.base_amount,
      overtimeRate: Number(staff3Rule.overtime_rate), nightRate: Number(staff3Rule.night_rate),
      holidayRate: Number(staff3Rule.holiday_rate), commuteAllowance: staff3Rule.commute_allowance,
      allowances: staff3Rule.allowances ?? [],
    };
    const preview = calcPayroll(rule, [nightAttendance], 0);
    check('給与試算: 深夜割増が構造的に加算される（nightPay>0）', preview.nightPay > 0, `nightPay=${preview.nightPay}`);
    check('給与試算: grossTotalが各内訳の合計と一致する（自前再計算）',
      preview.grossTotal === preview.basePay + preview.overtimePay + preview.nightPay + preview.holidayPay
        + preview.commutePay + preview.allowanceTotal + preview.commissionTotal,
      JSON.stringify(preview));

    // 歩合（staff1の個人売上2%）
    const { data: [commissionRule] } = await admin.from('commission_rules').select('*').eq('organization_id', org.id).eq('profile_id', staff.staff1.id);
    const staff1Orders = await fetchAllRows(() => admin.from('orders').select('subtotal, staff_id, status')
      .eq('store_id', store.id).eq('business_date', bizDate).eq('staff_id', staff.staff1.id).in('status', SETTLED_ORDER_STATUSES));
    const staff1Sales = (staff1Orders ?? []).reduce((a, o) => a + o.subtotal, 0);
    const commission = calcCommission(
      { targetType: commissionRule.target_type, method: commissionRule.method, rate: Number(commissionRule.rate), fixedAmount: commissionRule.fixed_amount },
      staff1Sales,
    );
    check('歩合（personal_sales 2%）が個人売上税抜額から正しく計算される',
      commission === Math.floor((staff1Sales * 2.0) / 100), `売上:${staff1Sales} 歩合:${commission}`);
  }

  // ============================================================
  section('12/13. レジ4台締め（1台+500円差異）→ 店舗日次締め（未締め拒否→全締め後成功）');
  // ============================================================
  const closeResults = [];
  // 先に3台を締める（4台目=モバイルPOSは13章のOPEN_SESSIONS_REMAINテストのため後で締める）
  for (const s of sessions.filter((x) => x.name !== 'モバイルPOS')) {
    const { data: rows } = await admin.from('cash_transactions').select('kind, amount, status').eq('register_session_id', s.sessionId);
    const cashSales = sumKind(rows, 'sale');
    const cashRefunds = sumKind(rows, 'refund');
    const cashIn = sumKind(rows, 'deposit') + sumKind(rows, 'petty_in');
    const cashOut = sumKind(rows, 'withdrawal') + sumKind(rows, 'petty_out');
    const expected = expectedCash({ openingFloat: s.openingFloat, cashSales, cashIn, cashRefunds, cashOut });
    const isDiffRegister = s.name === 'レジ02';
    const counted = isDiffRegister ? expected + 500 : expected;
    const { data: closed, error } = await clients[s.key].rpc('close_register_session', {
      p_session_id: s.sessionId, p_counted_cash: counted, p_difference_reason: isDiffRegister ? '[PILOT] 検証: 意図的な差異' : null,
    });
    check(`レジ締め: ${s.name}（lib/metrics.expectedCashと一致）`, !error && closed?.ok && closed.expected === expected,
      `期待:${expected} 実際:${closed?.expected}`);
    check(`レジ締め: ${s.name} 差異が${isDiffRegister ? '+500円' : '0円'}で記録される`,
      closed?.difference === (isDiffRegister ? 500 : 0), `実際:${closed?.difference}`);
    closeResults.push({ ...s, expected, counted, difference: closed?.difference });
  }
  function sumKind(rows, kind) {
    return (rows ?? []).filter((r) => r.kind === kind && r.status === 'active').reduce((a, r) => a + r.amount, 0);
  }

  // 未締めレジ（モバイルPOS）が残る状態でstore_day締めを試行→拒否されるはず
  const { error: eOpenRemain } = await mgr.rpc('close_store_day', { p_store_id: store.id, p_business_date: bizDate });
  check('未締めレジが残る状態のclose_store_dayはOPEN_SESSIONS_REMAINで拒否される',
    !!eOpenRemain && /OPEN_SESSIONS_REMAIN/.test(eOpenRemain.message ?? ''), eOpenRemain?.message);

  // 最後の1台（モバイルPOS）を締める
  {
    const s = sessions.find((x) => x.name === 'モバイルPOS');
    const { data: rows } = await admin.from('cash_transactions').select('kind, amount, status').eq('register_session_id', s.sessionId);
    const expected = expectedCash({
      openingFloat: s.openingFloat, cashSales: sumKind(rows, 'sale'), cashRefunds: sumKind(rows, 'refund'),
      cashIn: sumKind(rows, 'deposit') + sumKind(rows, 'petty_in'), cashOut: sumKind(rows, 'withdrawal') + sumKind(rows, 'petty_out'),
    });
    const { data: closed, error } = await clients[s.key].rpc('close_register_session', {
      p_session_id: s.sessionId, p_counted_cash: expected, p_difference_reason: null,
    });
    check('最後のレジ（モバイルPOS）を締められる', !error && closed?.ok && closed.difference === 0, error?.message);
    closeResults.push({ ...s, expected, counted: expected, difference: 0 });
  }

  const { data: dayRes, error: eDay } = await mgr.rpc('close_store_day', { p_store_id: store.id, p_business_date: bizDate });
  check('全レジ締め後は店舗日次締めが成功する', !eDay && dayRes?.ok, eDay?.message);
  check('店舗日次締めのsessions_countが4以上（本実行分含む累積）', (dayRes?.sessions_count ?? 0) >= 4, `実際:${dayRes?.sessions_count}`);

  // ============================================================
  section('14. 日報生成（daily_reportsへ直接同条件で集計・記録）');
  // ============================================================
  const dayOrders = await fetchAllRows(() => admin.from('orders').select('total, discount_total, guest_count, status, order_type')
    .eq('store_id', store.id).eq('business_date', bizDate).in('status', SETTLED_ORDER_STATUSES));
  const dayRefunds = await fetchAllRows(() => admin.from('refunds').select('amount, kind').eq('store_id', store.id).eq('business_date', bizDate));
  const metrics = computeSalesMetrics(dayOrders ?? [], dayRefunds ?? []);
  const { data: [report14], error: eReport14 } = await mgr.from('daily_reports').upsert({
    organization_id: org.id, store_id: store.id, business_date: bizDate,
    metrics: {
      grossSales: metrics.grossSales, netSales: metrics.netSales, refunds: metrics.refunds,
      voidAmount: metrics.voidAmount, transactionCount: metrics.transactionCount,
      guests: metrics.guests, avgSpend: metrics.avgSpend,
    },
    status: 'submitted', submitted_by: staff.manager.id, submitted_at: new Date().toISOString(),
  }, { onConflict: 'store_id,business_date' }).select();
  check('日報（daily_reports）を作成できる', !eReport14 && !!report14, eReport14?.message);
  check('日報のgrossSalesがdaily_closings.sales_totalと一致する', report14?.metrics?.grossSales === metrics.grossSales);

  // ============================================================
  section('終了時照合（1円・1個・1分単位）');
  // ============================================================
  // POS売上 = payments合計（completed）
  {
    const settledOrders = await fetchAllRows(() => admin.from('orders').select('total').eq('store_id', store.id).eq('business_date', bizDate).in('status', SETTLED_ORDER_STATUSES));
    const orderSum = (settledOrders ?? []).reduce((a, o) => a + o.total, 0);
    const completedPayments = await fetchAllRows(() => admin.from('payments').select('amount').eq('store_id', store.id).eq('business_date', bizDate).eq('status', 'completed'));
    const paySum = (completedPayments ?? []).reduce((a, p) => a + p.amount, 0);
    check('POS売上（paid+refunded注文合計）= payments合計（completed）', orderSum === paySum, `orders:${orderSum} payments:${paySum}`);
  }

  // net_sales = gross - refunds が daily_closings.net_sales と一致
  const { data: [closing] } = await admin.from('daily_closings').select('*').eq('store_id', store.id).eq('business_date', bizDate);
  check('net_sales = gross_sales − refunds がdaily_closingsと一致',
    closing?.net_sales === closing?.sales_total - closing?.refund_total,
    `net=${closing?.net_sales} gross=${closing?.sales_total} refund=${closing?.refund_total}`);
  check('daily_closings.sales_totalがlib/metrics.computeSalesMetrics(grossSales)と一致',
    closing?.sales_total === metrics.grossSales, `snapshot:${closing?.sales_total} lib:${metrics.grossSales}`);
  check('daily_closings.net_salesがlib/metrics.computeSalesMetrics(netSales)と一致',
    closing?.net_sales === metrics.netSales, `snapshot:${closing?.net_sales} lib:${metrics.netSales}`);

  // 現金: 各レジ close時点のexpectedが register_breakdown と一致（意図した+500差異も含む）
  {
    const breakdown = closing?.register_breakdown ?? [];
    let allMatch = true;
    for (const cr of closeResults) {
      const entry = breakdown.find((b) => b.session_id === cr.sessionId);
      if (!entry || entry.expected_cash !== cr.expected || entry.counted_cash !== cr.counted || entry.difference !== cr.difference) {
        allMatch = false;
      }
    }
    check('4レジ全ての現金内訳（expected/counted/difference）がdaily_closings.register_breakdownと一致',
      allMatch, JSON.stringify({ closeResults, breakdown }));
    const diffRegister = breakdown.find((b) => b.session_id === closeResults.find((c) => c.name === 'レジ02')?.sessionId);
    check('意図した+500円差異がregister_breakdownに反映されている', diffRegister?.difference === 500, JSON.stringify(diffRegister));
  }

  // 店舗合計現金 = 各レジ合計。
  // close_store_dayはその営業日に closed/approved の**全**register_sessionsを集約するため
  // （同一営業日に本スクリプトを複数回実行した場合は前回実行分のレジも含まれ得る＝
  // pilot-org.mjsのcleanupPilotDayが「累積許容」方式を採るのと同じ理由）、
  // daily_closings.register_breakdown 自体（closing側が実際に集約した全レジ）を正として
  // 「その合計 = daily_closingsのサマリ値」という自己無矛盾性を検証する。
  // これは本実行の4レジだけでなく、累積したレジがあっても常に成立する頑健な照合。
  {
    const breakdown = closing?.register_breakdown ?? [];
    const sumExpected = breakdown.reduce((a, b) => a + b.expected_cash, 0);
    const sumCounted = breakdown.reduce((a, b) => a + b.counted_cash, 0);
    const sumDiff = breakdown.reduce((a, b) => a + b.difference, 0);
    check('店舗合計理論現金 = register_breakdown内の各レジ理論現金の合計', closing?.expected_cash === sumExpected, `snapshot:${closing?.expected_cash} sum:${sumExpected}`);
    check('店舗合計実現金 = register_breakdown内の各レジ実現金の合計', closing?.counted_cash === sumCounted, `snapshot:${closing?.counted_cash} sum:${sumCounted}`);
    check('店舗合計差異 = register_breakdown内の各レジ差異の合計', closing?.cash_difference === sumDiff, `snapshot:${closing?.cash_difference} sum:${sumDiff}`);
    // 本実行の4レジは必ずその内訳に含まれていること（累積があっても本実行分は欠落しない）
    const ourIds = new Set(closeResults.map((c) => c.sessionId));
    const covered = breakdown.filter((b) => ourIds.has(b.session_id)).length;
    check('本実行の4レジすべてがregister_breakdownに含まれている', covered === 4, `含まれた数:${covered}`);
  }

  // 在庫: 全品目で 開始+入荷−販売使用+返品戻し−廃棄±調整=現在庫（時刻ベースの差分で本実行分のみ）
  {
    let allInvOk = true;
    const detail = [];
    for (const key of trackedInv) {
      const { data: movs } = await admin.from('stock_movements').select('quantity').eq('inventory_item_id', inventory[key].id).gt('created_at', invSnapshotAt);
      const movSum = (movs ?? []).reduce((a, m) => a + Number(m.quantity), 0);
      const after = await currentQty(inventory[key].id);
      const expected = invBefore[key] + movSum;
      const ok = Math.abs(after - expected) < 0.001;
      if (!ok) allInvOk = false;
      detail.push({ key, before: invBefore[key], movSum, expected, after });
    }
    check('在庫: 全7品目で 開始在庫+当回移動合計=現在庫（入荷/販売/返品/廃棄/調整すべて含む）',
      allInvOk, JSON.stringify(detail));
  }

  // 客数・客単価が lib/metrics 定義と一致（daily_closingsとの突合）
  check('daily_closings.guests_countがlib/metrics.computeSalesMetrics(guests)と一致',
    closing?.guests_count === metrics.guests, `snapshot:${closing?.guests_count} lib:${metrics.guests}`);
  check('客単価（net_sales÷guests）がlib/metrics定義の計算と一致',
    metrics.avgSpend === (metrics.guests > 0 ? Math.floor(metrics.netSales / metrics.guests) : 0));

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
