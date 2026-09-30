import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 注文画面 → ホームに戻ったとき左メニューが消えない（2026-09-30 Ronnie「忙しい時間に困る」） */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('左メニュー（注文画面のあと）', () => {
  const layout = read('app/app/layout.tsx');
  const sidebar = read('components/layout/sidebar.tsx');

  it('layout はサーバーの pathname で左メニューを外さない（画面の移動で作り直されないため）', () => {
    expect(layout).not.toMatch(/!posFullscreen && \(\s*<Sidebar/);
    expect(layout).not.toContain('!posFullscreen && <RegisterDayBanner');
  });

  it('注文画面で隠すのは Sidebar（クライアント）', () => {
    expect(sidebar).toContain("const POS_PATH = '/app/pos';");
    expect(sidebar).toContain('if (pathname === POS_PATH) return null;');
  });
});
