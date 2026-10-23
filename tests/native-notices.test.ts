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
});
