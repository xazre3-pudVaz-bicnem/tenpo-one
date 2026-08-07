/**
 * TENPO ONE デモデータ投入スクリプト（冪等）
 *
 * 使い方:
 *   node --env-file=.env.local scripts/seed.mjs
 *   （SUPABASE_URL または NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要）
 *
 * デモ企業「株式会社TENPO ONE DEMO」(is_demo=true) と3店舗、スタッフ・テーブル・
 * メニュー・顧客・予約・注文・会計・勤怠・請求書・小口現金・売上30日分を投入する。
 *
 * 冪等性: 再実行しても企業・店舗・ユーザーは重複しない（get-or-create / upsert）。
 * 大量データ（注文・勤怠等）はセクション単位で「既存データがあればスキップ」する。
 *
 * 注意: supabase-jsの一括insertは全行のキー集合を統一し、欠けたキーへ明示的に
 * null を送るため、NOT NULLカラムはDEFAULTがあっても違反する。
 * → 一括insertの各行は必ず同じキー集合・明示的な値で組み立てること。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を設定してください');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'TenpoOne-Demo1!';

// 疑似乱数（再現性のため固定シード）
let seedState = 20260806;
function rand() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

async function insert(table, rows) {
  const { data, error } = await db.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

async function upsert(table, rows, onConflict) {
  const { data, error } = await db.from(table).upsert(rows, { onConflict }).select();
  if (error) throw new Error(`${table} (upsert): ${error.message}`);
  return data;
}

/** テーブルにorg配下の既存行があるか（セクションスキップ判定用） */
async function hasRows(table, orgId, extraFilter = null) {
  let q = db.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
  if (extraFilter) q = extraFilter(q);
  const { count, error } = await q;
  if (error) throw new Error(`${table} (count): ${error.message}`);
  return (count ?? 0) > 0;
}

function jstDate(daysAgo, hour = 12, minute = 0) {
  const now = new Date();
  const d = new Date(now.getTime() - daysAgo * 86400000);
  const y = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  // hourが24以上（深夜勤務の退勤等）でも翌日へ正しく繰り越すため加算方式で組み立てる
  return new Date(new Date(`${y}T00:00:00+09:00`).getTime() + hour * 3600000 + minute * 60000);
}
const bd = (daysAgo) => jstDate(daysAgo).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

/** authユーザーの取得または作成（重複メールは既存ユーザーを再利用） */
async function ensureUser(email, name, kana, pin) {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: name, display_name_kana: kana },
  });
  let userId;
  if (error) {
    if (/already|exists|registered/i.test(error.message)) {
      // 既存ユーザーをメールで検索
      const { data: list, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (listError) throw new Error(`auth listUsers: ${listError.message}`);
      const found = list.users.find((u) => u.email === email);
      if (!found) throw new Error(`auth ${email}: 既存のはずのユーザーが見つかりません`);
      userId = found.id;
    } else {
      throw new Error(`auth ${email}: ${error.message}`);
    }
  } else {
    userId = data.user.id;
  }
  // profiles はトリガーで生成される。PIN・表示名を確実に反映
  const { error: profileError } = await db
    .from('profiles')
    .update({ pin_code: pin, display_name: name, display_name_kana: kana })
    .eq('id', userId);
  if (profileError) throw new Error(`profiles ${email}: ${profileError.message}`);
  return userId;
}

async function main() {
  console.log('=== TENPO ONE デモデータ投入（冪等モード） ===');

  // ---- 企業（get-or-create） ----
  let org;
  {
    const { data } = await db.from('organizations').select('*').eq('is_demo', true).limit(1);
    if (data?.length) {
      org = data[0];
      console.log('企業: 既存を再利用 —', org.name);
    } else {
      [org] = await insert('organizations', [{
        name: '株式会社TENPO ONE DEMO',
        name_kana: 'カブシキガイシャテンポワンデモ',
        plan_code: 'standard',
        status: 'active',
        contact_email: 'demo@tenpo-one.example.com',
        is_demo: true,
        // デモ企業は初期導入ウィザードをスキップ（データ投入済みのため）
        onboarding: { completed: true },
      }]);
      console.log('企業: 作成 —', org.name);
    }
  }
  const orgId = org.id;

  // ---- 店舗（slugでget-or-create） ----
  const storesDef = [
    { slug: 'tenpoone-shibuya', name: 'TENPO ONE 渋谷店', address: '東京都渋谷区道玄坂1-2-3 渋谷ONEビル2F', phone: '03-1234-5001' },
    { slug: 'tenpoone-shinjuku', name: 'TENPO ONE 新宿店', address: '東京都新宿区西新宿1-4-5 新宿ONEビル3F', phone: '03-1234-5002' },
    { slug: 'tenpoone-yokohama', name: 'TENPO ONE 横浜店', address: '神奈川県横浜市西区みなとみらい2-6-7', phone: '045-123-5003' },
  ];
  const stores = [];
  for (const def of storesDef) {
    const { data: existing } = await db.from('stores').select('*').eq('slug', def.slug).limit(1);
    if (existing?.length) {
      stores.push(existing[0]);
    } else {
      const [s] = await insert('stores', [{
        ...def, organization_id: orgId, seat_count: 40, booking_enabled: true,
        description: '旬の食材を使った創作和食と厳選ワインのお店です。',
      }]);
      stores.push(s);
    }
  }
  await upsert('store_settings', stores.map((s) => ({
    organization_id: orgId, store_id: s.id,
    slot_minutes: 30, default_stay_minutes: 120, booking_cutoff_minutes: 120,
    booking_window_days: 90, max_party_size: 10, cancel_deadline_hours: 24,
    receipt_header: `${s.name}\n${s.address}`,
    receipt_footer: 'ご来店ありがとうございました',
  })), 'store_id');
  console.log('店舗:', stores.map((s) => s.name).join(', '));

  // ---- ユーザー（メール重複時は既存再利用・membershipはupsert） ----
  const usersDef = [
    ['owner@demo.tenpo.one', '田中 太郎', 'タナカ タロウ', 'org_owner', [], '1001'],
    ['hq@demo.tenpo.one', '鈴木 一郎', 'スズキ イチロウ', 'hq_admin', [], '1002'],
    ['keiri@demo.tenpo.one', '佐藤 花子', 'サトウ ハナコ', 'hq_accounting', [], '1003'],
    ['area@demo.tenpo.one', '高橋 健', 'タカハシ ケン', 'area_manager', [0, 1], '2001'],
    ['shibuya@demo.tenpo.one', '伊藤 誠', 'イトウ マコト', 'store_manager', [0], '3001'],
    ['shinjuku@demo.tenpo.one', '渡辺 直美', 'ワタナベ ナオミ', 'store_manager', [1], '3002'],
    ['yokohama@demo.tenpo.one', '山本 大輔', 'ヤマモト ダイスケ', 'store_manager', [2], '3003'],
    ['staff1@demo.tenpo.one', '中村 美咲', 'ナカムラ ミサキ', 'staff', [0], '4001'],
    ['staff2@demo.tenpo.one', '小林 蓮', 'コバヤシ レン', 'part_time', [0], '4002'],
    ['staff3@demo.tenpo.one', '加藤 結衣', 'カトウ ユイ', 'staff', [1], '4003'],
    ['zeirishi@demo.tenpo.one', '会計 事務所', 'カイケイ ジムショ', 'external_accountant', [], '5001'],
  ];
  const userIds = {};
  for (const [email, name, kana, role, storeIdx, pin] of usersDef) {
    const uid = await ensureUser(email, name, kana, pin);
    userIds[email] = uid;
    const [m] = await upsert('memberships',
      [{ organization_id: orgId, profile_id: uid, role, status: 'active' }],
      'organization_id,profile_id');
    if (storeIdx.length) {
      await upsert('membership_stores', storeIdx.map((i, n) => ({
        membership_id: m.id, store_id: stores[i].id, is_primary: n === 0,
      })), 'membership_id,store_id');
    }
    console.log('ユーザー:', email, `(${role})`);
  }
  const staffByStore = [
    [userIds['shibuya@demo.tenpo.one'], userIds['staff1@demo.tenpo.one'], userIds['staff2@demo.tenpo.one']],
    [userIds['shinjuku@demo.tenpo.one'], userIds['staff3@demo.tenpo.one']],
    [userIds['yokohama@demo.tenpo.one']],
  ];

  // ---- フロア・テーブル（店舗単位でget-or-create。全行のキーを統一） ----
  const tablesByStore = [];
  for (const s of stores) {
    let floor;
    const { data: existingFloor } = await db.from('floors')
      .select('*').eq('store_id', s.id).eq('name', '1F').limit(1);
    if (existingFloor?.length) {
      floor = existingFloor[0];
    } else {
      [floor] = await insert('floors', [{ organization_id: orgId, store_id: s.id, name: '1F', sort_order: 1 }]);
    }

    const { data: existingTables } = await db.from('restaurant_tables')
      .select('*').eq('store_id', s.id).eq('status', 'active').order('sort_order');
    if (existingTables?.length) {
      tablesByStore.push(existingTables);
      continue;
    }
    // 注意: 一括insertは全行同一キー必須（欠けキーはnull送信されNOT NULL違反になる）
    const defs = [];
    for (let i = 1; i <= 6; i++) {
      defs.push({
        organization_id: orgId, store_id: s.id, floor_id: floor.id,
        name: `T${i}`, capacity_min: 2, capacity_max: 4,
        is_private_room: false, is_counter: false, smoking_allowed: false,
        sort_order: i,
      });
    }
    defs.push({
      organization_id: orgId, store_id: s.id, floor_id: floor.id,
      name: 'C1', capacity_min: 1, capacity_max: 2,
      is_private_room: false, is_counter: true, smoking_allowed: false,
      sort_order: 7,
    });
    defs.push({
      organization_id: orgId, store_id: s.id, floor_id: floor.id,
      name: '個室1', capacity_min: 4, capacity_max: 8,
      is_private_room: true, is_counter: false, smoking_allowed: false,
      sort_order: 8,
    });
    tablesByStore.push(await insert('restaurant_tables', defs));
  }
  console.log('テーブル:', tablesByStore.map((t) => t.length).join('/'), '卓');

  // ---- 営業時間（upsert） ----
  for (const s of stores) {
    const hours = [];
    for (let dow = 0; dow <= 6; dow++) {
      hours.push({
        organization_id: orgId, store_id: s.id, day_of_week: dow,
        is_closed: false,
        open_time: '11:00', close_time: '23:00', last_entry_time: '21:30',
      });
    }
    await upsert('business_hours', hours, 'store_id,day_of_week');
  }

  // ---- 税率（get-or-create。全行同一キー） ----
  let taxRates;
  {
    const { data: existing } = await db.from('tax_rates')
      .select('*').eq('organization_id', orgId).eq('status', 'active').order('rate', { ascending: false });
    if (existing?.length) {
      taxRates = existing;
    } else {
      taxRates = await insert('tax_rates', [
        { organization_id: orgId, name: '標準税率 10%（内税）', rate: 10, is_reduced: false, is_inclusive: true, is_default: true },
        { organization_id: orgId, name: '軽減税率 8%（内税）', rate: 8, is_reduced: true, is_inclusive: true, is_default: false },
      ]);
    }
  }
  const tax10 = taxRates.find((t) => Number(t.rate) === 10)?.id ?? taxRates[0].id;

  // ---- メニュー（既存があれば再利用） ----
  let menuItems;
  let courses;
  {
    const { data: existingItems } = await db.from('menu_items')
      .select('*').eq('organization_id', orgId).eq('status', 'active').order('sort_order');
    if (existingItems?.length) {
      menuItems = existingItems.filter((m) => m.item_type !== 'course');
      courses = existingItems.filter((m) => m.item_type === 'course');
      console.log('メニュー: 既存を再利用 —', existingItems.length, '品');
    } else {
      const catDefs = [
        ['前菜', '#7B3FF2'], ['メイン', '#5A2ED6'], ['ご飯・麺', '#0EA5E9'],
        ['デザート', '#F59E0B'], ['ドリンク', '#10B981'], ['コース', '#EF4444'],
      ];
      let cats;
      const { data: existingCats } = await db.from('menu_categories')
        .select('*').eq('organization_id', orgId).eq('status', 'active');
      if (existingCats?.length) {
        cats = existingCats;
      } else {
        cats = await insert('menu_categories', catDefs.map(([name, color], i) => ({
          organization_id: orgId, name, color, sort_order: i + 1,
        })));
      }
      const menuDefs = [
        ['前菜', '季節の前菜盛り合わせ', 980, 350], ['前菜', '自家製ポテトサラダ', 580, 150],
        ['前菜', '刺身三点盛り', 1480, 600], ['前菜', '枝豆', 380, 80],
        ['メイン', '和牛ハンバーグ', 1680, 620], ['メイン', '本日の焼き魚', 1280, 480],
        ['メイン', '鶏の唐揚げ', 880, 280], ['メイン', '豚の角煮', 1180, 400],
        ['ご飯・麺', '土鍋ご飯', 780, 200], ['ご飯・麺', '〆の醤油ラーメン', 880, 260],
        ['ご飯・麺', '鮭いくら丼', 1580, 650],
        ['デザート', '抹茶プリン', 580, 150], ['デザート', '本日のアイス', 480, 100],
        ['ドリンク', '生ビール', 650, 200], ['ドリンク', 'ハイボール', 550, 120],
        ['ドリンク', '日本酒（一合）', 780, 300], ['ドリンク', 'ウーロン茶', 380, 50],
        ['ドリンク', 'グラスワイン', 680, 250],
      ];
      menuItems = await insert('menu_items', menuDefs.map(([cat, name, price, cost], i) => ({
        organization_id: orgId,
        category_id: cats.find((c) => c.name === cat).id,
        name, price, cost,
        takeout_price: cat === 'ドリンク' ? null : price,
        item_type: cat === 'ドリンク' ? 'drink' : 'food',
        tax_rate_id: tax10,
        duration_minutes: null,
        description: null,
        sort_order: i + 1,
      })));
      const courseCat = cats.find((c) => c.name === 'コース').id;
      courses = await insert('menu_items', [
        { organization_id: orgId, category_id: courseCat, name: '季節のおまかせコース', price: 5500, cost: 2200, takeout_price: null, item_type: 'course', duration_minutes: 120, tax_rate_id: tax10, description: '前菜からデザートまで全7品', sort_order: 100 },
        { organization_id: orgId, category_id: courseCat, name: '贅沢和牛コース', price: 8800, cost: 3900, takeout_price: null, item_type: 'course', duration_minutes: 150, tax_rate_id: tax10, description: '和牛メインの全8品', sort_order: 101 },
      ]);
      console.log('メニュー:', menuItems.length + courses.length, '品');
    }
  }

  // ---- 顧客（既存があれば再利用） ----
  let customers;
  {
    const { data: existing } = await db.from('customers')
      .select('*').eq('organization_id', orgId).eq('status', 'active').order('created_at');
    if (existing?.length) {
      customers = existing;
      console.log('顧客: 既存を再利用 —', customers.length, '名');
    } else {
      const lastNames = ['山田', '佐々木', '井上', '木村', '林', '清水', '森', '池田', '橋本', '阿部', '石川', '前田'];
      const firstNames = ['翔太', '陽菜', '大輝', 'さくら', '悠斗', '美優', '拓海', '葵', '健太', '結菜', '亮', '真央'];
      const customerRows = [];
      for (let i = 0; i < 24; i++) {
        customerRows.push({
          organization_id: orgId,
          primary_store_id: stores[i % 3].id,
          name: `${lastNames[i % 12]} ${firstNames[(i * 5) % 12]}`,
          phone: `090${String(10000000 + i * 137).padStart(8, '0')}`,
          email: `guest${i + 1}@example.com`,
          allergy_note: i % 6 === 0 ? 'えび・かに' : null,
          preference_note: i % 5 === 0 ? '日本酒好き。窓際席を好む' : null,
        });
      }
      customers = await insert('customers', customerRows);
      console.log('顧客:', customers.length, '名');
    }
  }

  // ---- 予約経路マスタ参照 ----
  const { data: sources } = await db.from('reservation_sources').select('*').is('organization_id', null);
  const srcWeb = sources.find((s) => s.code === 'web').id;
  const srcPhone = sources.find((s) => s.code === 'phone').id;

  // ---- レジ（get-or-create） ----
  const registers = [];
  for (const s of stores) {
    const { data: existing } = await db.from('registers')
      .select('*').eq('store_id', s.id).eq('name', 'レジ1').limit(1);
    if (existing?.length) {
      registers.push(existing[0]);
    } else {
      const [r] = await insert('registers', [{ organization_id: orgId, store_id: s.id, name: 'レジ1' }]);
      registers.push(r);
    }
  }

  // ---- 過去30日の営業データ（注文・支払・レジ・締め）— 既存注文があればスキップ ----
  if (await hasRows('orders', orgId)) {
    console.log('売上データ: 既存の注文があるためスキップ');
  } else {
    console.log('過去30日の売上データを生成中...');
    let orderCount = 0;
    const touchedCustomers = new Set();
    for (let day = 30; day >= 1; day--) {
      for (let si = 0; si < stores.length; si++) {
        const store = stores[si];
        const busDate = bd(day);
        const [session] = await insert('register_sessions', [{
          organization_id: orgId, store_id: store.id, register_id: registers[si].id,
          business_date: busDate, opened_by: staffByStore[si][0],
          opened_at: jstDate(day, 10, 30).toISOString(), opening_float: 30000,
          status: 'closed',
        }]);

        const nOrders = randInt(6, 14);
        let cashTotal = 0;
        const paymentRows = [];
        const cashTxRows = [];
        let salesTotal = 0, guestsTotal = 0;
        const breakdown = {};

        for (let o = 0; o < nOrders; o++) {
          const hour = randInt(11, 21);
          const customer = rand() < 0.55 ? customers[randInt(0, customers.length - 1)] : null;
          const staffId = pick(staffByStore[si]);
          const guests = randInt(1, 5);
          const nItems = randInt(1, 5);
          const itemRows = [];
          let gross = 0, tax = 0;
          for (let it = 0; it < nItems; it++) {
            const mi = menuItems[randInt(0, menuItems.length - 1)];
            const qty = randInt(1, 3);
            const lineTotal = mi.price * qty;
            const lineTax = lineTotal - Math.floor((lineTotal * 100) / 110);
            gross += lineTotal; tax += lineTax;
            itemRows.push({ mi, qty, lineTotal });
          }
          const [order] = await insert('orders', [{
            organization_id: orgId, store_id: store.id,
            customer_id: customer?.id ?? null,
            table_id: tablesByStore[si][randInt(0, tablesByStore[si].length - 1)].id,
            register_session_id: session.id,
            order_type: 'dine_in', status: 'paid', guest_count: guests,
            staff_id: staffId,
            subtotal: gross - tax, tax_total: tax, total: gross,
            business_date: busDate,
            opened_at: jstDate(day, hour, 0).toISOString(),
            closed_at: jstDate(day, hour + 1, 30).toISOString(),
          }]);
          await insert('order_items', itemRows.map(({ mi, qty, lineTotal }) => ({
            organization_id: orgId, store_id: store.id, order_id: order.id,
            menu_item_id: mi.id, name: mi.name, unit_price: mi.price, quantity: qty,
            tax_rate: 10, tax_included: true, line_total: lineTotal, staff_id: staffId,
          })));
          const method = pick(['cash', 'cash', 'credit', 'credit', 'qr', 'emoney']);
          paymentRows.push({
            organization_id: orgId, store_id: store.id, order_id: order.id,
            register_session_id: session.id, method, amount: gross,
            tendered: method === 'cash' ? Math.ceil(gross / 1000) * 1000 : null,
            change_amount: method === 'cash' ? Math.ceil(gross / 1000) * 1000 - gross : null,
            paid_at: jstDate(day, hour + 1, 30).toISOString(), business_date: busDate,
          });
          if (method === 'cash') {
            cashTotal += gross;
            cashTxRows.push({
              organization_id: orgId, store_id: store.id, register_session_id: session.id,
              kind: 'sale', amount: gross, purpose: `売上（注文 #${order.order_no}）`,
              order_id: order.id, business_date: busDate,
              occurred_at: jstDate(day, hour + 1, 30).toISOString(),
            });
          }
          salesTotal += gross; guestsTotal += guests;
          breakdown[method] = (breakdown[method] ?? 0) + gross;
          orderCount++;
          if (customer) touchedCustomers.add(customer.id);
        }
        await insert('payments', paymentRows);
        if (cashTxRows.length) await insert('cash_transactions', cashTxRows);

        const expected = 30000 + cashTotal;
        const diff = rand() < 0.9 ? 0 : pick([-100, -50, 50, 100]);
        await db.from('register_sessions').update({
          status: 'approved', closed_by: staffByStore[si][0],
          closed_at: jstDate(day, 23, 30).toISOString(),
          expected_cash: expected, counted_cash: expected + diff, difference: diff,
          difference_reason: diff !== 0 ? '釣銭渡し間違いの可能性' : null,
          approved_by: userIds['hq@demo.tenpo.one'],
        }).eq('id', session.id);
        await upsert('daily_closings', [{
          organization_id: orgId, store_id: store.id, business_date: busDate,
          register_session_id: session.id, sales_total: salesTotal,
          orders_count: nOrders, guests_count: guestsTotal,
          payment_breakdown: breakdown, cash_difference: diff,
          status: 'approved', closed_by: staffByStore[si][0],
          approved_by: userIds['hq@demo.tenpo.one'],
        }], 'store_id,business_date');
      }
    }
    // 顧客集計をまとめて再計算
    for (const customerId of touchedCustomers) {
      await db.rpc('recalc_customer_stats', { p_customer_id: customerId });
    }
    console.log('注文:', orderCount, '件');
  }

  // ---- 今後の予約 — DEMO-コードの既存予約があればスキップ ----
  const { data: existingDemoRes } = await db.from('reservations')
    .select('id').eq('organization_id', orgId).like('code', 'DEMO-%').limit(1);
  if (existingDemoRes?.length) {
    console.log('予約: 既存のデモ予約があるためスキップ');
  } else {
    const resRows = [];
    for (let i = 0; i < 15; i++) {
      const si = i % 3;
      const daysAhead = randInt(0, 7);
      const hour = pick([12, 13, 18, 18, 19, 19, 20]);
      const customer = customers[randInt(0, customers.length - 1)];
      const start = jstDate(-daysAhead, hour, pick([0, 30]));
      const end = new Date(start.getTime() + 120 * 60000);
      resRows.push({
        organization_id: orgId, store_id: stores[si].id, customer_id: customer.id,
        code: `DEMO-${String(1000 + i)}`,
        reserved_date: start.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
        start_at: start.toISOString(), end_at: end.toISOString(),
        party_size: randInt(2, 6), adults: 2, children: 0,
        course_id: rand() < 0.3 ? courses[0]?.id ?? null : null,
        guest_name: customer.name, guest_phone: customer.phone, guest_email: customer.email,
        allergy_note: customer.allergy_note,
        status: 'confirmed', source_id: pick([srcWeb, srcWeb, srcPhone]),
        created_via: 'web', consent_accepted: true,
        purpose: pick(['会食', '記念日', 'デート', '接待', null]),
      });
    }
    const reservations = await insert('reservations', resRows);
    for (let i = 0; i < 6; i++) {
      const r = reservations[i];
      const si = stores.findIndex((s) => s.id === r.store_id);
      await upsert('reservation_tables',
        [{ reservation_id: r.id, table_id: tablesByStore[si][i % 6].id }],
        'reservation_id,table_id');
    }
    // キャンセル・無断キャンセルの履歴例（全行同一キー）
    await insert('reservations', [{
      organization_id: orgId, store_id: stores[0].id, customer_id: customers[3].id,
      code: 'DEMO-C001', reserved_date: bd(3),
      start_at: jstDate(3, 19).toISOString(), end_at: jstDate(3, 21).toISOString(),
      party_size: 4, adults: 4, children: 0, guest_name: customers[3].name,
      guest_phone: customers[3].phone, status: 'cancelled', cancel_reason: '体調不良',
      cancelled_at: jstDate(4, 10).toISOString(), source_id: srcWeb, created_via: 'web', consent_accepted: true,
    }, {
      organization_id: orgId, store_id: stores[1].id, customer_id: customers[7].id,
      code: 'DEMO-N001', reserved_date: bd(5),
      start_at: jstDate(5, 18).toISOString(), end_at: jstDate(5, 20).toISOString(),
      party_size: 2, adults: 2, children: 0, guest_name: customers[7].name,
      guest_phone: customers[7].phone, status: 'no_show', cancel_reason: null,
      cancelled_at: null, source_id: srcPhone, created_via: 'phone', consent_accepted: true,
    }]);
    console.log('予約:', reservations.length + 2, '件');
  }

  // ---- 勤怠（過去14日）— 既存があればスキップ ----
  if (await hasRows('time_entries', orgId)) {
    console.log('勤怠: 既存データがあるためスキップ');
  } else {
    const timeRows = [];
    for (let day = 14; day >= 1; day--) {
      for (let si = 0; si < stores.length; si++) {
        for (const uid of staffByStore[si]) {
          if (rand() < 0.25) continue; // 休み
          const inH = pick([10, 11, 16]);
          const hours = randInt(5, 9);
          timeRows.push({
            organization_id: orgId, store_id: stores[si].id, profile_id: uid,
            work_date: bd(day),
            clock_in_at: jstDate(day, inH, randInt(0, 15)).toISOString(),
            clock_out_at: jstDate(day, inH + hours, randInt(0, 30)).toISOString(),
            break_minutes: hours >= 7 ? 60 : 30,
            status: 'approved', source: 'shared_terminal',
            approved_by: staffByStore[si][0],
          });
        }
      }
    }
    await insert('time_entries', timeRows);
    console.log('勤怠:', timeRows.length, '件');
  }

  // ---- 給与ルール・歩合 — 既存があればスキップ ----
  if (await hasRows('payroll_rules', orgId)) {
    console.log('給与ルール: 既存データがあるためスキップ');
  } else {
    const payrollDefs = [
      ['shibuya@demo.tenpo.one', 'monthly', 320000], ['shinjuku@demo.tenpo.one', 'monthly', 320000],
      ['yokohama@demo.tenpo.one', 'monthly', 300000], ['staff1@demo.tenpo.one', 'hourly', 1300],
      ['staff2@demo.tenpo.one', 'hourly', 1150], ['staff3@demo.tenpo.one', 'hourly', 1300],
    ];
    await insert('payroll_rules', payrollDefs.map(([email, payType, base]) => ({
      organization_id: orgId, profile_id: userIds[email],
      pay_type: payType, base_amount: base, commute_allowance: 500,
      allowances: payType === 'monthly' ? [{ name: '役職手当', amount: 30000, per: 'month' }] : [],
    })));
    await insert('commission_rules', [{
      organization_id: orgId, name: '個人売上歩合 2%',
      target_type: 'personal_sales', method: 'rate', rate: 2.0, fixed_amount: null, basis: 'tax_excluded',
    }, {
      organization_id: orgId, name: '店舗月間目標達成ボーナス',
      target_type: 'store_target', method: 'fixed', rate: null, fixed_amount: 10000, basis: 'tax_excluded',
    }]);
    console.log('給与・歩合ルール: 作成');
  }

  // ---- 勘定科目（upsert）・小口現金 ----
  const accounts = await upsert('expense_accounts', [
    { organization_id: orgId, code: '511', name: '食材費', sort_order: 1 },
    { organization_id: orgId, code: '521', name: '消耗品費', sort_order: 2 },
    { organization_id: orgId, code: '531', name: '水道光熱費', sort_order: 3 },
    { organization_id: orgId, code: '541', name: '修繕費', sort_order: 4 },
    { organization_id: orgId, code: '599', name: '雑費', sort_order: 5 },
  ], 'organization_id,code');

  const hasPetty = await hasRows('cash_transactions', orgId, (q) => q.in('kind', ['petty_in', 'petty_out']));
  if (hasPetty) {
    console.log('小口現金: 既存データがあるためスキップ');
  } else {
    const pettyRows = [];
    for (let day = 20; day >= 1; day -= 2) {
      const si = day % 3;
      pettyRows.push({
        organization_id: orgId, store_id: stores[si].id,
        kind: 'petty_out', amount: randInt(5, 40) * 100,
        purpose: pick(['洗剤・スポンジ購入', '急ぎの食材買い出し', '電球交換', 'ゴミ袋購入']),
        expense_account_id: pick(accounts).id,
        approval_status: day <= 4 ? 'pending' : 'approved',
        approved_by: day <= 4 ? null : userIds['keiri@demo.tenpo.one'],
        business_date: bd(day), occurred_at: jstDate(day, 15).toISOString(),
        created_by: staffByStore[si][0],
      });
    }
    await insert('cash_transactions', pettyRows);
    console.log('小口現金:', pettyRows.length, '件');
  }

  // ---- 仕入先・請求書 — 既存があればスキップ ----
  if (await hasRows('vendors', orgId)) {
    console.log('仕入先・請求書: 既存データがあるためスキップ');
  } else {
    const vendors = await insert('vendors', [
      { organization_id: orgId, name: '株式会社築地フーズ', contact_name: '営業部 大森', phone: '03-5555-1111', closing_day: 31, payment_day: 25, note: '鮮魚・青果' },
      { organization_id: orgId, name: '東京酒販株式会社', contact_name: '担当 三浦', phone: '03-5555-2222', closing_day: 20, payment_day: 10, note: '酒類全般' },
      { organization_id: orgId, name: 'クリーンサービス関東', contact_name: null, phone: '03-5555-3333', closing_day: 31, payment_day: 31, note: '清掃・リネン' },
      { organization_id: orgId, name: '厨房機器メンテ株式会社', contact_name: null, phone: '045-555-4444', closing_day: 31, payment_day: 25, note: '厨房機器保守' },
    ]);
    const invoiceStatuses = ['open', 'review', 'approved', 'scheduled', 'paid', 'paid', 'open', 'approved'];
    await insert('invoices', invoiceStatuses.map((status, i) => {
      const amount = randInt(30, 300) * 1000;
      return {
        organization_id: orgId, store_id: stores[i % 3].id,
        vendor_id: vendors[i % 4].id, vendor_name: vendors[i % 4].name,
        invoice_no: `INV-2026-${String(100 + i)}`,
        issue_date: bd(20 - i), due_date: bd(i - 15),
        amount, tax_amount: Math.floor((amount * 10) / 110),
        registration_number: `T12345678901${String(10 + i)}`,
        payment_method: 'bank_transfer', status,
        paid_at: status === 'paid' ? bd(2) : null,
        assignee_id: userIds['keiri@demo.tenpo.one'],
      };
    }));
    console.log('請求書: 8件 / 仕入先: 4件');
  }

  // ---- 在庫 — 既存があればスキップ ----
  if (await hasRows('inventory_items', orgId)) {
    console.log('在庫: 既存データがあるためスキップ');
  } else {
    const beer = menuItems.find((m) => m.name === '生ビール');
    for (let si = 0; si < stores.length; si++) {
      await insert('inventory_items', [
        { organization_id: orgId, store_id: stores[si].id, name: '生ビール樽 10L', item_kind: 'product', unit: '樽', current_quantity: randInt(2, 6), reorder_point: 2, avg_cost: 6500, menu_item_id: beer?.id ?? null },
        { organization_id: orgId, store_id: stores[si].id, name: '米 10kg', item_kind: 'ingredient', unit: '袋', current_quantity: randInt(3, 8), reorder_point: 3, avg_cost: 4200, menu_item_id: null },
        { organization_id: orgId, store_id: stores[si].id, name: '醤油 1.8L', item_kind: 'ingredient', unit: '本', current_quantity: randInt(2, 10), reorder_point: 2, avg_cost: 780, menu_item_id: null },
        { organization_id: orgId, store_id: stores[si].id, name: 'おしぼり', item_kind: 'supply', unit: '箱', current_quantity: randInt(1, 5), reorder_point: 2, avg_cost: 1200, menu_item_id: null },
        { organization_id: orgId, store_id: stores[si].id, name: '割り箸', item_kind: 'supply', unit: '袋', current_quantity: randInt(5, 20), reorder_point: 5, avg_cost: 350, menu_item_id: null },
      ]);
    }
    console.log('在庫: 各店5品目');
  }

  // ---- 顧客タグ — 既存があればスキップ ----
  if (await hasRows('customer_tags', orgId)) {
    console.log('顧客タグ: 既存データがあるためスキップ');
  } else {
    const tags = await insert('customer_tags', [
      { organization_id: orgId, name: '常連', color: '#7B3FF2' },
      { organization_id: orgId, name: 'VIP', color: '#F59E0B' },
      { organization_id: orgId, name: '要注意', color: '#EF4444' },
    ]);
    await upsert('customer_tag_links', [
      { customer_id: customers[0].id, tag_id: tags[0].id },
      { customer_id: customers[1].id, tag_id: tags[0].id },
      { customer_id: customers[2].id, tag_id: tags[1].id },
    ], 'customer_id,tag_id');
  }

  console.log('=== 完了 ===');
  console.log(`ログイン: owner@demo.tenpo.one / ${DEMO_PASSWORD}（他アカウントも同一パスワード）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
