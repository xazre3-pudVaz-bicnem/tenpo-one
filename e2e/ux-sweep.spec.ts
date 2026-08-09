import { test, expect, type Page } from '@playwright/test';
import { ACCOUNTS, hasEnv, login } from './helpers';

/**
 * v0.5.0 UX巡回テスト（TEST）: 主要画面を複数viewportで開き、
 *  (a) コンソールエラー0
 *  (b) 横スクロールが発生しない（document.body.scrollWidth <= window.innerWidth + 許容）
 *  (c) 主要要素（見出し）が表示される
 * を確認する。owner（全店舗・全権限）でログインし、各route×viewportを1テストとして
 * 個別に成否を報告する（崩れがあれば該当route/viewportが一目で分かるようにするため）。
 */
test.skip(!hasEnv, 'Supabase環境変数が未設定のためスキップ');

const IGNORED_CONSOLE = [/favicon/i, /third-party cookie/i, /Download the React DevTools/i];

// 横スクロール判定の許容（スクロールバー分の丸め誤差を吸収）
const SCROLL_TOLERANCE_PX = 2;

const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
  { name: 'laptop-1366x768', width: 1366, height: 768 },
  { name: 'ipad-landscape-1024x768', width: 1024, height: 768 },
  { name: 'ipad-portrait-768x1024', width: 768, height: 1024 },
  { name: 'iphone-390x844', width: 390, height: 844 },
];

const ROUTES: { path: string; label: string; heading: string }[] = [
  { path: '/app/dashboard', label: 'ダッシュボード', heading: 'ダッシュボード' },
  { path: '/app/pos', label: 'POS（特にiPad横で確認）', heading: 'POSレジ' },
  { path: '/app/reservations', label: '予約', heading: '予約台帳' },
  { path: '/app/kitchen', label: 'KDS（特に大画面で確認）', heading: 'キッチン' },
  { path: '/app/inventory', label: '在庫', heading: '在庫' },
  { path: '/app/reports', label: 'レポート', heading: 'レポート' },
  { path: '/app/settings', label: '設定', heading: '設定' },
  { path: '/app/employees', label: '従業員', heading: '従業員台帳' },
  { path: '/app/reconciliation', label: '照合', heading: '照合（売上・現金・在庫）' },
  { path: '/app/attendance', label: '勤怠打刻（特にtabletで確認）', heading: '勤怠' },
];

/**
 * 既知の軽微な崩れの許容リスト（理由必須）。
 * ここに載せた route×viewport の組は、指定した種類のチェックのみスキップする。
 * 空のままなら全組み合わせを厳格にチェックする。
 */
type AllowKind = 'console' | 'scroll' | 'heading';
const ALLOWLIST: { path: string; viewport: string; kind: AllowKind; reason: string }[] = [
  // 例: { path: '/app/reports', viewport: 'iphone-390x844', kind: 'scroll',
  //      reason: '既知: 複合グラフが390px未満で最小幅を持つ設計（チケットXXX対応待ち）' },
];
function isAllowed(path: string, viewport: string, kind: AllowKind) {
  return ALLOWLIST.some((a) => a.path === path && a.viewport === viewport && a.kind === kind);
}

async function checkNoHorizontalScroll(page: Page) {
  return page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

for (const viewport of VIEWPORTS) {
  test.describe(`UX巡回: ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of ROUTES) {
      test(`${route.label} (${route.path})`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) {
            consoleErrors.push(msg.text().slice(0, 300));
          }
        });
        page.on('pageerror', (err) => {
          consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`);
        });

        await login(page, ACCOUNTS.owner);

        const res = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        expect(res?.status(), `${route.path} のHTTPステータス`).toBeLessThan(400);
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

        // (c) 主要要素（見出し）が表示される
        if (!isAllowed(route.path, viewport.name, 'heading')) {
          await expect(
            page.getByRole('heading', { level: 1, name: route.heading }),
            `${route.path} @ ${viewport.name}: 見出し「${route.heading}」`
          ).toBeVisible({ timeout: 10_000 });
        }

        // (b) 横スクロールが発生しない
        if (!isAllowed(route.path, viewport.name, 'scroll')) {
          const { bodyScrollWidth, innerWidth } = await checkNoHorizontalScroll(page);
          expect(
            bodyScrollWidth,
            `${route.path} @ ${viewport.name}: 横スクロール発生（body.scrollWidth=${bodyScrollWidth} > window.innerWidth=${innerWidth}+${SCROLL_TOLERANCE_PX}）`
          ).toBeLessThanOrEqual(innerWidth + SCROLL_TOLERANCE_PX);
        }

        // (a) コンソールエラー0
        if (!isAllowed(route.path, viewport.name, 'console')) {
          expect(
            consoleErrors,
            `${route.path} @ ${viewport.name}: コンソールエラー\n${consoleErrors.join('\n')}`
          ).toHaveLength(0);
        }
      });
    }
  });
}
