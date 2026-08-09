import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNTS, hasEnv, login } from './helpers';

/**
 * v0.5.0 セキュリティE2E（TEST）: 一般スタッフ(staff1)がURL直接入力で
 * 他店舗/他企業スコープのページ・権限のない画面へアクセスした際に、
 * リダイレクト・空表示・エラー境界のいずれかで機密が出ないことを確認する。
 * DB層（RLS・RPC）の防御は scripts/verify-security.mjs で別途検証済み。
 * ここでは「UIが実際に機密を画面へ出さないか」をブラウザ経由で確認する。
 *
 * /admin/organizations への遷移テストは既存 e2e/crawl.spec.ts（owner）でカバー済みのため、
 * ここでは非cypress・非owner（staff1）で別の管理画面（feature-flags / users）を使い重複を避ける。
 */
const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
test.skip(!hasEnv || !hasServiceKey, 'Supabase環境変数（service key含む）が未設定のためスキップ');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let admin: SupabaseClient;
let orgId: string;
let staff1Id: string;
let yokohamaOrderId: string;
let otherStaffGrossTotalYen: string | null = null;

test.beforeAll(async () => {
  admin = createClient(URL, SERVICE);

  const { data: org } = await admin.from('organizations').select('id').eq('is_demo', true).limit(1).single();
  orgId = org!.id;

  const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  staff1Id = userList.users.find((u) => u.email === ACCOUNTS.staff)!.id;

  // 横浜店（staff1は渋谷所属）の実在する注文を1件取得（他店舗IDOR検証用）
  const { data: yokohama } = await admin.from('stores')
    .select('id').eq('organization_id', orgId).eq('slug', 'tenpoone-yokohama').single();
  const { data: yOrders } = await admin.from('orders')
    .select('id').eq('store_id', yokohama!.id).limit(1);
  yokohamaOrderId = yOrders?.[0]?.id;

  // 本人以外の給与明細（金額）を1件取得（給与画面の機密漏洩検証用）
  const { data: items } = await admin.from('payroll_items')
    .select('profile_id, gross_total').eq('organization_id', orgId).neq('profile_id', staff1Id).limit(5);
  const other = (items ?? []).find((i) => i.gross_total != null);
  if (other) otherStaffGrossTotalYen = `¥${Number(other.gross_total).toLocaleString('ja-JP')}`;
});

test.describe('他店舗IDOR: 一般スタッフのURL直接入力', () => {
  test('staff1は他店舗（横浜）の注文詳細をIDで直接開いても内容が見えない', async ({ page }) => {
    test.skip(!yokohamaOrderId, '横浜店に実データが無いためスキップ');
    await login(page, ACCOUNTS.staff);
    const res = await page.goto(`/app/orders/${yokohamaOrderId}`, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBeLessThan(500);
    // 注文詳細（総売上・返金導線など）が表示されず、「見つかりません」系の空表示になる
    await expect(page.getByText(/見つかりません/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('総売上（元取引）')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '返金・取消する' })).toHaveCount(0);
  });
});

test.describe('admin配下: 非cypress管理者は拒否される', () => {
  test('staff1は/admin/feature-flagsへアクセスすると/app/dashboardへ戻される', async ({ page }) => {
    await login(page, ACCOUNTS.staff);
    const res = await page.goto('/admin/feature-flags', { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBeLessThan(400);
    await page.waitForURL(/\/app\/dashboard/, { timeout: 10_000 });
  });

  test('staff1は/admin/usersへアクセスすると/app/dashboardへ戻される', async ({ page }) => {
    await login(page, ACCOUNTS.staff);
    const res = await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBeLessThan(400);
    await page.waitForURL(/\/app\/dashboard/, { timeout: 10_000 });
  });
});

test.describe('権限のない画面: 機密が出ないこと', () => {
  test('staff1は/app/payrollで自分の給与明細のみ表示され、他人の給与額は出ない', async ({ page }) => {
    await login(page, ACCOUNTS.staff);
    await page.goto('/app/payroll', { waitUntil: 'domcontentloaded' });
    // 権限者向けタブ（給与ルール設定UI）は表示されず、本人向けの給与明細ビューになる
    await expect(page.getByRole('heading', { name: '給与明細' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: '給与ルール' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '追加' })).toHaveCount(0);
    if (otherStaffGrossTotalYen) {
      await expect(page.getByText(otherStaffGrossTotalYen)).toHaveCount(0);
    }
  });

  test('staff1は/app/employees（従業員台帳）を開けない（staff.manage権限なし）', async ({ page }) => {
    await login(page, ACCOUNTS.staff);
    await page.goto('/app/employees', { waitUntil: 'domcontentloaded' });
    // requirePermission('staff.manage') が例外を投げ、アプリ共通のエラー境界が表示される
    // （staff.manageを持つロールのみ閲覧できるページのため、機密テーブルはレンダリングされない）
    await expect(page.getByText('エラーが発生しました')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: '従業員台帳' })).toHaveCount(0);
  });
});
