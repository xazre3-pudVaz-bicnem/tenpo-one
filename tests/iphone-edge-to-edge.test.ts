import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * iPhone アプリ：上は時計のうしろまで黒、下のホームバーのうしろも黒（白いすき間を無くす）。
 * 2026-10-20 Ronnie「iPhone の色が合っていない。黒のせいで下に少し白い場所。レストランボードのように上は全部黒に」
 */
describe('iPhone アプリの上下のすき間', () => {
  const web = readFileSync(new URL('../ios/Shared/WebViewController.swift', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../ios/Shared/TenpoOneApp.swift', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../components/handy/handy-chrome.tsx', import.meta.url), 'utf8');
  const topBar = readFileSync(new URL('../components/layout/top-bar.tsx', import.meta.url), 'utf8');

  it('iPhone は Web を画面のはしまで広げる（iPad は今まで通り）・viewport-fit=cover・時計の字は白', () => {
    expect(web).toContain('AppConfig.isPad ? view.safeAreaLayoutGuide.topAnchor : view.topAnchor');
    expect(web).toContain('AppConfig.isPad ? view.safeAreaLayoutGuide.bottomAnchor : view.bottomAnchor');
    expect(web).toContain('let fit = AppConfig.isPad ? "" : ", viewport-fit=cover"');
    // iPhone は暗い表示のまま（時計の字は白）。iPad は上のバーを明るくしたので明るい表示（2026-10-24 22:28 Ronnie）
    expect(app).toContain('.preferredColorScheme(AppConfig.isPad ? .light : .dark)');
  });
  it('Web：上のバーは時計のうしろまで同じ色、下のバーはホームバーのうしろまで黒', () => {
    expect(chrome).toContain('bg-[#292725] pt-[env(safe-area-inset-top)] text-white');
    expect(chrome).toContain('bg-[#292725] px-2 pb-[calc(6px+env(safe-area-inset-bottom))]');
    expect(topBar).toContain('h-[calc(58px+env(safe-area-inset-top))]');
    expect(topBar).toContain('pt-[env(safe-area-inset-top)]');
  });
});
