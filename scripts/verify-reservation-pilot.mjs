/**
 * TENPO ONE 予約パイロットE2E検証（FOGO De BRASIA 新宿 想定）
 *
 * 使い方: node --env-file=.env.local scripts/verify-reservation-pilot.mjs
 *
 * 専用テスト企業（[PILOT]・is_demo=false）でのみ動作し、実顧客・デモ企業データには触れない。
 * 監査で確認済みの既存フロー（公開予約RPC・POS・会計）に加え、00040で追加した
 * コース予約・max_party・キャンセル期限・経路・CRM整合を実DB（anon/authenticated）で検証する。
 *
 * シナリオ:
 *   S1 公開ページ情報（get_booking_store が写真/注意/ポリシー/営業時間/コース人数を返す）
 *   S2 公開Web予約（4名・19時・コース）→ 台帳へ source=web で反映
 *   S3 電話予約（source=phone）→ 同一台帳へ反映（Web/電話の統合）
 *   S4 テーブル割当 → 着席 → POS注文 → 会計 → 予約completed → CRM反映
 *   S5 セキュリティ（max_party超過・コース人数外・キャンセル期限・誤電話番号の照会不可）
 */
import { createClient } from '@supabase/supabase-js';
import { ensurePilotOrg, loginPilotUser, cleanupPilotDay } from './pilot-org.mjs';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name} ${detail}`); }
}
function section(t) { console.log(`\n■ ${t}`); }
const randPhone = () => `090${String(10000000 + Math.floor(Math.random() * 89999999))}`;

async function main() {
  console.log('=== TENPO ONE 予約パイロットE2E検証（FOGO想定）===');
  const p = await ensurePilotOrg();
  const { org, store, tables, staff } = p;
  const owner = await loginPilotUser('pilot-owner@test.tenpo.one');

  const { data: businessDate } = await admin.rpc('app_business_date', { p_store_id: store.id });

  // --- FOGO想定セットアップ（コース・公開ページコンテンツ・最大人数）---
  const COURSE_NAME = '[PILOT] シュラスコ食べ放題（2時間飲み放題付）';
  let { data: course } = await admin.from('menu_items').select('*')
    .eq('organization_id', org.id).eq('name', COURSE_NAME).maybeSingle();
  if (!course) {
    const { data, error } = await admin.from('menu_items').insert({
      organization_id: org.id, store_id: store.id, name: COURSE_NAME, item_type: 'course',
      price: 5980, description: 'シュラスコ全種＋サラダバー＋2時間飲み放題', duration_minutes: 120,
      course_min_party: 2, course_max_party: 8, status: 'active', sort_order: 1,
    }).select().single();
    if (error) throw new Error('コース作成失敗: ' + error.message);
    course = data;
  } else {
    await admin.from('menu_items').update({
      duration_minutes: 120, course_min_party: 2, course_max_party: 8, status: 'active', is_sold_out: false,
    }).eq('id', course.id);
  }
  await admin.from('store_settings').update({
    booking_photo_url: '/lp-analytics-cafe.png',
    booking_notes: 'コースは3日前までのご予約をお願いします。お席は2時間制です。',
    cancellation_policy: '前日以降のキャンセルはお電話にてご連絡ください。無断キャンセルはご遠慮ください。',
    max_party_size: 8,
    cancel_deadline_hours: 24,
  }).eq('store_id', store.id);

  // レジ開局（会計に必要）
  const { data: reg } = await admin.from('registers').select('*').eq('store_id', store.id).limit(1);
  const register = reg[0];
  // 既存openセッションがあれば強制クローズ（再実行対策）
  await admin.from('register_sessions').update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('register_id', register.id).eq('status', 'open');
  const { data: openRes, error: eOpen } = await owner.rpc('open_register_session', {
    p_store_id: store.id, p_register_id: register.id, p_opening_float: 30000,
  });
  const sessionId = openRes?.session_id;
  check('レジ開局', !eOpen && !!sessionId, eOpen?.message);

  // ============================================================
  section('S1: 公開ページ情報（get_booking_store）');
  // ============================================================
  const { data: pub, error: ePub } = await anon.rpc('get_booking_store', { p_slug: store.slug });
  check('anon が公開店舗情報を取得できる', !ePub && !!pub, ePub?.message);
  check('店舗写真URLが返る', pub?.photo_url === '/lp-analytics-cafe.png', pub?.photo_url);
  check('注意事項が返る', !!pub?.booking_notes);
  check('キャンセルポリシーが返る', !!pub?.cancellation_policy);
  check('営業時間が7日分返る', Array.isArray(pub?.business_hours) && pub.business_hours.length === 7, `件数:${pub?.business_hours?.length}`);
  const pubCourse = (pub?.courses ?? []).find((c) => c.id === course.id);
  check('コースが公開情報に含まれる', !!pubCourse, `courses:${pub?.courses?.length}`);
  check('コースの利用人数(min/max)が返る', pubCourse?.min_party === 2 && pubCourse?.max_party === 8,
    `min:${pubCourse?.min_party} max:${pubCourse?.max_party}`);

  // ============================================================
  section('S2: 公開Web予約（4名・コース）→ 台帳へ source=web で反映');
  // ============================================================
  const { data: avail } = await anon.rpc('get_booking_availability', { p_slug: store.slug, p_date: businessDate, p_party: 4 });
  const openSlots = (avail ?? []).filter((s) => s.available).map((s) => s.time);
  check('4名の空席スロットが取得できる', openSlots.length > 0, `件数:${openSlots.length}`);
  const slot = openSlots.includes('19:00') ? '19:00' : openSlots[0];
  const webPhone = randPhone();
  const { data: webRes, error: eWeb } = await anon.rpc('create_public_reservation', {
    p_slug: store.slug, p_date: businessDate, p_time: slot, p_party: 4, p_adults: 2, p_children: 2,
    p_name: '山田 太郎', p_kana: 'ヤマダ タロウ', p_phone: webPhone, p_email: 'yamada@example.com',
    p_course_id: course.id, p_seat_type: 'table', p_purpose: '記念日',
    p_allergy: null, p_request: '[PILOT] 窓側希望', p_source_code: 'web', p_consent: true,
  });
  check('公開Web予約が作成できる（4名・コース）', !eWeb && !!webRes?.code, eWeb?.message);
  const webCode = webRes?.code;
  let webRow = null;
  if (webCode) {
    const { data } = await admin.from('reservations')
      .select('*, reservation_sources(code), menu_items:course_id(name)').eq('code', webCode).single();
    webRow = data;
    check('予約が台帳に確定(confirmed)で登録される', webRow?.status === 'confirmed', webRow?.status);
    check('予約経路が web で記録される', webRow?.reservation_sources?.code === 'web', webRow?.reservation_sources?.code);
    check('コースが紐付く', webRow?.course_id === course.id);
    check('滞在時間がコース所要(120分)で計算される',
      Math.round((new Date(webRow.end_at) - new Date(webRow.start_at)) / 60000) === 120,
      `分:${Math.round((new Date(webRow?.end_at) - new Date(webRow?.start_at)) / 60000)}`);
    check('顧客が自動作成/紐付けされる', !!webRow?.customer_id);
  }

  // ============================================================
  section('S3: 電話予約（source=phone）→ 同一台帳へ統合');
  // ============================================================
  const { data: phoneSource } = await admin.from('reservation_sources').select('id').is('organization_id', null).eq('code', 'phone').single();
  const telStart = new Date(`${businessDate}T18:30:00+09:00`);
  const { data: telCustomer } = await admin.from('customers').insert({
    organization_id: org.id, primary_store_id: store.id, name: '佐藤 花子', phone: randPhone(), email: null,
  }).select().single();
  const { data: telRow, error: eTel } = await owner.from('reservations').insert({
    organization_id: org.id, store_id: store.id, customer_id: telCustomer.id,
    code: `TEL-${Date.now()}`, reserved_date: businessDate,
    start_at: telStart.toISOString(), end_at: new Date(telStart.getTime() + 120 * 60000).toISOString(),
    party_size: 2, adults: 2, children: 0, guest_name: '佐藤 花子', guest_phone: telCustomer.phone,
    status: 'confirmed', source_id: phoneSource.id, created_via: 'phone', consent_accepted: false,
  }).select().single();
  check('電話予約を店舗側で登録できる', !eTel && !!telRow, eTel?.message);
  const { data: ledger } = await admin.from('reservations')
    .select('id, created_via, reservation_sources(code)').eq('store_id', store.id).eq('reserved_date', businessDate)
    .in('id', [webRow?.id, telRow?.id].filter(Boolean));
  check('Web予約と電話予約が同一台帳に並ぶ', (ledger ?? []).length === 2, `件数:${ledger?.length}`);
  check('経路がそれぞれ web / phone で区別される',
    new Set((ledger ?? []).map((r) => r.reservation_sources?.code)).size === 2);

  // ============================================================
  section('S4: テーブル割当 → 着席 → POS → 会計 → completed → CRM');
  // ============================================================
  const bigTable = tables.find((t) => t.capacity_max >= 4) ?? tables[0];
  const { error: eAssign } = await owner.from('reservation_tables').insert({ reservation_id: webRow.id, table_id: bigTable.id });
  check('予約にテーブルを割り当てできる', !eAssign, eAssign?.message);

  // 着席へ遷移
  const { error: eSeat } = await owner.from('reservations').update({ status: 'seated' }).eq('id', webRow.id);
  check('予約を着席(seated)へ遷移できる', !eSeat, eSeat?.message);

  // POS注文作成（予約由来）→ 会計
  const { data: order, error: eOrd } = await owner.from('orders').insert({
    organization_id: org.id, store_id: store.id, order_type: 'dine_in',
    table_id: bigTable.id, reservation_id: webRow.id, customer_id: webRow.customer_id,
    guest_count: 4, staff_id: staff.owner?.id ?? null,
  }).select().single();
  check('予約からPOS注文を作成できる', !eOrd && !!order, eOrd?.message);
  const { data: fogoMenu } = await admin.from('menu_items').select('id,name,price').eq('organization_id', org.id).eq('item_type', 'course').eq('id', course.id).single();
  await owner.from('order_items').insert({
    organization_id: org.id, store_id: store.id, order_id: order.id,
    menu_item_id: fogoMenu.id, name: fogoMenu.name, unit_price: fogoMenu.price, quantity: 4,
    tax_rate: 10, tax_included: true, line_total: fogoMenu.price * 4,
  });
  await owner.rpc('recalc_order_totals', { p_order_id: order.id });
  const { data: priced } = await owner.from('orders').select('total').eq('id', order.id).single();
  const { data: fin, error: eFin } = await owner.rpc('finalize_order', {
    p_order_id: order.id, p_payments: [{ method: 'cash', amount: priced.total }], p_register_session_id: sessionId,
  });
  check('会計(finalize_order)が成立する', !eFin && !!fin, eFin?.message);
  const { data: afterRes } = await admin.from('reservations').select('status').eq('id', webRow.id).single();
  check('会計完了で予約が completed になる', afterRes?.status === 'completed', afterRes?.status);
  // CRM反映
  await owner.rpc('recalc_customer_stats', { p_customer_id: webRow.customer_id });
  const { data: cust } = await admin.from('customers').select('visit_count, total_spent, cancel_count, no_show_count').eq('id', webRow.customer_id).single();
  check('CRM: 来店回数が加算される', cust?.visit_count >= 1, `visit:${cust?.visit_count}`);
  check('CRM: 利用金額が加算される', cust?.total_spent >= priced.total, `spent:${cust?.total_spent}`);
  check('CRM: cancel/no_show が整合(0)で再計算される', cust?.cancel_count === 0 && cust?.no_show_count === 0,
    `cancel:${cust?.cancel_count} no_show:${cust?.no_show_count}`);

  // ============================================================
  section('S5: セキュリティ（max_party・コース人数・キャンセル期限・誤電話）');
  // ============================================================
  const { data: bigParty, error: eBig } = await anon.rpc('create_public_reservation', {
    p_slug: store.slug, p_date: businessDate, p_time: slot, p_party: 12, p_adults: 12, p_children: 0,
    p_name: 'テスト', p_kana: null, p_phone: randPhone(), p_email: null, p_consent: true,
  });
  check('最大人数超過(12>8)は PARTY_TOO_LARGE で拒否', !bigParty && /PARTY_TOO_LARGE/.test(eBig?.message ?? ''), eBig?.message);

  const { data: smallCourse, error: eSmall } = await anon.rpc('create_public_reservation', {
    p_slug: store.slug, p_date: businessDate, p_time: slot, p_party: 1, p_adults: 1, p_children: 0,
    p_name: 'テスト', p_kana: null, p_phone: randPhone(), p_email: null,
    p_course_id: course.id, p_consent: true,
  });
  check('コース最少人数未満(1<2)は COURSE_PARTY_INVALID で拒否', !smallCourse && /COURSE_PARTY_INVALID/.test(eSmall?.message ?? ''), eSmall?.message);

  // キャンセル期限（期限超過は拒否 / 期限内は許可＝過剰拒否でない）を専用予約で検証
  const deadlinePhone = randPhone();
  const nearStart = new Date(`${businessDate}T20:00:00+09:00`); // 本日20時（24h前期限は既に経過）
  const { data: nearRes } = await admin.from('reservations').insert({
    organization_id: org.id, store_id: store.id, customer_id: null,
    code: `CXL-${Date.now()}A`, reserved_date: businessDate,
    start_at: nearStart.toISOString(), end_at: new Date(nearStart.getTime() + 120 * 60000).toISOString(),
    party_size: 2, adults: 2, children: 0, guest_name: '期限テスト', guest_phone: deadlinePhone,
    status: 'confirmed', created_via: 'phone', consent_accepted: false,
  }).select().single();
  const { error: eCancel } = await anon.rpc('cancel_public_reservation', { p_code: nearRes.code, p_phone: deadlinePhone, p_reason: 'test' });
  check('キャンセル期限超過は CANCEL_DEADLINE_PASSED で拒否（直叩き回避）',
    /CANCEL_DEADLINE_PASSED/.test(eCancel?.message ?? ''), eCancel?.message ?? '（拒否されなかった）');

  // 期限内（十分先の日付）はWebキャンセルできる＝過剰拒否でないこと
  const farPhone = randPhone();
  const farDate = new Date(Date.now() + 20 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const farStart = new Date(`${farDate}T19:00:00+09:00`);
  const { data: farRes } = await admin.from('reservations').insert({
    organization_id: org.id, store_id: store.id, customer_id: null,
    code: `CXL-${Date.now()}B`, reserved_date: farDate,
    start_at: farStart.toISOString(), end_at: new Date(farStart.getTime() + 120 * 60000).toISOString(),
    party_size: 2, adults: 2, children: 0, guest_name: '期限内テスト', guest_phone: farPhone,
    status: 'confirmed', created_via: 'phone', consent_accepted: false,
  }).select().single();
  const { data: farCancel, error: eFar } = await anon.rpc('cancel_public_reservation', { p_code: farRes.code, p_phone: farPhone, p_reason: 'test' });
  check('期限内の予約はWebキャンセルできる（過剰拒否でない）', !eFar && farCancel?.ok === true, eFar?.message);
  await admin.from('reservations').delete().in('id', [nearRes.id, farRes.id]);

  const { data: wrongLookup } = await anon.rpc('get_public_reservation', { p_code: webCode, p_phone: '00000000000' });
  check('誤った電話番号では予約照会できない（IDOR防止）', !wrongLookup, JSON.stringify(wrongLookup));

  // ============================================================
  section('後片付け（未会計の予約のみ削除。会計済みは累積許容）');
  // ============================================================
  await admin.from('reservation_tables').delete().eq('reservation_id', telRow?.id);
  await admin.from('reservations').delete().eq('id', telRow?.id);
  await admin.from('customers').delete().eq('id', telCustomer?.id);
  await cleanupPilotDay(org.id, businessDate);
  console.log('  後片付け完了');

  console.log(`\n=== 検証結果 ===\n成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) {
    console.log('\n失敗項目:');
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
