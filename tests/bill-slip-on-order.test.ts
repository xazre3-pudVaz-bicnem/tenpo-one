import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('server-only', () => ({}));

import { hasItemsSinceLastOrderSlip, orderHasBillSlipCategory } from '@/lib/bill-slip-on-order';

const read = (p: string) => readFileSync(p, 'utf8');

type Row = Record<string, unknown>;
interface Fixture {
  order_items: Row[];
  menu_items: Row[];
  menu_categories: Row[];
  print_jobs: Row[];
  /** menu_categories に print_bill_on_order 列がまだ無い（migration 00101 未適用） */
  missingColumn?: boolean;
}

/** supabase の問い合わせの必要な分だけ（eq / in / not is null / gt / order / limit / maybeSingle） */
function fakeAdmin(fx: Fixture) {
  return {
    from(table: keyof Fixture) {
      let rows = [...((fx[table] as Row[]) ?? [])];
      let error: { message: string } | null = null;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          if (table === 'menu_categories' && k === 'print_bill_on_order' && fx.missingColumn) {
            error = { message: 'column menu_categories.print_bill_on_order does not exist' };
          }
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        in: (k: string, vs: unknown[]) => {
          rows = rows.filter((r) => vs.includes(r[k]));
          return q;
        },
        not: (k: string) => {
          rows = rows.filter((r) => r[k] != null);
          return q;
        },
        gt: (k: string, v: string) => {
          rows = rows.filter((r) => String(r[k]) > v);
          return q;
        },
        order: (k: string, o: { ascending: boolean }) => {
          rows.sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (o.ascending ? 1 : -1));
          return q;
        },
        limit: (n: number) => {
          rows = rows.slice(0, n);
          return q;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: error ? null : rows, error }).then(resolve),
      };
      return q;
    },
  };
}

const base = (): Fixture => ({
  order_items: [
    { id: 'i1', order_id: 'o1', status: 'active', kitchen_sent_at: '2026-10-23T10:00:00Z', menu_item_id: 'drink', created_at: '2026-10-23T10:00:00Z' },
    { id: 'i2', order_id: 'o1', status: 'active', kitchen_sent_at: '2026-10-23T10:00:00Z', menu_item_id: 'meat', created_at: '2026-10-23T10:00:00Z' },
    { id: 'i3', order_id: 'o2', status: 'active', kitchen_sent_at: '2026-10-23T10:00:00Z', menu_item_id: 'drink', created_at: '2026-10-23T10:00:00Z' },
    { id: 'i4', order_id: 'o3', status: 'cancelled', menu_item_id: 'meat', created_at: '2026-10-23T10:00:00Z' },
  ],
  menu_items: [
    { id: 'drink', category_id: 'cat-drink' },
    { id: 'meat', category_id: 'cat-meat' },
  ],
  menu_categories: [
    { id: 'cat-drink', print_bill_on_order: false },
    { id: 'cat-meat', print_bill_on_order: true },
  ],
  print_jobs: [],
});

describe('注文時の会計伝票：orderHasBillSlipCategory（2026-10-23）', () => {
  it('ON のカテゴリの商品が1つでもあれば true', async () => {
    expect(await orderHasBillSlipCategory(fakeAdmin(base()), 'o1')).toBe(true);
  });
  it('ON のカテゴリの商品が無ければ false（今まで通り自動では出ない）', async () => {
    expect(await orderHasBillSlipCategory(fakeAdmin(base()), 'o2')).toBe(false);
  });
  it('取消した明細は数えない', async () => {
    expect(await orderHasBillSlipCategory(fakeAdmin(base()), 'o3')).toBe(false);
  });
  it('どのカテゴリも OFF の店は false', async () => {
    const fx = base();
    fx.menu_categories = fx.menu_categories.map((c) => ({ ...c, print_bill_on_order: false }));
    expect(await orderHasBillSlipCategory(fakeAdmin(fx), 'o1')).toBe(false);
  });
  it('DB に列がまだ無い（migration 00101 未適用）ときは false で止まらない', async () => {
    expect(await orderHasBillSlipCategory(fakeAdmin({ ...base(), missingColumn: true }), 'o1')).toBe(false);
  });
});

describe('お客様QRの二重印刷を防ぐ：hasItemsSinceLastOrderSlip', () => {
  it('まだ会計伝票を出していなければ true', async () => {
    expect(await hasItemsSinceLastOrderSlip(fakeAdmin(base()), 'o1')).toBe(true);
  });
  it('前の会計伝票のあとに頼んだ分が無ければ false（同じ知らせが2回来ても2枚目は出さない）', async () => {
    const fx = base();
    fx.print_jobs = [{ order_id: 'o1', job_type: 'order_slip', created_at: '2026-10-23T10:00:05Z' }];
    expect(await hasItemsSinceLastOrderSlip(fakeAdmin(fx), 'o1')).toBe(false);
  });
  it('前の会計伝票のあとに追加で頼んだら true（1回の送信で1枚）', async () => {
    const fx = base();
    fx.print_jobs = [{ order_id: 'o1', job_type: 'order_slip', created_at: '2026-10-23T10:00:05Z' }];
    fx.order_items.push({ id: 'i5', order_id: 'o1', status: 'active', kitchen_sent_at: '2026-10-23T10:00:00Z', menu_item_id: 'meat', created_at: '2026-10-23T10:30:00Z' });
    expect(await hasItemsSinceLastOrderSlip(fakeAdmin(fx), 'o1')).toBe(true);
  });
});

describe('注文時の会計伝票：呼び出す場所と設定', () => {
  it('レジ・ハンディ：厨房へ送れた（送った明細が1つ以上）ときだけ判定して1回積む', () => {
    const pos = read('app/app/pos/actions.ts');
    expect(pos).toContain('if (!(await orderHasBillSlipCategory(createAdminClient(), orderId))) return;');
    expect(pos).toContain('const res = await enqueueOrderSlipPrint(orderId, true);');
    // sendOrderToKitchen（レジ・iPad アプリ）
    expect(pos).toContain('  if (sent > 0) {\n    kickKitchenPrint(order.store_id);\n    await printBillSlipOnSend(orderId);\n  }');
    // sendItemsToKitchen（ハンディの「注文を送信」）
    expect(pos).toContain('  if ((data ?? []).length > 0) {\n    kickKitchenPrint(order.store_id);\n    await printBillSlipOnSend(orderId);\n  }');
    expect(pos.match(/await printBillSlipOnSend\(orderId\);/g)?.length).toBe(2);
  });
  it('お客様QR：厨房伝票を作ったあと、その卓の未会計の注文で判定し、前の会計伝票のあとの分があるときだけ積む', () => {
    const route = read('app/api/qr/kitchen-now/route.ts');
    const made = route.indexOf('await generateKitchenJobsForStore(admin, table.store_id as string);');
    const bill = route.indexOf('await orderHasBillSlipCategory(admin, open.id)');
    expect(made).toBeGreaterThan(0);
    expect(bill).toBeGreaterThan(made);
    expect(route).toContain('await queueOrderSlipJob(admin, open.id, { createdBy: null, automatic: true });');
  });
  it('ボタンの会計伝票と同じ印字（queueOrderSlipJob）。ボタンは今まで通りログインと店舗の権限を確かめる', () => {
    const actions = read('app/app/pos/print-actions.ts');
    expect(actions).toContain("const ctx = await requirePermission('pos.order');");
    expect(actions).toContain('canAccessStore: (storeId) => assertStore(ctx, storeId),');
    const core = read('lib/order-slip-print.ts');
    expect(core).toContain("job_type: 'order_slip',");
    expect(core).toContain('created_by: opts.createdBy,');
  });
  it('列は既定 OFF。店舗・カテゴリはコードに書かない（設定 > カテゴリ のトグルで選ぶ）', () => {
    const sql = read('supabase/migrations/00101_category_print_bill_on_order.sql');
    expect(sql).toContain('add column if not exists print_bill_on_order boolean not null default false');
    const panel = read('app/app/settings/menu/station-panel.tsx');
    expect(panel).toContain('注文時に会計伝票を印刷');
    expect(panel).toContain('await updateCategoryBillOnOrder(id, on)');
    for (const f of ['lib/bill-slip-on-order.ts', 'lib/order-slip-print.ts', 'app/api/qr/kitchen-now/route.ts']) {
      expect(read(f)).not.toMatch(/MEAT|CROWN|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });
});
