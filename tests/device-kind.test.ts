import { describe, it, expect } from 'vitest';
import { isPhoneUserAgent } from '@/lib/device-kind';

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
