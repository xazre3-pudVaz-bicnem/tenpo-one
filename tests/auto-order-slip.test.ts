import { describe, expect, it, vi } from 'vitest';
import { autoOrderSlipAfterSend } from '@/lib/auto-order-slip';

describe('order-time bill slip', () => {
  it('does not inspect or enqueue for an empty/repeated send', async () => {
    const eligible = vi.fn(async () => true);
    const enqueue = vi.fn(async () => ({ ok: true }));
    expect(await autoOrderSlipAfterSend(0, eligible, enqueue)).toBeNull();
    expect(eligible).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('queues one bill for several sent items when a category is opted in', async () => {
    const enqueue = vi.fn(async () => ({ ok: true }));
    expect(await autoOrderSlipAfterSend(5, async () => true, enqueue)).toBeNull();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('does not print for categories left off', async () => {
    const enqueue = vi.fn(async () => ({ ok: true }));
    expect(await autoOrderSlipAfterSend(2, async () => false, enqueue)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('keeps kitchen send successful while returning a bill-print warning, without retrying', async () => {
    const enqueue = vi.fn(async () => ({ ok: false, error: 'offline' }));
    expect(await autoOrderSlipAfterSend(1, async () => true, enqueue)).toContain('offline');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await autoOrderSlipAfterSend(1, async () => { throw Error('network'); }, enqueue)).toContain('手動');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
