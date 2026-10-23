import { beforeEach, describe, expect, it, vi } from 'vitest';
import { splitCheckoutReturn, splitCheckoutUrl } from '../lib/split-checkout-return';

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn(), assertStoreAccess: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requirePermission: mocks.requirePermission, assertStoreAccess: mocks.assertStoreAccess }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: mocks.from }) }));
import { readSplitCheckoutReturn } from '../app/app/pos/split-return-action';
const parentId = '00000000-0000-4000-8000-000000000001';
const childId = '00000000-0000-4000-8000-000000000002';
const parent = { id: parentId, status: 'open', total: 7310 };
function query(result: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(), limit: vi.fn() };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.gt.mockReturnValue(q);
  q.single.mockResolvedValue(result); q.maybeSingle.mockResolvedValue(result); q.limit.mockResolvedValue(result);
  return q;
}
beforeEach(() => { vi.resetAllMocks(); mocks.requirePermission.mockResolvedValue({}); mocks.assertStoreAccess.mockResolvedValue(undefined); });
describe('split checkout return', () => {
  it('opens the split child with its immediate original ID and returns with checkout enabled', () => {
    const url = new URL(splitCheckoutUrl(childId, parentId), 'https://example.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({ order: childId, checkout: '1', from: parentId });
    expect(splitCheckoutReturn(parentId, parent, true)).toEqual({ href: `/app/pos?order=${parentId}&checkout=1`, total: 7310 });
  });
  it('falls back for missing, closed, cancelled, empty or mismatched orders', () => {
    for (const order of [null, { ...parent, status: 'paid' }, { ...parent, status: 'cancelled' }, { ...parent, id: childId }]) expect(splitCheckoutReturn(parentId, order, true)).toBeNull();
    expect(splitCheckoutReturn(undefined, parent, true)).toBeNull();
    expect(splitCheckoutReturn(parentId, parent, false)).toBeNull();
    expect(splitCheckoutReturn(parentId, { ...parent, total: NaN }, true)).toBeNull();
    expect(splitCheckoutReturn(parentId, { ...parent, total: 0 }, true)?.total).toBe(0);
  });
  it('reads the remaining active items after checkout and scopes the parent to the permitted store', async () => {
    const current = query({ data: { store_id: 'store-a', source_order_id: parentId }, error: null });
    const original = query({ data: parent, error: null });
    const items = query({ data: [{ id: 'item' }], error: null });
    mocks.from.mockReturnValueOnce(current).mockReturnValueOnce(original).mockReturnValueOnce(items);
    expect(await readSplitCheckoutReturn(childId, parentId)).toEqual({ href: `/app/pos?order=${parentId}&checkout=1`, total: 7310 });
    expect(mocks.requirePermission).toHaveBeenCalledWith('pos.checkout');
    expect(mocks.assertStoreAccess).toHaveBeenCalledWith({}, 'store-a');
    expect(original.eq).toHaveBeenCalledWith('store_id', 'store-a');
    expect(items.eq).toHaveBeenCalledWith('status', 'active');
    expect(items.gt).toHaveBeenCalledWith('quantity', 0);
  });
  it('rejects arbitrary from IDs and inaccessible stores before reading remaining items', async () => {
    mocks.from.mockReturnValueOnce(query({ data: { store_id: 'store-a', source_order_id: childId }, error: null }));
    expect(await readSplitCheckoutReturn(childId, parentId)).toBeNull();
    expect(mocks.from).toHaveBeenCalledTimes(1);
    mocks.from.mockReset().mockReturnValueOnce(query({ data: { store_id: 'store-a', source_order_id: parentId }, error: null }));
    mocks.assertStoreAccess.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(readSplitCheckoutReturn(childId, parentId)).rejects.toThrow('Forbidden');
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it('fails closed on read errors and rejects malformed or self return IDs', async () => {
    expect(await readSplitCheckoutReturn(childId, 'invalid')).toBeNull();
    expect(await readSplitCheckoutReturn(childId, childId)).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.from.mockReturnValueOnce(query({ data: null, error: { message: 'read failed' } }));
    expect(await readSplitCheckoutReturn(childId, parentId)).toBeNull();
  });
});
