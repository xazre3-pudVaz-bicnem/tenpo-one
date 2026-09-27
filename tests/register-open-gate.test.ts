import { describe, it, expect } from 'vitest';
import { openPageRedirect, shouldGoToOpenRegister } from '@/lib/register-open-gate';

describe('朝いちばんの開局画面（2026-09-28 Ronnie「ログインしたら、まずレジのお金を数える画面」）', () => {
  const base = { isRegisterDevice: true, hasStore: true, hasOpenSession: false, hasRegister: true };
  it('レジ端末で未開局なら開局画面へ', () => {
    expect(shouldGoToOpenRegister(base)).toBe(true);
  });
  it('開局中・パソコン・レジ未登録・店舗なし は送らない', () => {
    expect(shouldGoToOpenRegister({ ...base, hasOpenSession: true })).toBe(false);
    expect(shouldGoToOpenRegister({ ...base, isRegisterDevice: false })).toBe(false);
    expect(shouldGoToOpenRegister({ ...base, hasRegister: false })).toBe(false);
    expect(shouldGoToOpenRegister({ ...base, hasStore: false })).toBe(false);
  });
  it('開局画面は、すでに開局していればホームへ戻す', () => {
    expect(openPageRedirect({ hasOpenSession: true })).toBe('/app/dashboard');
    expect(openPageRedirect({ hasOpenSession: false })).toBeNull();
  });
});
