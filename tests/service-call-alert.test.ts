import { describe, it, expect } from 'vitest';
import {
  CALL_REPEAT_MAX,
  CALL_REPEAT_MS,
  callKindLabel,
  isFreshCall,
  isPickupCall,
  serviceCallPushPayload,
  shouldRepeatCall,
} from '@/lib/service-call-alert';

describe('QRの呼び出しの知らせ方（2026-09-28 Ronnie「ハンディは振動、卓の箱にも」）', () => {
  it('対応済みになるまで30秒ごとに鳴らす（最大10回まで）', () => {
    const now = 1_000_000;
    expect(shouldRepeatCall({ id: 'a', lastAlertAt: now - CALL_REPEAT_MS, alerts: 1 }, now)).toBe(true);
    expect(shouldRepeatCall({ id: 'a', lastAlertAt: now - 5_000, alerts: 1 }, now)).toBe(false);
    expect(shouldRepeatCall({ id: 'a', lastAlertAt: now - CALL_REPEAT_MS, alerts: CALL_REPEAT_MAX + 1 }, now)).toBe(false);
  });
  it('画面を開いた・戻ったときは30分以内の呼び出しを拾い直す', () => {
    const now = 10_000_000;
    expect(isPickupCall(now - 60_000, now)).toBe(true);
    expect(isPickupCall(now - 31 * 60_000, now)).toBe(false);
  });
  it('Push は QR で呼んだ直後だけ', () => {
    const now = Date.parse('2026-09-28T12:00:30Z');
    expect(isFreshCall('2026-09-28T12:00:00Z', now)).toBe(true);
    expect(isFreshCall('2026-09-28T11:55:00Z', now)).toBe(false);
    expect(isFreshCall('bad', now)).toBe(false);
  });
  it('Push の文：卓名＋種類、開く画面はテーブル一覧', () => {
    expect(serviceCallPushPayload({ tableName: 'T8', kind: 'staff', callId: 'x' })).toMatchObject({
      title: 'T8　スタッフ呼び出し',
      url: '/app/floor',
      tag: 'call-x',
    });
    expect(callKindLabel('checkout')).toBe('お会計希望');
  });
});
