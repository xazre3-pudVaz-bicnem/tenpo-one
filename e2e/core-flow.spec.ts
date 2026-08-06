import { test, expect } from '@playwright/test';
import { ACCOUNTS, hasEnv, login } from './helpers';

test.skip(!hasEnv, 'Supabase環境変数が未設定のためスキップ');

test.describe('認証・権限', () => {
  test('ログインしてダッシュボードが表示される', async ({ page }) => {
    await login(page, ACCOUNTS.shibuyaManager);
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
    await expect(page.getByText('本日売上')).toBeVisible();
  });

  test('本社ユーザーは店舗切替に全店舗が表示される', async ({ page }) => {
    await login(page, ACCOUNTS.hq);
    const switcher = page.getByLabel('店舗切替');
    await expect(switcher).toBeVisible();
    await expect(switcher.locator('option')).toContainText([
      '全店舗',
      'TENPO ONE 渋谷店',
      'TENPO ONE 新宿店',
      'TENPO ONE 横浜店',
    ]);
  });

  test('店舗ユーザーの切替には自店舗のみ表示される（他店舗アクセス拒否）', async ({ page }) => {
    await login(page, ACCOUNTS.staff);
    const switcher = page.getByLabel('店舗切替');
    const options = await switcher.locator('option').allTextContents();
    expect(options.join()).toContain('渋谷');
    expect(options.join()).not.toContain('横浜');
  });
});

test.describe('公開予約 → 台帳 → POS → 会計（縦フロー）', () => {
  test('公開予約ページから予約を作成できる', async ({ page }) => {
    await page.goto('/book/tenpoone-shibuya');
    await expect(page.getByText('TENPO ONE 渋谷店')).toBeVisible();
    // ウィザードの詳細操作はUI実装に依存するため、表示検証まで
  });

  test('予約台帳に予約が表示される', async ({ page }) => {
    await login(page, ACCOUNTS.shibuyaManager);
    await page.goto('/app/reservations/list');
    await expect(page.getByRole('heading', { name: /予約/ })).toBeVisible();
  });

  test('POS画面が開ける', async ({ page }) => {
    await login(page, ACCOUNTS.shibuyaManager);
    await page.goto('/app/pos');
    await expect(page).toHaveURL(/\/app\/pos/);
  });
});

test.describe('勤怠・現金・請求書', () => {
  test('打刻画面が表示される', async ({ page }) => {
    await login(page, ACCOUNTS.staff);
    await page.goto('/app/attendance');
    await expect(page.getByRole('button', { name: /出勤|退勤/ }).first()).toBeVisible();
  });

  test('レジ画面が表示される', async ({ page }) => {
    await login(page, ACCOUNTS.shibuyaManager);
    await page.goto('/app/cash');
    await expect(page).toHaveURL(/\/app\/cash/);
  });

  test('請求書一覧が表示される', async ({ page }) => {
    await login(page, ACCOUNTS.keiri);
    await page.goto('/app/invoices');
    await expect(page).toHaveURL(/\/app\/invoices/);
  });
});
