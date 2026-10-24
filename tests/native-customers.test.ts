import { describe, expect, it } from 'vitest';
import { isNativeCustomerActionType, parseNativeCustomerAction } from '@/lib/native-customers';

const id = '11111111-1111-4111-8111-111111111111';

describe('native customer actions', () => {
  it('validates create / note / attributes', () => {
    expect(isNativeCustomerActionType('customerCreate')).toBe(true);
    expect(parseNativeCustomerAction({ type: 'customerCreate', name: '  ' }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'customerCreate', name: '山田', birthday: '1990/01/01' }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'customerCreate', name: '山田', birthday: '1990-01-01' }).ok).toBe(true);
    expect(parseNativeCustomerAction({ type: 'customerNote', id, body: '' }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'customerAttributes', id, allergyNote: 'えび' }).ok).toBe(true);
    expect(parseNativeCustomerAction({ type: 'customerRecalc', id: 'x' }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'orderCustomer', orderId: id, customerId: null }).ok).toBe(true);
    expect(parseNativeCustomerAction({ type: 'orderCustomer', orderId: id, customerId: 'x' }).ok).toBe(false);
  });
});

describe('native customer detail actions', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const ID2 = '22222222-2222-4222-8222-222222222222';
  it('parses the detail operations with the same permission as the web', async () => {
    const { parseNativeCustomerAction, nativeCustomerPermission } = await import('@/lib/native-customers');
    expect(parseNativeCustomerAction({ type: 'customerBasic', id: ID, name: '山田', gender: 'female', birthday: '1990-01-02' }).ok).toBe(true);
    expect(parseNativeCustomerAction({ type: 'customerBasic', id: ID, name: '', gender: '' })).toEqual({ ok: false, error: '名前を入力してください' });
    expect(parseNativeCustomerAction({ type: 'customerBasic', id: ID, name: 'a', gender: 'x' }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'customerConsent', id: ID, consentType: 'marketing_line', granted: true }).ok).toBe(true);
    expect(parseNativeCustomerAction({ type: 'customerConsent', id: ID, consentType: 'sms', granted: true }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'customerTagCreate', id: ID, name: 'VIP', color: '#bc5940' }).ok).toBe(true);
    expect(parseNativeCustomerAction({ type: 'customerTagCreate', id: ID, name: 'VIP', color: 'red' }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'customerMemberRank', id: ID, rank: 'gold' }).ok).toBe(true);
    expect(parseNativeCustomerAction({ type: 'customerMemberRank', id: ID, rank: 'platinum' }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'customerPoints', id: ID, delta: -100, reason: '移行' })).toEqual({ ok: true, action: { type: 'customerPoints', id: ID, delta: -100, reason: '移行' } });
    expect(parseNativeCustomerAction({ type: 'customerPoints', id: ID, delta: 0, reason: 'x' }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'customerMerge', id: ID, mergeIds: [ID2] }).ok).toBe(true);
    expect(parseNativeCustomerAction({ type: 'customerMerge', id: ID, mergeIds: [ID] }).ok).toBe(false);
    expect(parseNativeCustomerAction({ type: 'customerDelete', id: ID, reason: '' })).toEqual({ ok: false, error: '理由を入力してください' });
    expect(nativeCustomerPermission('customerMerge')).toBe('customers.delete');
    expect(nativeCustomerPermission('customerPoints')).toBe('cash.approve');
    expect(nativeCustomerPermission('customerAnonymize')).toBe('org.settings');
    expect(nativeCustomerPermission('customerConsent')).toBe('customers.write');
    expect(nativeCustomerPermission('orderCustomer')).toBe('pos.order');
  });
});
