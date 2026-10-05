import { describe, it, expect } from 'vitest';
import { isPhoneUserAgent, isRegisterTablet, shouldBlockRegisterSignOut } from '@/lib/device-kind';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1';
// iPadOS は「デスクトップ用サイト」が既定で、Macintosh を名乗る
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

describe('スマホかどうかの判定（スマホはハンディだけ）', () => {
  it('スマホは true', () => {
    expect(isPhoneUserAgent(IPHONE)).toBe(true);
    expect(isPhoneUserAgent(ANDROID_PHONE)).toBe(true);
  });

  it('iPad は false（レジ本体で使う）', () => {
    expect(isPhoneUserAgent(IPAD)).toBe(false);
    expect(isPhoneUserAgent(IPAD_DESKTOP)).toBe(false);
  });

  it('タブレット・パソコン・不明は false', () => {
    expect(isPhoneUserAgent(ANDROID_TABLET)).toBe(false);
    expect(isPhoneUserAgent(WINDOWS)).toBe(false);
    expect(isPhoneUserAgent(null)).toBe(false);
    expect(isPhoneUserAgent('')).toBe(false);
  });
});

describe('レジを閉めていないときのログアウト（止めるのは iPad だけ。2026-10-05 Ronnie）', () => {
  const ipad = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
  const ipadDesktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
  const mac = ipadDesktop;
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';
  const regiApp = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) TenpoOneApp/regi/1.0';

  it('iPad（UA に iPad・アプリ・タッチ画面）は止める', () => {
    expect(isRegisterTablet(ipad, 0)).toBe(true);
    expect(isRegisterTablet(regiApp, null)).toBe(true);
    // 「デスクトップ用サイト」の iPad は UA が Mac と同じ。タッチの数で見分ける
    expect(isRegisterTablet(ipadDesktop, 5)).toBe(true);
    expect(shouldBlockRegisterSignOut({ isRegisterDevice: true, userAgent: ipadDesktop, touchPoints: 5 })).toBe(true);
  });

  it('パソコン（Mac・Windows、タッチ無し）は、レジのアカウントでも止めない', () => {
    expect(isRegisterTablet(mac, 0)).toBe(false);
    expect(isRegisterTablet(windows, null)).toBe(false);
    expect(shouldBlockRegisterSignOut({ isRegisterDevice: true, userAgent: mac, touchPoints: 0 })).toBe(false);
    expect(shouldBlockRegisterSignOut({ isRegisterDevice: true, userAgent: windows, touchPoints: null })).toBe(false);
  });

  it('メール＋パスワードのログイン（レジのアカウントでない）は端末に関係なく止めない', () => {
    expect(shouldBlockRegisterSignOut({ isRegisterDevice: false, userAgent: ipad, touchPoints: 5 })).toBe(false);
  });
});
