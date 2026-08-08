/**
 * TENPO ONE v0.4.3 — 専用テスト企業（PILOT）セットアップ・共有ヘルパー（VER-D4）
 *
 * verify-flow.mjs / verify-accounting-consistency.mjs と同じ流儀（get-or-create / upsert
 * で冪等・service role は準備専用・実ユーザーは anon ログインでRLS適用）に揃えている。
 *
 * デモ企業（is_demo=true）は一切触らない。専用テスト企業
 * 「[PILOT] TENPO ONE検証企業」（is_demo=false）でのみ動作する。
 * このテスト企業はメンバー以外アクセス不可（RLS: app_is_org_member）のため、
 * 通常のデモユーザーやテナントからは自然に不可視。
 *
 * verify-store-day.mjs（1日シミュレーション）に加え、後続の week/month 検証スクリプトも
 * ここから ensurePilotOrg() / cleanupPilotDay() / loginPilotUser() を import して使う想定。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const PILOT_PASSWORD = process.env.DEMO_PASSWORD || 'TenpoOne-Demo1!';
if (!url || !anonKey || !serviceKey) {
  throw new Error('環境変数（URL / ANON_KEY / SERVICE_ROLE_KEY）を設定してください');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

export const PILOT_ORG_NAME = '[PILOT] TENPO ONE検証企業';
export const PILOT_STORE_SLUG = 'pilot-shinjuku';
export const PILOT_STORE_NAME = 'TENPO ONE 新宿店';

/** anonクライアントでログイン（実ユーザー・RLS適用状態）。verify-flow.mjs と同一パターン */
export async function loginPilotUser(email) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PILOT_PASSWORD });
  if (error) throw new Error(`ログイン失敗 ${email}: ${error.message}`);
  return c;
}

async function insert(table, rows) {
  const { data, error } = await admin.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}
async function upsert(table, rows, onConflict) {
  const { data, error } = await admin.from(table).upsert(rows, { onConflict }).select();
  if (error) throw new Error(`${table} (upsert): ${error.message}`);
  return data;
}

/** authユーザーのget-or-create（メール重複時は既存を再利用）。seed.mjs と同一パターン */
async function ensureUser(email, name, kana, pin) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PILOT_PASSWORD, email_confirm: true,
    user_metadata: { display_name: name, display_name_kana: kana },
  });
  let userId;
  if (error) {
    if (/already|exists|registered/i.test(error.message)) {
      const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
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
  const { error: profileError } = await admin.from('profiles')
    .update({ pin_code: pin, display_name: name, display_name_kana: kana })
    .eq('id', userId);
  if (profileError) throw new Error(`profiles ${email}: ${profileError.message}`);
  return userId;
}

/**
 * 専用テスト企業一式のget-or-create（全項目冪等）。
 * 返り値は後続スクリプト（verify-store-day.mjs 等）が使う参照データ一式。
 */
export async function ensurePilotOrg() {
  // ---- 企業 ----
  let org;
  {
    const { data } = await admin.from('organizations').select('*').eq('name', PILOT_ORG_NAME).limit(1);
    if (data?.length) {
      org = data[0];
    } else {
      [org] = await insert('organizations', [{
        name: PILOT_ORG_NAME, name_kana: 'テンポワンケンショウキギョウ',
        plan_code: 'standard', status: 'active',
        contact_email: 'pilot@test.tenpo.one', is_demo: false,
        onboarding: { completed: true },
      }]);
    }
  }
  const orgId = org.id;

  // ---- 店舗 ----
  let store;
  {
    const { data } = await admin.from('stores').select('*').eq('slug', PILOT_STORE_SLUG).limit(1);
    if (data?.length) {
      store = data[0];
    } else {
      [store] = await insert('stores', [{
        organization_id: orgId, slug: PILOT_STORE_SLUG, name: PILOT_STORE_NAME,
        address: '東京都新宿区西新宿1-1-1 検証ビル1F', phone: '03-0000-9001',
        seat_count: 50, booking_enabled: true,
        description: '[PILOT] 1日営業シミュレーション用の検証店舗です。',
      }]);
    }
  }
  const storeId = store.id;

  // 店舗設定: 営業17:00-翌02:00 / 営業日切替は朝5時（深夜勤務・深夜会計は同一営業日扱い）
  // 予約枠生成（get_booking_availability）はカレンダー日内のみを対象とするため、
  // 予約可能時間帯はその範囲に収まる 17:00-23:00（ラストオーダー相当）に単純化している。
  // 深夜0時-2時台の営業はPOS側（app_business_date）でのみ扱う設計。
  const [storeSettings] = await upsert('store_settings', [{
    organization_id: orgId, store_id: storeId,
    slot_minutes: 30, default_stay_minutes: 90, booking_cutoff_minutes: 0,
    booking_window_days: 30, max_party_size: 10, cancel_deadline_hours: 3,
    business_day_start_hour: 5, cleaning_buffer_minutes: 10, allow_negative_stock: true,
    receipt_header: `${store.name}\n${store.address}`,
    receipt_footer: '[PILOT] 検証データです',
  }], 'store_id');

  for (let dow = 0; dow <= 6; dow++) {
    await upsert('business_hours', [{
      organization_id: orgId, store_id: storeId, day_of_week: dow,
      is_closed: false, open_time: '17:00', close_time: '23:59', last_entry_time: '23:00',
    }], 'store_id,day_of_week');
  }

  // ---- テーブル15卓 ----
  let tables;
  {
    const { data: existing } = await admin.from('restaurant_tables')
      .select('*').eq('store_id', storeId).eq('status', 'active').order('sort_order');
    if (existing?.length >= 15) {
      tables = existing;
    } else {
      let floor;
      const { data: existingFloor } = await admin.from('floors')
        .select('*').eq('store_id', storeId).eq('name', '1F').limit(1);
      if (existingFloor?.length) {
        floor = existingFloor[0];
      } else {
        [floor] = await insert('floors', [{ organization_id: orgId, store_id: storeId, name: '1F', sort_order: 1 }]);
      }
      const defs = [];
      for (let i = 1; i <= 15; i++) {
        defs.push({
          organization_id: orgId, store_id: storeId, floor_id: floor.id,
          name: `T${i}`, capacity_min: 1, capacity_max: i % 5 === 0 ? 8 : 4,
          is_private_room: i % 5 === 0, is_counter: i % 7 === 0, smoking_allowed: false,
          sort_order: i,
        });
      }
      tables = await insert('restaurant_tables', defs);
    }
  }

  // ---- レジ4台 ----
  const registerDefs = ['レジ01', 'レジ02', 'テイクアウトレジ', 'モバイルPOS'];
  const registers = [];
  for (const name of registerDefs) {
    const { data: existing } = await admin.from('registers')
      .select('*').eq('store_id', storeId).eq('name', name).limit(1);
    if (existing?.length) {
      registers.push(existing[0]);
    } else {
      const [r] = await insert('registers', [{ organization_id: orgId, store_id: storeId, name }]);
      registers.push(r);
    }
  }

  // ---- 税率 ----
  let taxRates;
  {
    const { data: existing } = await admin.from('tax_rates')
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
  const tax10 = taxRates.find((t) => Number(t.rate) === 10);

  // ---- メニュー約15品（うち2品はmenu_item直結在庫・3品はレシピ付き） ----
  let menuItems;
  {
    const { data: existing } = await admin.from('menu_items')
      .select('*').eq('organization_id', orgId).eq('status', 'active').order('sort_order');
    if (existing?.length >= 15) {
      menuItems = existing;
    } else {
      const catDefs = [['前菜', '#7B3FF2'], ['メイン', '#5A2ED6'], ['ご飯・麺', '#0EA5E9'], ['デザート', '#F59E0B'], ['ドリンク', '#10B981']];
      let cats;
      const { data: existingCats } = await admin.from('menu_categories')
        .select('*').eq('organization_id', orgId).eq('status', 'active');
      if (existingCats?.length >= catDefs.length) {
        cats = existingCats;
      } else {
        cats = await insert('menu_categories', catDefs.map(([name, color], i) => ({
          organization_id: orgId, name, color, sort_order: i + 1,
        })));
      }
      const menuDefs = [
        ['前菜', '季節の前菜盛り合わせ', 980, 350],
        ['前菜', '自家製ポテトサラダ', 580, 150],
        ['前菜', '枝豆', 380, 80],
        ['メイン', '和牛ハンバーグ', 1680, 620],
        ['メイン', '鶏の唐揚げ', 880, 280],
        ['メイン', '本日の刺身盛り', 1480, 600],
        ['ご飯・麺', '土鍋ご飯', 780, 200],
        ['ご飯・麺', '〆の醤油ラーメン', 880, 260],
        ['デザート', '抹茶プリン', 580, 150],
        ['デザート', '本日のアイス', 480, 100],
        ['ドリンク', '生ビール', 650, 200],
        ['ドリンク', 'グラスワイン', 680, 250],
        ['ドリンク', 'ハイボール', 550, 120],
        ['ドリンク', 'ウーロン茶', 380, 50],
        ['ドリンク', '日本酒（一合）', 780, 300],
      ];
      menuItems = await insert('menu_items', menuDefs.map(([cat, name, price, cost], i) => ({
        organization_id: orgId,
        category_id: cats.find((c) => c.name === cat).id,
        name, price, cost,
        takeout_price: cat === 'ドリンク' ? null : price,
        item_type: cat === 'ドリンク' ? 'drink' : 'food',
        tax_rate_id: tax10.id,
        sort_order: i + 1,
      })));
    }
  }
  const menuByName = Object.fromEntries(menuItems.map((m) => [m.name, m]));

  // ---- 在庫品目: 直結2品（生ビール・グラスワイン）+ レシピ用食材3品 + 未使用の消耗品2品 ----
  async function ensureInventoryItem(def) {
    const { data: existing } = await admin.from('inventory_items')
      .select('*').eq('store_id', storeId).eq('name', def.name).limit(1);
    if (existing?.length) return existing[0];
    const [item] = await insert('inventory_items', [{ organization_id: orgId, store_id: storeId, ...def }]);
    return item;
  }
  const invBeer = await ensureInventoryItem({
    name: '生ビールサーバー', item_kind: 'product', unit: '杯',
    current_quantity: 1000, reorder_point: 50, avg_cost: 200, menu_item_id: menuByName['生ビール'].id,
  });
  const invWine = await ensureInventoryItem({
    name: 'グラスワインボトル', item_kind: 'product', unit: '杯',
    current_quantity: 800, reorder_point: 40, avg_cost: 250, menu_item_id: menuByName['グラスワイン'].id,
  });
  const invChicken = await ensureInventoryItem({
    name: '鶏もも肉', item_kind: 'ingredient', unit: 'g',
    current_quantity: 50000, reorder_point: 3000, avg_cost: 2, menu_item_id: null,
  });
  const invBeef = await ensureInventoryItem({
    name: '牛ひき肉', item_kind: 'ingredient', unit: 'g',
    current_quantity: 50000, reorder_point: 3000, avg_cost: 3, menu_item_id: null,
  });
  const invFish = await ensureInventoryItem({
    name: '本日の鮮魚', item_kind: 'ingredient', unit: 'g',
    current_quantity: 30000, reorder_point: 2000, avg_cost: 4, menu_item_id: null,
  });
  const invOshibori = await ensureInventoryItem({
    name: 'おしぼり', item_kind: 'supply', unit: '本',
    current_quantity: 2000, reorder_point: 200, avg_cost: 10, menu_item_id: null,
  });
  const invWaribashi = await ensureInventoryItem({
    name: '割り箸', item_kind: 'supply', unit: '膳',
    current_quantity: 3000, reorder_point: 300, avg_cost: 5, menu_item_id: null,
  });

  // レシピ（唐揚げ200g・ハンバーグ150g・刺身盛り120g / 1食）
  async function ensureRecipe(menuItemId, inventoryItemId, quantity) {
    const [row] = await upsert('menu_item_ingredients',
      [{ organization_id: orgId, menu_item_id: menuItemId, inventory_item_id: inventoryItemId, quantity }],
      'menu_item_id,inventory_item_id');
    return row;
  }
  await ensureRecipe(menuByName['鶏の唐揚げ'].id, invChicken.id, 200);
  await ensureRecipe(menuByName['和牛ハンバーグ'].id, invBeef.id, 150);
  await ensureRecipe(menuByName['本日の刺身盛り'].id, invFish.id, 120);

  // ---- スタッフ8名 ----
  const usersDef = [
    ['pilot-owner@test.tenpo.one', '検証 オーナー', 'ケンショウ オーナー', 'org_owner', '9001'],
    ['pilot-manager@test.tenpo.one', '検証 店長', 'ケンショウ テンチョウ', 'store_manager', '9002'],
    ['pilot-staff1@test.tenpo.one', '検証 社員1', 'ケンショウ シャイン1', 'staff', '9011'],
    ['pilot-staff2@test.tenpo.one', '検証 社員2', 'ケンショウ シャイン2', 'staff', '9012'],
    ['pilot-staff3@test.tenpo.one', '検証 社員3', 'ケンショウ シャイン3', 'staff', '9013'],
    ['pilot-parttime1@test.tenpo.one', '検証 バイト1', 'ケンショウ バイト1', 'part_time', '9021'],
    ['pilot-parttime2@test.tenpo.one', '検証 バイト2', 'ケンショウ バイト2', 'part_time', '9022'],
    ['pilot-parttime3@test.tenpo.one', '検証 バイト3', 'ケンショウ バイト3', 'part_time', '9023'],
  ];
  const staff = {};
  for (const [email, name, kana, role, pin] of usersDef) {
    const uid = await ensureUser(email, name, kana, pin);
    const [m] = await upsert('memberships',
      [{ organization_id: orgId, profile_id: uid, role, status: 'active' }],
      'organization_id,profile_id');
    if (role !== 'org_owner') {
      await upsert('membership_stores',
        [{ membership_id: m.id, store_id: storeId, is_primary: true }],
        'membership_id,store_id');
    }
    const key = email.split('@')[0].replace('pilot-', '');
    staff[key] = { id: uid, email, role, membershipId: m.id };
  }

  // ---- 給与ルール（時給+深夜/残業割増は既定値）・歩合（社員1に1件） ----
  if (!(await hasRows('payroll_rules', orgId))) {
    const payrollDefs = [
      ['manager', 1800], ['staff1', 1300], ['staff2', 1300], ['staff3', 1300],
      ['parttime1', 1150], ['parttime2', 1150], ['parttime3', 1150],
    ];
    await insert('payroll_rules', payrollDefs.map(([key, base]) => ({
      organization_id: orgId, profile_id: staff[key].id, store_id: storeId,
      pay_type: 'hourly', base_amount: base, commute_allowance: 300, allowances: [],
    })));
  }
  if (!(await hasRows('commission_rules', orgId))) {
    await insert('commission_rules', [{
      organization_id: orgId, store_id: storeId, profile_id: staff.staff1.id,
      name: '個人売上歩合 2%（検証）', target_type: 'personal_sales', method: 'rate',
      rate: 2.0, fixed_amount: null, basis: 'tax_excluded',
    }]);
  }
  async function hasRows(table, orgId) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
    return (count ?? 0) > 0;
  }

  // ---- 会員ポイント設定（有効化） ----
  await upsert('loyalty_settings',
    [{ organization_id: orgId, enabled: true, yen_per_point: 100, point_value: 1 }],
    'organization_id');

  // ---- 標準勘定科目導入（冪等・owner権限で） ----
  const ownerClient = await loginPilotUser('pilot-owner@test.tenpo.one');
  await ownerClient.rpc('install_standard_accounts', { p_org: orgId });

  // ---- 固定クーポン（get-or-create。金額固定¥300引き） ----
  const [coupon] = await upsert('coupons', [{
    organization_id: orgId, code: 'PILOTFIXED300', name: '[PILOT] 固定検証クーポン',
    kind: 'fixed', value: 300, min_total: 0, status: 'active',
  }], 'organization_id,code');

  // ---- 顧客プール24名（get-or-createを電話番号で固定。予約・会計・ポイントで使い回す） ----
  const customerDefs = [];
  const lastNames = ['山田', '佐々木', '井上', '木村', '林', '清水', '森', '池田'];
  const firstNames = ['翔太', '陽菜', '大輝', 'さくら', '悠斗', '美優', '拓海', '葵'];
  for (let i = 0; i < 24; i++) {
    customerDefs.push({
      phone: `0800${String(1000000 + i).padStart(7, '0')}`,
      name: `${lastNames[i % 8]} ${firstNames[(i * 3) % 8]}${i}`,
    });
  }
  const customers = [];
  for (const def of customerDefs) {
    const { data: existing } = await admin.from('customers')
      .select('*').eq('organization_id', orgId).eq('phone', def.phone).limit(1);
    if (existing?.length) {
      customers.push(existing[0]);
    } else {
      const [c] = await insert('customers', [{
        organization_id: orgId, primary_store_id: storeId, name: def.name, phone: def.phone,
      }]);
      customers.push(c);
    }
  }

  // ---- QRテーブルトークン: restaurant_tables.qr_token はDB既定値で自動採番済み ----

  return {
    org, store, storeSettings,
    tables, registers, taxRates, tax10,
    menuItems, menuByName,
    inventory: {
      beer: invBeer, wine: invWine, chicken: invChicken, beef: invBeef, fish: invFish,
      oshibori: invOshibori, waribashi: invWaribashi,
    },
    staff, coupon, customers,
  };
}

/**
 * 指定営業日の取引データをservice roleで後片付けする（テスト企業専用）。
 *
 * 冪等性の設計判断（重要）:
 *  - payments / refunds は DBトリガー（00003_rls.sql: prevent_payment_delete /
 *    00025_refund_consistency.sql: prevent_refund_mutation）により無条件で物理削除できない。
 *    orders も status in ('paid','refunded') の間は物理削除できない
 *    （00003_rls.sql: prevent_paid_mutation）。よって一度会計が成立した注文・支払・返金・
 *    それに紐づく cash_transactions（kind=sale/refund）・register_sessions は原理的に
 *    削除不可能（「order毎の削除順序を工夫」しても回避不可＝トリガーは条件なしで拒否する）。
 *  - そのため「累積許容」方式を採用する: 会計成立済みデータは削除せず残す。
 *    その代わり verify-store-day.mjs 側の照合は常にDBクエリで再集計した実測値どうしを
 *    比較する（verify-accounting-consistency.mjs の computeDailyAggregates と同じ思想）ため、
 *    同一営業日に複数回実行して累積しても1円単位の整合性は崩れない
 *    （レジ単位の現金照合は毎回新規openするregister_session_idにスコープされるため
 *    そもそも累積の影響を受けない）。
 *  - 「日付をずらす」方式は、対象営業日=今日が要件のため採用していない。
 *  - 削除できる範囲（未会計open注文・void/cancelled注文・予約・勤怠・発注に紐付かない
 *    在庫移動・注文/返金に紐付かない現金台帳・daily_closings/daily_reportsのスナップショット）
 *    は物理削除して再実行時にクリーンな状態から積み上げられるようにする。
 *  - open状態で残っているレジセッションは（クラッシュ後の再実行に備えて）削除ではなく
 *    強制closeして「1レジ1open」制約を再実行前に解放する。
 */
export async function cleanupPilotDay(orgId, businessDate) {
  const report = { deleted: {}, skipped: {}, retained: {}, note: '' };

  const { data: stores } = await admin.from('stores').select('id').eq('organization_id', orgId);
  const storeIds = (stores ?? []).map((s) => s.id);
  if (!storeIds.length) {
    report.note = '店舗が存在しません（ensurePilotOrg未実行）';
    return report;
  }

  // 1) クラッシュ後の再実行に備え、開きっぱなしのレジセッションを強制close（削除ではない）
  {
    const { data: closedNow, error } = await admin.from('register_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .in('store_id', storeIds).eq('status', 'open').select('id');
    report.deleted.forceClosedOpenSessions = error ? 0 : (closedNow?.length ?? 0);
  }

  // 2) 未会計（open）注文と、void/cancelled注文（物理削除可）を削除
  for (const status of ['open', 'void', 'cancelled']) {
    const { data: ordersToDelete } = await admin.from('orders').select('id')
      .in('store_id', storeIds).eq('business_date', businessDate).eq('status', status);
    const ids = (ordersToDelete ?? []).map((o) => o.id);
    if (!ids.length) continue;
    await admin.from('coupon_redemptions').delete().in('order_id', ids);
    await admin.from('stock_movements').delete().in('ref_order_id', ids);
    await admin.from('order_items').delete().in('order_id', ids);
    const { error: eDel } = await admin.from('orders').delete().in('id', ids);
    if (eDel) {
      report.skipped[`orders_${status}`] = `${ids.length}件 (${eDel.message})`;
    } else {
      report.deleted[`orders_${status}`] = ids.length;
    }
  }

  // 3) 予約（reservation_tables → reservations）
  {
    const { data: resRows } = await admin.from('reservations').select('id')
      .in('store_id', storeIds).eq('reserved_date', businessDate);
    const ids = (resRows ?? []).map((r) => r.id);
    if (ids.length) {
      await admin.from('reservation_tables').delete().in('reservation_id', ids);
      const { error } = await admin.from('reservations').delete().in('id', ids);
      report.deleted.reservations = error ? 0 : ids.length;
      if (error) report.skipped.reservations = `${ids.length}件 (${error.message})`;
    }
  }

  // 4) 勤怠（time_entry_events → time_entries）
  {
    const { data: teRows } = await admin.from('time_entries').select('id')
      .in('store_id', storeIds).eq('work_date', businessDate);
    const ids = (teRows ?? []).map((t) => t.id);
    if (ids.length) {
      await admin.from('time_entry_events').delete().in('time_entry_id', ids);
      const { error } = await admin.from('time_entries').delete().in('id', ids);
      report.deleted.timeEntries = error ? 0 : ids.length;
      if (error) report.skipped.timeEntries = `${ids.length}件 (${error.message})`;
    }
  }

  // 5) 注文に紐付かない在庫移動（in/waste/count_adjust等の手動分。sale/returnはref_order_id必須
  //    ＝会計済み注文にしか発生しないため自動的に対象外になる）
  {
    const { error, count } = await admin.from('stock_movements')
      .delete({ count: 'exact' })
      .in('store_id', storeIds).eq('business_date', businessDate).is('ref_order_id', null);
    report.deleted.manualStockMovements = error ? 0 : (count ?? 0);
  }

  // 6) 注文・返金に紐付かない現金台帳（小口現金・入出金の手動分）
  {
    const { error, count } = await admin.from('cash_transactions')
      .delete({ count: 'exact' })
      .in('store_id', storeIds).eq('business_date', businessDate)
      .is('order_id', null).is('refund_id', null)
      .in('kind', ['petty_in', 'petty_out', 'deposit', 'withdrawal', 'adjustment']);
    report.deleted.manualCashTransactions = error ? 0 : (count ?? 0);
  }

  // 7) 締めスナップショット（自由に削除可・再実行時に close_store_day 等で再生成される）
  {
    const { error: e1 } = await admin.from('daily_closings').delete()
      .in('store_id', storeIds).eq('business_date', businessDate);
    const { error: e2 } = await admin.from('daily_reports').delete()
      .in('store_id', storeIds).eq('business_date', businessDate);
    report.deleted.dailyClosings = e1 ? 'skip' : 'ok';
    report.deleted.dailyReports = e2 ? 'skip' : 'ok';
  }

  // 8) 削除不能で残置される会計済みデータ件数を報告（累積許容方式）
  {
    const { count: paidCount } = await admin.from('orders')
      .select('id', { count: 'exact', head: true })
      .in('store_id', storeIds).eq('business_date', businessDate).in('status', ['paid', 'refunded']);
    const { count: refundCount } = await admin.from('refunds')
      .select('id', { count: 'exact', head: true })
      .in('store_id', storeIds).eq('business_date', businessDate);
    report.retained.paidOrRefundedOrders = paidCount ?? 0;
    report.retained.refunds = refundCount ?? 0;
  }

  report.note = 'payments/refunds/会計済みorders・関連cash_transactions(sale/refund)・関連'
    + 'register_sessionsはDBトリガーにより物理削除不可のため「累積許容」方式で残置。'
    + '照合は常にDBクエリの実測値どうしの比較で行うため、累積があっても1円単位で一致する。';

  return report;
}
