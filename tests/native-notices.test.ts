import { describe, expect, it } from 'vitest';
import { isNativeNoticeActionType, parseNativeNoticeAction } from '@/lib/native-notices';

describe('native notices actions', () => {
  it('parses read / read all', () => {
    expect(isNativeNoticeActionType('noticeReadAll')).toBe(true);
    expect(isNativeNoticeActionType('pettyAdd')).toBe(false);
    expect(parseNativeNoticeAction({ type: 'noticeReadAll' }).ok).toBe(true);
    expect(parseNativeNoticeAction({ type: 'noticeRead', id: '11111111-1111-4111-8111-111111111111' }).ok).toBe(true);
    expect(parseNativeNoticeAction({ type: 'noticeRead', id: 'x' }).ok).toBe(false);
  });

  it('validates announcement create like the web form', () => {
    expect(parseNativeNoticeAction({ type: 'annCreate', title: ' 連絡 ', body: '本文', publishFrom: '', publishTo: '2026-10-31' })).toEqual({
      ok: true,
      action: { type: 'annCreate', title: '連絡', body: '本文', isImportant: false, publishFrom: null, publishTo: '2026-10-31', allStores: false },
    });
    expect(parseNativeNoticeAction({ type: 'annCreate', title: '', body: 'x' }).ok).toBe(false);
    expect(parseNativeNoticeAction({ type: 'annCreate', title: 'x', body: 'x', publishFrom: '10/31' }).ok).toBe(false);
    expect(parseNativeNoticeAction({ type: 'annDelete', id: '11111111-1111-4111-8111-111111111111' }).ok).toBe(true);
  });
});
