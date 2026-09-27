import { describe, it, expect } from 'vitest';
import { isPhoneUserAgent, nativeAppMode, phoneMayOpenApp } from '@/lib/device-kind';
import { APNS_TOPIC, apnsPayload, base64url, isDeadTokenResponse, isDeviceToken, isNativeApp } from '@/lib/apns';

const IPHONE_APP = (mode: string) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 TenpoOneApp/${mode}/1.0`;
const IPAD_APP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 TenpoOneApp/regi/1.0';

describe('iPhone/iPad アプリの見分け（2026-09-28 Ronnie「レジは iPad、ハンディとオーナーは iPhone のアプリ」）', () => {
  it('User-Agent の印でモードが分かる', () => {
    expect(nativeAppMode(IPAD_APP)).toBe('regi');
    expect(nativeAppMode(IPHONE_APP('handy'))).toBe('handy');
    expect(nativeAppMode(IPHONE_APP('owner'))).toBe('owner');
    expect(nativeAppMode('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBeNull();
  });
  it('スマホで本体（/app）を開けるのはオーナーモードのアプリだけ。レジの iPad アプリはスマホ扱いしない', () => {
    expect(isPhoneUserAgent(IPHONE_APP('owner')) && !phoneMayOpenApp(IPHONE_APP('owner'))).toBe(false);
    expect(isPhoneUserAgent(IPHONE_APP('handy')) && !phoneMayOpenApp(IPHONE_APP('handy'))).toBe(true);
    expect(isPhoneUserAgent(IPAD_APP)).toBe(false);
  });
});

describe('アプリの通知（APNs）', () => {
  it('呼び出しはベルの音・集中モードでも出す。タップで開く画面を入れる', () => {
    expect(apnsPayload({ title: 'T8　スタッフ呼び出し', body: 'b', url: '/app/floor', tag: 'call-1', sound: 'bell', timeSensitive: true })).toEqual({
      aps: {
        alert: { title: 'T8　スタッフ呼び出し', body: 'b' },
        sound: 'bell.wav',
        'interruption-level': 'time-sensitive',
        'thread-id': 'call-1',
      },
      url: '/app/floor',
    });
    expect(apnsPayload({ title: 't', body: 'b', url: '/app/reservations' }).aps.sound).toBe('default');
  });
  it('bundle id とトークンの形・消すべき返事', () => {
    expect(APNS_TOPIC.regi).toBe('com.tenpoone.regi');
    expect(APNS_TOPIC.owner).toBe(APNS_TOPIC.handy);
    expect(isNativeApp('owner')).toBe(true);
    expect(isNativeApp('web')).toBe(false);
    expect(isDeviceToken('a'.repeat(64))).toBe(true);
    expect(isDeviceToken('xyz')).toBe(false);
    expect(isDeadTokenResponse(410, 'Unregistered')).toBe(true);
    expect(isDeadTokenResponse(400, 'BadDeviceToken')).toBe(true);
    expect(isDeadTokenResponse(429, 'TooManyRequests')).toBe(false);
    expect(base64url('ab?>')).toBe('YWI_Pg');
  });
});
