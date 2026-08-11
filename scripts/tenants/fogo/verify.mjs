/**
 * FOGO 本番テナント E2E検証（安全・非破壊）
 *
 *   node --env-file=.env.local scripts/tenants/fogo/verify.mjs
 *
 * 本番テナントを汚さない設計:
 *  - テスト用の営業時間・予約・顧客・未会計QR注文は作成後に必ず削除する。
 *  - finalize（不変の売上）はFOGO本番では実行しない（POS→会計→CRMの一連はverify-store-dayで汎用検証済み）。
 *  - demo/他テナントには一切触れない。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const SLUG = 'fogo-de-brasia-shinjuku';

let pass = 0, fail = 0; const failures = [];
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; failures.push(`${n}${d ? ' — ' + d : ''}`); console.log(`  ✗ ${n} ${d}`); } };
const section = (t) => console.log(`\n■ ${t}`);
const randPhone = () => `090${String(10000000 + Math.floor(Math.random() * 89999999))}`;

async function main() {
  console.log('=== FOGO 本番テナント E2E検証 ===');
  const { data: store } = await admin.from('stores').select('*').eq('slug', SLUG).maybeSingle();
  if (!store) throw new Error('FOGO店舗がありません。setup.mjs / import-menu.mjs を先に実行してください。');
  const org = store.organization_id;
  const { data: orgRow } = await admin.from('organizations').select('is_demo').eq('id', org).single();

  const cleanup = { hours: false, tax: false, reservationIds: [], customerIds: [], orderIds: [] };
  // Web予約テストは未来日を使う（当日は現在時刻以降の枠しか空かないため時刻依存を避ける）
  const futureDate = new Date(Date.now() + 3 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  try {
    // ============================================================
    section('CASE0: 本番テナントの前提（is_demo=false・分離）');
    // ============================================================
    check('FOGO org は is_demo=false（本番）', orgRow?.is_demo === false, `is_demo=${orgRow?.is_demo}`);
    const { data: obEnv } = await admin.from('store_onboarding').select('environment').eq('store_id', store.id).single();
    check('environment=production', obEnv?.environment === 'production', obEnv?.environment);

    // ============================================================
    section('CASE1: 公開店舗情報・コース・席/コース可否（anon）');
    // ============================================================
    const { data: pub } = await anon.rpc('get_booking_store', { p_slug: SLUG });
    check('anonがFOGO公開情報を取得', !!pub && pub.name === store.name, pub?.name);
    check('席のみ/コース 両方有効', pub?.seat_only_enabled === true && pub?.course_enabled === true);
    check('公開コースが6件', (pub?.courses ?? []).length === 6, `件数:${pub?.courses?.length}`);
    const course = (pub?.courses ?? [])[0];
    check('コースに食べ放題/利用時間属性がある', course && (course.includes_ayce !== undefined) && (course.duration_minutes !== undefined));

    // ============================================================
    section('CASE2: メニュー130件・カテゴリ・station（FOGOスコープ）');
    // ============================================================
    const q = (t) => admin.from('menu_items').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('item_type', t);
    const [c6, f38, d86] = await Promise.all([q('course'), q('food'), q('drink')]);
    check('コース6/料理38/ドリンク86＝130', c6.count === 6 && f38.count === 38 && d86.count === 86, `${c6.count}/${f38.count}/${d86.count}`);
    const { count: pendingCount } = await admin.from('menu_items').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('price_pending', true);
    check('価格未設定は非公開(price_pending)で管理', (pendingCount ?? 0) === 2, `pending=${pendingCount}`);
    // station routing
    const { data: foodCat } = await admin.from('menu_categories').select('station').eq('organization_id', org).eq('name', 'シュラスコ（牛）').single();
    const { data: drinkCat } = await admin.from('menu_categories').select('station').eq('organization_id', org).eq('name', '生ビール').single();
    check('料理カテゴリ→kitchen / ドリンク→drink', foodCat?.station === 'kitchen' && drinkCat?.station === 'drink', `${foodCat?.station}/${drinkCat?.station}`);

    // ============================================================
    section('CASE3: QRモバイルオーダー（料理→kitchen / ドリンク→drink・価格はサーバー正）');
    // ============================================================
    // QR注文は税設定が必要。FOGOは税未設定（オーナー作業）のため、テスト用に一時的に既定10%を設定→後で削除。
    const { data: existingTax } = await admin.from('tax_rates').select('id').eq('organization_id', org).eq('status', 'active').limit(1).maybeSingle();
    if (!existingTax) {
      await admin.from('tax_rates').insert({ organization_id: org, name: '[TEST]標準税率', rate: 10, is_inclusive: true, is_default: true });
      cleanup.tax = true;
    }
    const { data: tableRow } = await admin.from('restaurant_tables').select('id, name, qr_token').eq('store_id', store.id).eq('name', 'T5').single();
    const qrMenu = await anon.rpc('get_qr_menu', { p_slug: SLUG, p_token: tableRow.qr_token });
    check('T5のQRメニューを取得（自動で卓認識）', !qrMenu.error && !!qrMenu.data, qrMenu.error?.message);
    // 公開価格の料理・ドリンクを1件ずつ
    const { data: foodItem } = await admin.from('menu_items').select('id, price').eq('organization_id', org).eq('item_type', 'food').eq('status', 'active').limit(1).single();
    const { data: drinkItem } = await admin.from('menu_items').select('id, price').eq('organization_id', org).eq('item_type', 'drink').eq('status', 'active').limit(1).single();
    // クライアントが価格を偽装しても無視される（RPCはmenu_item_id+quantityのみ受け取る）
    const qrOrder = await anon.rpc('create_qr_order', { p_slug: SLUG, p_token: tableRow.qr_token, p_items: [{ menu_item_id: foodItem.id, quantity: 2, price: 1 }, { menu_item_id: drinkItem.id, quantity: 1 }] });
    check('QR注文が作成できる', !qrOrder.error && !!qrOrder.data, qrOrder.error?.message);
    const orderId = qrOrder.data?.order_id;
    if (orderId) {
      cleanup.orderIds.push(orderId);
      const { data: items } = await admin.from('order_items').select('menu_item_id, unit_price, line_total, quantity').eq('order_id', orderId);
      const foodLine = items.find((i) => i.menu_item_id === foodItem.id);
      check('価格はサーバーのmenu master（クライアント偽装price=1を無視）', foodLine?.unit_price === foodItem.price, `unit=${foodLine?.unit_price} 期待=${foodItem.price}`);
    }

    // ============================================================
    section('CASE4: QRトークン改ざん・他テナント拒否');
    // ============================================================
    const tamper = await anon.rpc('get_qr_menu', { p_slug: SLUG, p_token: 'tampered-token-xxxxxxxx' });
    check('改ざんトークンは拒否（メニュー取得不可）', tamper.error || !tamper.data, JSON.stringify(tamper.data)?.slice(0, 30));
    // 他テナント（demo）のtokenでFOGO slugを指定→拒否
    const { data: demoTable } = await admin.from('restaurant_tables').select('qr_token').not('qr_token', 'is', null).neq('store_id', store.id).limit(1).maybeSingle();
    if (demoTable) {
      const cross = await anon.rpc('get_qr_menu', { p_slug: SLUG, p_token: demoTable.qr_token });
      check('他テナントのtokenでFOGOメニューを取得できない', cross.error || !cross.data, '取得できてしまった');
    }

    // ============================================================
    section('CASE5: Web予約 席のみ / コース（テスト用営業時間を一時設定）');
    // ============================================================
    // 一時営業時間（テスト後に削除）
    for (let dow = 0; dow < 7; dow++) {
      await admin.from('business_hours').upsert({ organization_id: org, store_id: store.id, day_of_week: dow, is_closed: false, open_time: '11:00', close_time: '23:00', last_entry_time: '22:00' }, { onConflict: 'store_id,day_of_week' });
    }
    cleanup.hours = true;
    const avail = await anon.rpc('get_booking_availability', { p_slug: SLUG, p_date: futureDate, p_party: 4 });
    const slots = (avail.data ?? []).filter((s) => s.available).map((s) => s.time);
    check('空席スロットが取得できる', slots.length > 0, `件数:${slots.length}`);
    const slot = slots[0];

    // 席のみ（course無し）
    const p1 = randPhone();
    const seatOnly = await anon.rpc('create_public_reservation', { p_slug: SLUG, p_date: futureDate, p_time: slot, p_party: 4, p_adults: 4, p_children: 0, p_name: '席のみテスト', p_kana: null, p_phone: p1, p_email: null, p_consent: true });
    check('席のみ予約が成立（course_id=null）', !seatOnly.error && !!seatOnly.data?.code, seatOnly.error?.message);
    if (seatOnly.data?.code) {
      const { data: r } = await admin.from('reservations').select('id, course_id, customer_id').eq('code', seatOnly.data.code).single();
      cleanup.reservationIds.push(r.id); if (r.customer_id) cleanup.customerIds.push(r.customer_id);
      check('席のみは course_id が null', r.course_id === null, `course_id=${r.course_id}`);
    }

    // コース
    const fogoCourse = (pub.courses ?? []).find((c) => c.max_party == null || c.max_party >= 4) ?? pub.courses[0];
    const slot2 = slots[1] ?? slots[0];
    const p2 = randPhone();
    const courseRes = await anon.rpc('create_public_reservation', { p_slug: SLUG, p_date: futureDate, p_time: slot2, p_party: 4, p_adults: 4, p_children: 0, p_name: 'コーステスト', p_kana: null, p_phone: p2, p_email: null, p_course_id: fogoCourse.id, p_consent: true });
    check('コース予約が成立（course_id指定）', !courseRes.error && !!courseRes.data?.code, courseRes.error?.message);
    if (courseRes.data?.code) {
      const { data: r } = await admin.from('reservations').select('id, course_id, start_at, end_at, customer_id').eq('code', courseRes.data.code).single();
      cleanup.reservationIds.push(r.id); if (r.customer_id) cleanup.customerIds.push(r.customer_id);
      check('コース予約は course_id が設定される', r.course_id === fogoCourse.id);
    }

    // ============================================================
    section('CASE6: 電話予約 席のみ/コース（同一台帳・source=phone）');
    // ============================================================
    const { data: phoneSrc } = await admin.from('reservation_sources').select('id').is('organization_id', null).eq('code', 'phone').single();
    const telStart = new Date(`${futureDate}T20:00:00+09:00`);
    const telPhone = randPhone();
    const { data: telCust, error: eTelCust } = await admin.from('customers').insert({ organization_id: org, primary_store_id: store.id, name: '電話席のみ', phone: telPhone }).select('id').single();
    if (eTelCust || !telCust) throw new Error('電話予約テスト用顧客の作成に失敗: ' + (eTelCust?.message ?? 'null'));
    cleanup.customerIds.push(telCust.id);
    const { data: telRes, error: eTelRes } = await admin.from('reservations').insert({ organization_id: org, store_id: store.id, customer_id: telCust.id, code: `TEL-${Date.now()}`, reserved_date: futureDate, start_at: telStart.toISOString(), end_at: new Date(telStart.getTime() + 120 * 60000).toISOString(), party_size: 2, adults: 2, children: 0, course_id: null, guest_name: '電話席のみ', guest_phone: telPhone, status: 'confirmed', source_id: phoneSrc.id, created_via: 'phone', consent_accepted: false }).select('id').single();
    if (telRes?.id) cleanup.reservationIds.push(telRes.id);
    check('電話予約（席のみ・course_id=null・source=phone）が台帳に入る', !!telRes?.id, eTelRes?.message);

    // ============================================================
    section('CASE7: 空席判定（最大人数・容量）');
    // ============================================================
    const overMax = await anon.rpc('create_public_reservation', { p_slug: SLUG, p_date: futureDate, p_time: slot, p_party: 200, p_adults: 200, p_children: 0, p_name: 'x', p_kana: null, p_phone: randPhone(), p_email: null, p_consent: true });
    check('人数上限超過は拒否（PARTY_TOO_LARGE/INVALID_PARTY）', !!overMax.error && /PARTY_TOO_LARGE|INVALID_PARTY/.test(overMax.error.message), overMax.error?.message);

  } finally {
    section('後片付け（テストデータのみ削除・本番はfinalizeしない）');
    for (const id of cleanup.orderIds) {
      await admin.from('order_items').delete().eq('order_id', id);
      await admin.from('orders').delete().eq('id', id); // 未会計(open)のみ→削除可
    }
    for (const id of cleanup.reservationIds) {
      await admin.from('reservation_tables').delete().eq('reservation_id', id);
      await admin.from('reservations').delete().eq('id', id);
    }
    for (const id of cleanup.customerIds) await admin.from('customers').delete().eq('id', id);
    if (cleanup.hours) await admin.from('business_hours').delete().eq('store_id', store.id); // 営業時間は未設定へ戻す（オーナーが設定）
    if (cleanup.tax) await admin.from('tax_rates').delete().eq('organization_id', org).eq('name', '[TEST]標準税率'); // 税も未設定へ戻す
    console.log('  後片付け完了（FOGO本番は営業時間/税 未設定・テスト予約/注文/顧客は削除）');
  }

  console.log(`\n=== 検証結果 ===\n成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) { console.log('\n失敗項目:'); for (const f of failures) console.log(' - ' + f); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
