import { describe, expect, it } from 'vitest';
import { SUPPORT_MEMBERSHIP_NOTE, isSupportMembership } from '@/lib/support-access';

describe('サポートアクセスの印（運営がコントロールセンターから管理画面に入る）', () => {
  it('印のついたメンバーシップだけ', () => {
    expect(isSupportMembership({ hourly_note: SUPPORT_MEMBERSHIP_NOTE })).toBe(true);
    expect(isSupportMembership({ hourly_note: null })).toBe(false);
    expect(isSupportMembership({ hourly_note: '時給1200' })).toBe(false);
    expect(isSupportMembership(null)).toBe(false);
  });
  it('印の文字は admin の絞り込み（or 句）と同じ', () => {
    expect(SUPPORT_MEMBERSHIP_NOTE).toBe('__cypress_support__');
  });
});
