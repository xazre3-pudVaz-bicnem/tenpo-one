import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNTS, DEMO_PASSWORD, hasEnv, login } from './helpers';

/**
 * v0.4.2 返金フローE2E（UI検証）。
 * CASE1: ¥10,000会計 → ¥3,000部分返金 → 純売上¥7,000表示
 * CASE2: 部分返金 → レジ締め（締め履歴に純売上snapshot）
 * CASE3: 返金 → 自動仕訳（売上返金ソースの表示）
 * CASE4: 返金 → 顧客LTV（累計利用額が純額へ減算）
 * CASE5: 商品返金（在庫戻しあり）→ 在庫増加
 * CASE6: 商品返金（在庫戻しなし）→ 在庫不変
 * ※ 同時実行レース・月次締め連動はDB層で決定的に検証する
 *    scripts/verify-accounting-consistency.mjs 側でカバーする。
 */
const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
test.skip(!hasEnv || !hasServiceKey, 'Supabase環境変数（service key含む）が未設定のためスキップ');
test.describe.configure({ mode: 'serial' });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let admin: SupabaseClient;
let mgr: SupabaseClient;
let orgId: string;
let storeId: string;
let sessionId: string;

/** 検証用の会計済み注文を作成する（実RPC・実RLSで実行） */
async function createPaidOrder(
  items: { menuItemId?: string | null; name: string; unitPrice: number; quantity: number }[],
  customerId?: string
): Promise<{ orderId: string; total: number }> {
  const { data: userRes } = await mgr.auth.getUser();
  const staffId = userRes.user!.id;
  const { data: orderRows, error: e1 } = await mgr
    .from('orders')
    .insert({
      organization_id: orgId,
      store_id: storeId,
      order_type: 'dine_in',
      guest_count: 2,
      staff_id: staffId,
      customer_id: customerId ?? null,
    })
    .select();
  if (e1) throw new Error(`order insert: ${e1.message}`);
  const orderId = orderRows![0].id as string;

  const { error: e2 } = await mgr.from('order_items').insert(
    items.map((it) => ({
      organization_id: orgId,
      store_id: storeId,
      order_id: orderId,
      menu_item_id: it.menuItemId ?? null,
      name: it.name,
      unit_price: it.unitPrice,
      quantity: it.quantity,
      tax_rate: 10,
      tax_included: true,
      line_total: it.unitPrice * it.quantity,
      staff_id: staffId,
    }))
  );
  if (e2) throw new Error(`items insert: ${e2.message}`);

  await mgr.rpc('recalc_order_totals', { p_order_id: orderId });
  const { data: calced } = await mgr.from('orders').select('total').eq('id', orderId).single();
  const total = calced!.total as number;

  const { error: e3 } = await mgr.rpc('finalize_order', {
    p_order_id: orderId,
    p_register_session_id: sessionId,
    p_payments: [{ method: 'cash', amount: total }],
  });
  if (e3) throw new Error(`finalize: ${e3.message}`);
  return { orderId, total };
}

test.beforeAll(async () => {
  admin = createClient(URL, SERVICE);
  mgr = createClient(URL, ANON);
  const { error: loginErr } = await mgr.auth.signInWithPassword({
    email: ACCOUNTS.shibuyaManager,
    password: DEMO_PASSWORD,
  });
  if (loginErr) throw new Error(`login: ${loginErr.message}`);

  const { data: orgs } = await admin.from('organizations').select('id').eq('is_demo', true).limit(1);
  orgId = orgs![0].id;
  const { data: stores } = await admin.from('stores').select('id').eq('slug', 'tenpoone-shibuya').limit(1);
  storeId = stores![0].id;

  // 開いているレジセッションを取得（無ければ開局）
  const { data: registers } = await admin.from('registers').select('id').eq('store_id', storeId).limit(1);
  const registerId = registers![0].id;
  const { data: openSessions } = await admin
    .from('register_sessions')
    .select('id')
    .eq('register_id', registerId)
    .eq('status', 'open')
    .limit(1);
  if (openSessions && openSessions.length > 0) {
    sessionId = openSessions[0].id;
  } else {
    const { data: opened, error } = await mgr.rpc('open_register_session', {
      p_store_id: storeId,
      p_register_id: registerId,
      p_opening_float: 30000,
    });
    if (error) throw new Error(`open register: ${error.message}`);
    sessionId = opened.session_id;
  }
});

test('CASE1: ¥10,000会計 → ¥3,000部分返金 → 純売上¥7,000', async ({ page }) => {
  const { orderId, total } = await createPaidOrder([
    { name: '[E2E] コース料理', unitPrice: 5000, quantity: 2 },
  ]);
  expect(total).toBe(10000);

  await login(page, ACCOUNTS.shibuyaManager);
  await page.goto(`/app/orders/${orderId}`);
  await expect(page.getByText('総売上（元取引）')).toBeVisible();

  await page.getByRole('button', { name: '返金・取消する' }).click();
  await expect(page.getByText('返金可能額: ¥10,000')).toBeVisible();
  await page.getByLabel('返金額').fill('3000');
  await page.getByLabel(/理由/).fill('[E2E] 部分返金テスト');
  await page.getByRole('button', { name: '返金を確定' }).click();
  await expect(page.getByText('返金を記録しました')).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByText('返金合計')).toBeVisible();
  await expect(page.getByText('純売上')).toBeVisible();
  await expect(page.getByText('¥7,000').first()).toBeVisible();

  // 元取引は上書きされない（gross保持・statusはpaidのまま）
  const { data: after } = await admin.from('orders').select('total, status').eq('id', orderId).single();
  expect(after!.total).toBe(10000);
  expect(after!.status).toBe('paid');
});

test('CASE4: 返金 → 顧客LTVが純額へ減算される', async ({ page }) => {
  const { data: custRows } = await admin
    .from('customers')
    .insert({
      organization_id: orgId,
      name: '[E2E] 返金検証顧客',
      name_kana: 'ヘンキンケンショウ',
      created_by: null,
    })
    .select();
  const customerId = custRows![0].id as string;

  const { orderId } = await createPaidOrder(
    [{ name: '[E2E] ランチ', unitPrice: 2000, quantity: 1 }],
    customerId
  );

  const { data: before } = await admin.from('customers').select('total_spent').eq('id', customerId).single();
  const { error } = await mgr.rpc('refund_order', {
    p_order_id: orderId,
    p_amount: 500,
    p_method: 'cash',
    p_reason: '[E2E] LTV検証',
    p_register_session_id: sessionId,
  });
  expect(error).toBeNull();

  const { data: after } = await admin.from('customers').select('total_spent').eq('id', customerId).single();
  expect(after!.total_spent).toBe(before!.total_spent - 500);

  await login(page, ACCOUNTS.shibuyaManager);
  await page.goto(`/app/customers/${customerId}`);
  await expect(page.getByText('[E2E] 返金検証顧客').first()).toBeVisible();
  await expect(page.getByText('¥1,500').first()).toBeVisible();
});

test('CASE5: 商品返金（在庫戻しあり）→ 在庫が増える', async ({ page }) => {
  // menu_item直結の商品在庫を持つデモ商品（生ビール。00026の直接リンク戻し修正の実地検証）
  const { data: menuItems } = await admin
    .from('menu_items')
    .select('id, price, name')
    .eq('organization_id', orgId)
    .eq('name', '生ビール')
    .eq('status', 'active')
    .limit(1);
  test.skip(!menuItems || menuItems.length === 0, 'デモ商品（生ビール）がないためスキップ');
  const beer = menuItems![0];

  const { data: linked } = await admin
    .from('inventory_items')
    .select('id, current_quantity')
    .eq('store_id', storeId)
    .eq('menu_item_id', beer.id)
    .eq('status', 'active')
    .limit(1);
  test.skip(!linked || linked.length === 0, '生ビールに直結在庫がないためスキップ');
  const ing = { inventory_item_id: linked![0].id, quantity: 1 }; // 直結在庫は1点=1単位

  const { orderId } = await createPaidOrder([
    { menuItemId: beer.id, name: beer.name, unitPrice: beer.price, quantity: 2 },
  ]);

  const { data: invBefore } = await admin
    .from('inventory_items')
    .select('id, current_quantity')
    .eq('store_id', storeId)
    .eq('id', ing.inventory_item_id)
    .single();

  await login(page, ACCOUNTS.shibuyaManager);
  await page.goto(`/app/orders/${orderId}`);
  await page.getByRole('button', { name: '返金・取消する' }).click();
  await page.getByRole('button', { name: '商品単位' }).click();
  // 品目は1種類のみ: 先頭checkbox=品目選択 → 数量1 → 「在庫に戻す」
  await page.locator('input[type="checkbox"]').first().check();
  await page.locator('input[type="number"]').fill('1');
  await page.locator('input[type="checkbox"]').nth(1).check();
  await page.getByLabel(/理由/).fill('[E2E] 返品あり返金');
  await page.getByRole('button', { name: '返金を確定' }).click();
  await expect(page.getByText('返金を記録しました')).toBeVisible({ timeout: 15_000 });

  // 在庫が recipe量×1 だけ戻る + refund_items.restock=true + 'return' movement
  await expect
    .poll(async () => {
      const { data } = await admin
        .from('inventory_items')
        .select('current_quantity')
        .eq('id', invBefore!.id)
        .single();
      return Number(data!.current_quantity);
    }, { timeout: 15_000 })
    .toBeCloseTo(Number(invBefore!.current_quantity) + Number(ing.quantity), 2);

  const { data: ri } = await admin
    .from('refund_items')
    .select('restock, quantity, refunds!inner(order_id)')
    .eq('refunds.order_id', orderId);
  expect(ri!.length).toBe(1);
  expect(ri![0].restock).toBe(true);

  // 返金履歴のUI表示（在庫戻し）
  await page.reload();
  await expect(page.getByText('返金履歴')).toBeVisible();
});

test('CASE6: 商品返金（在庫戻しなし）→ 在庫は変わらない', async ({ page }) => {
  const { data: menuItems } = await admin
    .from('menu_items')
    .select('id, price, name')
    .eq('organization_id', orgId)
    .eq('name', '生ビール')
    .eq('status', 'active')
    .limit(1);
  test.skip(!menuItems || menuItems.length === 0, 'デモ商品（生ビール）がないためスキップ');
  const beer = menuItems![0];
  const { data: linked } = await admin
    .from('inventory_items')
    .select('id')
    .eq('store_id', storeId)
    .eq('menu_item_id', beer.id)
    .eq('status', 'active')
    .limit(1);
  test.skip(!linked || linked.length === 0, '生ビールに直結在庫がないためスキップ');
  const ing = { inventory_item_id: linked![0].id, quantity: 1 };

  const { orderId } = await createPaidOrder([
    { menuItemId: beer.id, name: beer.name, unitPrice: beer.price, quantity: 1 },
  ]);

  const { data: invBefore } = await admin
    .from('inventory_items')
    .select('id, current_quantity')
    .eq('store_id', storeId)
    .eq('id', ing.inventory_item_id)
    .single();

  await login(page, ACCOUNTS.shibuyaManager);
  await page.goto(`/app/orders/${orderId}`);
  await page.getByRole('button', { name: '返金・取消する' }).click();
  await page.getByRole('button', { name: '商品単位' }).click();
  await page.locator('input[type="checkbox"]').first().check();
  // 在庫に戻すはチェックしない（提供済み）
  await page.getByLabel(/理由/).fill('[E2E] 提供済み返金');
  await page.getByRole('button', { name: '返金を確定' }).click();
  await expect(page.getByText('返金を記録しました')).toBeVisible({ timeout: 15_000 });

  // refund_itemsは作られるが在庫は不変
  await expect
    .poll(async () => {
      const { data } = await admin
        .from('refund_items')
        .select('restock, refunds!inner(order_id)')
        .eq('refunds.order_id', orderId);
      return data?.length ?? 0;
    }, { timeout: 15_000 })
    .toBe(1);
  const { data: invAfter } = await admin
    .from('inventory_items')
    .select('current_quantity')
    .eq('id', invBefore!.id)
    .single();
  expect(Number(invAfter!.current_quantity)).toBeCloseTo(Number(invBefore!.current_quantity), 2);
});

test('CASE2: レジ締め → 締め履歴に純売上snapshotが表示される', async ({ page }) => {
  // 開いているセッションを理論現金どおりに締める（差異0）
  const { data: cashTx } = await admin
    .from('cash_transactions')
    .select('kind, amount')
    .eq('register_session_id', sessionId)
    .eq('status', 'active');
  const { data: sess } = await admin
    .from('register_sessions')
    .select('opening_float, status')
    .eq('id', sessionId)
    .single();
  test.skip(sess!.status !== 'open', 'セッションが既に閉局済みのためスキップ');

  const sum = (kinds: string[]) =>
    (cashTx ?? []).filter((t) => kinds.includes(t.kind)).reduce((a, t) => a + t.amount, 0);
  const expected =
    sess!.opening_float + sum(['sale']) - sum(['refund']) + sum(['deposit', 'petty_in']) - sum(['withdrawal', 'petty_out']);

  const { data: closeRes, error } = await mgr.rpc('close_register_session', {
    p_session_id: sessionId,
    p_counted_cash: expected,
  });
  expect(error).toBeNull();
  expect(closeRes.difference).toBe(0);

  // v0.4.3: 店舗日次締め（2段階目）でsnapshotが確定する
  const { data: sessRow } = await admin
    .from('register_sessions')
    .select('business_date')
    .eq('id', sessionId)
    .single();
  const { data: dayRes, error: dayErr } = await mgr.rpc('close_store_day', {
    p_store_id: storeId,
    p_business_date: sessRow!.business_date,
  });
  expect(dayErr).toBeNull();
  // snapshotに純売上が保存される（gross − refund）
  expect(dayRes.net_sales).toBe(dayRes.sales_total - dayRes.refund_total);

  await login(page, ACCOUNTS.shibuyaManager);
  await page.goto('/app/cash?tab=closings');
  await expect(page.getByText('純売上').first()).toBeVisible();
});

test('CASE3: 自動仕訳に返金（POS）ソースが表示される', async ({ page }) => {
  await login(page, ACCOUNTS.owner);
  await page.goto('/app/accounting/auto');
  await expect(page.getByText('返金（POS）').first()).toBeVisible();
});
