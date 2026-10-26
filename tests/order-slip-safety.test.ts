import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/device-printer-server', () => ({ devicePrinterId: async () => null }));
import { queueOrderSlipJob } from '@/lib/order-slip-print';

function fixture() {
  const jobs = new Map<string, Record<string, unknown>>();
  const items = [
    { id: 'sent', kitchen_sent_at: '2026-10-23T10:00:00Z', status: 'active', order_id: 'order', name: 'Sent food', quantity: 1, unit_price: 1100, line_total: 1100, tax_rate: 10, tax_included: true, modifiers: [] },
    { id: 'draft', kitchen_sent_at: null, status: 'active', order_id: 'order', name: 'Unsent food', quantity: 1, unit_price: 2200, line_total: 2200, tax_rate: 10, tax_included: true, modifiers: [] },
  ];
  const order = { id: 'order', organization_id: 'org', store_id: 'store', order_no: 10, stores: { name: 'Shop' }, restaurant_tables: { name: 'T1', floor_id: null }, subtotal: 3000, tax_total: 300, service_charge: 0, discount_total: 0, total: 3300 };
  const db = { from(table: string) {
    let rows: Record<string, unknown>[] = table === 'orders' ? [order] : table === 'order_items' ? [...items] : table === 'store_settings' ? [{ service_charge_rate: 0 }] : [{ id: 'printer', store_id: 'store', usage: 'receipt', status: 'active', cloudprnt_enabled: true, floor_ids: [], paper_width_mm: 80 }];
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return q; },
      or: () => q, order: () => q, limit: () => q,
      single: async () => ({ data: rows[0], error: null }),
      maybeSingle: async () => ({ data: rows[0], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      insert: async (job: Record<string, unknown>) => {
        const id = String(job.id);
        if (jobs.has(id)) return { error: { code: '23505', message: 'duplicate key' } };
        jobs.set(id, job); return { error: null };
      },
    };
    return q;
  } };
  return { db, jobs, items };
}

describe('automatic bill slip safety', () => {
  it('concurrent duplicate callbacks insert once, exclude drafts, and total only printed items', async () => {
    const { db, jobs } = fixture();
    const results = await Promise.all(Array.from({ length: 3 }, () => queueOrderSlipJob(db, 'order', { createdBy: null, automatic: true })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.reduce((sum, r) => sum + (r.queued ?? 0), 0)).toBe(1);
    expect(jobs.size).toBe(1);
    const payload = [...jobs.values()][0].payload as { body: string };
    expect(payload.body).toContain('Sent food');
    expect(payload.body).not.toContain('Unsent food');
    expect(payload.body).toContain('¥1,100');
    expect(payload.body).not.toContain('¥3,300');
  });
  it('newly sent items produce a new job even after an earlier slip was queued', async () => {
    const { db, jobs, items } = fixture();
    await queueOrderSlipJob(db, 'order', { createdBy: null, automatic: true });
    items[1].kitchen_sent_at = '2026-10-23T10:01:00Z';
    await queueOrderSlipJob(db, 'order', { createdBy: null, automatic: true });
    expect(jobs.size).toBe(2);
  });
});
