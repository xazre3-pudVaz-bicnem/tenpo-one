import { describe, expect, it } from 'vitest';
import {
  cancelApprovers,
  CLERK_ROLE_LABELS,
  CLERK_ROLES,
  clerkCanCancel,
  parseClerkRole,
} from '@/lib/clerk-roles';
import {
  CLERK_IDLE_MS,
  isClerkSessionExpired,
  parseClerkSession,
  serializeClerkSession,
  touchClerkSession,
} from '@/lib/clerk-session';

const ID = '11111111-2222-3333-4444-555555555555';

describe('POS担当者の役職', () => {
  it('役職は5つ。知らない値・空はスタッフ扱い', () => {
    expect(CLERK_ROLES).toEqual(['staff', 'assistant_manager', 'store_manager', 'area_manager', 'owner']);
    expect(CLERK_ROLE_LABELS.store_manager).toBe('店長');
    expect(parseClerkRole('store_manager')).toBe('store_manager');
    expect(parseClerkRole('nope')).toBe('staff');
    expect(parseClerkRole(undefined)).toBe('staff');
  });

  it('取消は店長以上だけ', () => {
    expect(clerkCanCancel('store_manager')).toBe(true);
    expect(clerkCanCancel('area_manager')).toBe(true);
    expect(clerkCanCancel('owner')).toBe(true);
    expect(clerkCanCancel('assistant_manager')).toBe(false);
    expect(clerkCanCancel('staff')).toBe(false);
    expect(clerkCanCancel(null)).toBe(false);
  });

  it('承認に出す担当者は店長以上だけ', () => {
    const list = [
      { id: 'a', role: 'staff' as const },
      { id: 'b', role: 'store_manager' as const },
      { id: 'c', role: 'owner' as const },
    ];
    expect(cancelApprovers(list).map((c) => c.id)).toEqual(['b', 'c']);
  });
});

describe('レジの担当者（3分で選び直し）', () => {
  it('触っていれば読める', () => {
    const now = 1_000_000;
    const raw = serializeClerkSession({ id: ID, name: 'Ronnie', role: 'store_manager', at: now });
    expect(parseClerkSession(raw, now + 60_000)).toEqual({
      id: ID,
      name: 'Ronnie',
      role: 'store_manager',
      at: now,
    });
  });

  it('3分さわらなかったら切れる', () => {
    const now = 1_000_000;
    const raw = serializeClerkSession({ id: ID, name: 'Ronnie', role: 'staff', at: now });
    expect(isClerkSessionExpired(now, now + CLERK_IDLE_MS - 1)).toBe(false);
    expect(isClerkSessionExpired(now, now + CLERK_IDLE_MS)).toBe(true);
    expect(parseClerkSession(raw, now + CLERK_IDLE_MS)).toBeNull();
  });

  it('触ると期限が延びる', () => {
    const session = { id: ID, name: 'Ronnie', role: 'staff' as const, at: 1_000 };
    expect(touchClerkSession(session, 5_000).at).toBe(5_000);
  });

  it('壊れた値は読まない', () => {
    const now = 1_000_000;
    expect(parseClerkSession(null, now)).toBeNull();
    expect(parseClerkSession('{', now)).toBeNull();
    expect(parseClerkSession(JSON.stringify({ id: 'x', name: 'a', at: now }), now)).toBeNull();
    expect(parseClerkSession(JSON.stringify({ id: ID, name: '  ', at: now }), now)).toBeNull();
    // 役職が知らない値でもスタッフとして読む（役職だけで落とさない）
    expect(parseClerkSession(JSON.stringify({ id: ID, name: 'a', role: 'boss', at: now }), now)?.role).toBe('staff');
  });
});
