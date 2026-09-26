import { describe, expect, it } from 'vitest';
import {
  PUSH_SUBSCRIPTIONS_MAX,
  createdViaLabel,
  deviceLabelFrom,
  jstDateTimeLabel,
  pushSubscriptionsFrom,
  removePushSubscription,
  reservationPushPayload,
  upsertPushSubscription,
  type PushSubscriptionRecord,
} from '@/lib/push-subscriptions';

const rec = (endpoint: string, createdAt = '2026-09-26T00:00:00Z'): PushSubscriptionRecord => ({
  endpoint,
  keys: { p256dh: 'p', auth: 'a' },
  label: 'iPad',
  createdAt,
});

describe('pushSubscriptionsFrom', () => {
  it('壊れた行・https でない endpoint は捨てる', () => {
    const list = pushSubscriptionsFrom({
      pushSubscriptions: [
        rec('https://push.example/1'),
        { endpoint: 'http://insecure', keys: { p256dh: 'p', auth: 'a' }, createdAt: 'x' },
        { endpoint: 'https://push.example/2', keys: { p256dh: 'p' }, createdAt: 'x' },
        null,
        'junk',
      ],
    });
    expect(list.map((s) => s.endpoint)).toEqual(['https://push.example/1']);
  });

  it('未設定なら空', () => {
    expect(pushSubscriptionsFrom(null)).toEqual([]);
    expect(pushSubscriptionsFrom({})).toEqual([]);
    expect(pushSubscriptionsFrom({ pushSubscriptions: 'x' })).toEqual([]);
  });

  it('label は 80 文字まで', () => {
    const list = pushSubscriptionsFrom({ pushSubscriptions: [{ ...rec('https://p/1'), label: 'x'.repeat(200) }] });
    expect(list[0].label).toHaveLength(80);
  });
});

describe('upsertPushSubscription / removePushSubscription', () => {
  it('同じ endpoint は置き換える', () => {
    const list = upsertPushSubscription([rec('https://p/1'), rec('https://p/2')], { ...rec('https://p/1'), label: 'iPhone' });
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.endpoint === 'https://p/1')?.label).toBe('iPhone');
  });

  it('上限を超えたら古いものから消す', () => {
    let list: PushSubscriptionRecord[] = [];
    for (let i = 0; i < PUSH_SUBSCRIPTIONS_MAX + 3; i++) {
      list = upsertPushSubscription(list, rec(`https://p/${i}`, `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:${String(i).padStart(2, '0')}Z`));
    }
    expect(list).toHaveLength(PUSH_SUBSCRIPTIONS_MAX);
    expect(list.some((s) => s.endpoint === 'https://p/0')).toBe(false);
    expect(list.some((s) => s.endpoint === `https://p/${PUSH_SUBSCRIPTIONS_MAX + 2}`)).toBe(true);
  });

  it('remove は endpoint だけを消す', () => {
    const list = removePushSubscription([rec('https://p/1'), rec('https://p/2')], 'https://p/1');
    expect(list.map((s) => s.endpoint)).toEqual(['https://p/2']);
  });
});

describe('deviceLabelFrom', () => {
  it('iPad / iPhone / Android / Mac を見分ける', () => {
    expect(deviceLabelFrom('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad');
    // iPadOS は Macintosh を名乗る（Mobile が付く）
    expect(deviceLabelFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Mobile/15E148')).toBe('iPad');
    expect(deviceLabelFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceLabelFrom('Mozilla/5.0 (Linux; Android 14; Pixel) Mobile')).toBe('Android スマホ');
    expect(deviceLabelFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
    expect(deviceLabelFrom(null)).toBeNull();
  });
});

describe('reservationPushPayload', () => {
  it('日本時間の日時・人数・お名前・コードが入る', () => {
    const p = reservationPushPayload({
      storeName: 'FOGO 新宿',
      guestName: '山田',
      partySize: 4,
      startAt: '2026-09-27T10:00:00Z', // JST 19:00
      code: '336D-C0AC',
      createdVia: 'web',
    });
    expect(p.title).toBe('新しいネット予約：9/27（日）19:00 4名');
    expect(p.body).toContain('山田 様');
    expect(p.body).toContain('336D-C0AC');
    expect(p.url).toBe('/app/reservations');
    expect(p.tag).toBe('reservation-336D-C0AC');
  });

  it('created_via が不明なら「予約」', () => {
    expect(createdViaLabel(null)).toBe('予約');
    expect(createdViaLabel('phone')).toBe('電話予約');
  });

  it('壊れた日時は空文字', () => {
    expect(jstDateTimeLabel('not-a-date')).toBe('');
  });
});
