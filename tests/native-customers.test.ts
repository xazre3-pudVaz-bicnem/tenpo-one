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
  });
});
