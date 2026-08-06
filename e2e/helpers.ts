import { type Page, expect } from '@playwright/test';

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'TenpoOne-Demo1!';

export const ACCOUNTS = {
  owner: 'owner@demo.tenpo.one',
  hq: 'hq@demo.tenpo.one',
  keiri: 'keiri@demo.tenpo.one',
  shibuyaManager: 'shibuya@demo.tenpo.one',
  yokohamaManager: 'yokohama@demo.tenpo.one',
  staff: 'staff1@demo.tenpo.one',
} as const;

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/, { timeout: 20_000 });
}

/** seed済みSupabase環境が無い場合にスキップするためのフラグ */
export const hasEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
