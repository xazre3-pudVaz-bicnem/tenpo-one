import { test, expect } from '@playwright/test';
import { ACCOUNTS, hasEnv, login } from './helpers';

/**
 * 全ページ巡回スモーク（v0.3 項目80）。
 * オーナーでログインし全業務URLを開き、404・コンソールエラー・レンダリング失敗を検出する。
 */
test.skip(!hasEnv, 'Supabase環境変数が未設定のためスキップ');

const APP_ROUTES = [
  '/app/dashboard',
  '/app/reservations',
  '/app/reservations?view=week',
  '/app/reservations?view=waitlist',
  '/app/reservations/list',
  '/app/reservations/calendar',
  '/app/floor',
  '/app/pos',
  '/app/orders',
  '/app/kitchen',
  '/app/customers',
  '/app/customers?view=rfm',
  '/app/coupons',
  '/app/cash',
  '/app/cash?tab=petty',
  '/app/cash?tab=closings',
  '/app/expenses',
  '/app/invoices',
  '/app/invoices?tab=inbox',
  '/app/vendors',
  '/app/purchases',
  '/app/inventory',
  '/app/inventory?tab=transfers',
  '/app/inventory?tab=reorder',
  '/app/inventory?tab=forecast',
  '/app/costing',
  '/app/costing?tab=impact',
  '/app/costing?tab=waste',
  '/app/attendance',
  '/app/attendance?tab=list',
  '/app/shifts',
  '/app/leave',
  '/app/employees',
  '/app/payroll',
  '/app/payroll/nencho',
  '/app/accounting',
  '/app/accounting/ledger',
  '/app/accounting/ledger?type=general',
  '/app/accounting/statements',
  '/app/accounting/assets',
  '/app/accounting/auto',
  '/app/accounting/banks',
  '/app/reports',
  '/app/budgets',
  '/app/daily-reports',
  '/app/tasks',
  '/app/announcements',
  '/app/manuals',
  '/app/notifications',
  '/app/staff',
  '/app/settings',
  '/app/settings/store',
  '/app/settings/hours',
  '/app/settings/tables',
  '/app/settings/menu',
  '/app/settings/tax',
  '/app/settings/booking',
  '/app/settings/printers',
  '/app/settings/payments',
  '/app/settings/loyalty',
  '/app/settings/approvals',
  '/app/settings/alerts',
  '/app/settings/integrations',
  '/app/settings/import',
  '/app/settings/company',
  '/app/settings/audit',
  '/app/settings/accounts',
];

// 実害のないノイズ（拡張・faviconなど）は除外
const IGNORED_CONSOLE = [/favicon/i, /third-party cookie/i, /Download the React DevTools/i];

test.describe('全ページ巡回（owner）', () => {
  test('全業務ページが表示され、コンソールエラーが無い', async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: { url: string; text: string }[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) {
        consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 300) });
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push({ url: page.url(), text: `pageerror: ${String(err).slice(0, 300)}` });
    });

    await login(page, ACCOUNTS.owner);

    for (const route of APP_ROUTES) {
      const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), `${route} のHTTPステータス`).toBeLessThan(400);
      // 404/エラーページの検出
      await expect(
        page.getByText('ページが見つかりません'),
        `${route} が404表示`
      ).toHaveCount(0);
      await expect(
        page.getByText('エラーが発生しました'),
        `${route} がエラー画面`
      ).toHaveCount(0);
      // ハイドレーション完了を軽く待つ
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    }

    expect(
      consoleErrors,
      `コンソールエラー:\n${consoleErrors.map((e) => `${e.url}: ${e.text}`).join('\n')}`
    ).toHaveLength(0);
  });

  test('adminページ巡回（cypress管理者権限が無い場合はリダイレクトのみ確認）', async ({ page }) => {
    await login(page, ACCOUNTS.owner);
    const res = await page.goto('/admin/organizations', { waitUntil: 'domcontentloaded' });
    // ownerはcypress管理者ではないため /app/dashboard へ戻される（拒否の確認）
    expect(res?.status()).toBeLessThan(400);
    await page.waitForURL(/\/app\/dashboard/, { timeout: 10_000 });
  });
});
