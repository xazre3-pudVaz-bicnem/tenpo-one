import { defineConfig } from '@playwright/test';

/**
 * E2Eテスト設定。
 * Supabase環境（migrations適用 + seed投入済み）と .env.local が前提。
 * BASE_URL 未指定時は http://localhost:3000（`npm run dev` を自動起動）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
