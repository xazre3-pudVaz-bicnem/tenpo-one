import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { generateKitchenJobs } from '@/lib/print-queue';

type Row = Record<string, unknown>;

/** print-queue が使う分だけの、Supabase の代わり（テーブルごとに返す行を決める） */
function fakeAdmin(opts: {
  claimed: Row[];
  settings: unknown;
  orderItems?: Row[];
  menuItems?: Row[];
  failOrderItems?: boolean;
}) {
  const inserted: Row[][] = [];
  const queried: string[] = [];
  const chain = (table: string, rows: Row[], fail = false) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = self;
    q.neq = self;
    q.in = self;
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    q.then = (resolve: (v: unknown) => unknown) => {
      queried.push(table);
      return Promise.resolve(fail ? { data: null, error: { message: 'boom' } } : { data: rows, error: null }).then(resolve);
    };
    return q;
  };
  const admin = {
    rpc: async () => ({ data: opts.claimed, error: null }),
    from: (table: string) => {
      if (table === 'store_settings') return chain(table, [{ settings: opts.settings }]);
      if (table === 'order_items') return chain(table, opts.orderItems ?? [], opts.failOrderItems);
      if (table === 'menu_items') return chain(table, opts.menuItems ?? []);
      if (table === 'print_jobs') return { insert: async (rows: Row[]) => (inserted.push(rows), { error: null }) };
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin: admin as never, inserted, queried };
}

const printer = {
  id: 'p1',
  store_id: 's1',
  organization_id: 'org1',
  paper_width_mm: 80,
  kitchen_stations: ['kitchen'],
  upside_down: false,
} as never;

const claimedCourse: Row = {
  order_item_id: 'oi1',
  order_id: 'o1',
  order_no: 7001,
  table_name: 'T3',
  guest_count: 2,
  clerk_name: 'Ronnie',
  item_name: 'Girls party 12',
  item_name_en: 'Girls party 12',
  item_name_kana: null,
  modifiers: [],
  memo: null,
  station: 'kitchen',
  delta: 2,
};

const bodyOf = (inserted: Row[][]) => (inserted[0]?.[0]?.payload as { body: string }).body;

describe('generateKitchenJobs: コースの料理を順番に印字', () => {
  const dishes = [
    { id: 'd1', name: '前菜', name_en: 'Appetizer', name_kana: null },
    { id: 'd2', name: 'サラダ', name_en: 'Salad', name_kana: null },
    { id: 'd3', name: 'デザート', name_en: 'Dessert', name_kana: null },
  ];

  it('料理を決めたコースは 1st, 2nd, 3rd の順に出る', async () => {
    const { admin, inserted } = fakeAdmin({
      claimed: [claimedCourse],
      settings: { kitchenTicket: { split: 'order', language: 'en' }, courseSteps: { c1: ['d1', 'd2', 'd3'] } },
      orderItems: [{ id: 'oi1', menu_item_id: 'c1' }],
      menuItems: dishes,
    });
    await generateKitchenJobs(admin, printer);
    expect(inserted).toHaveLength(1);
    const body = bodyOf(inserted);
    const at = (s: string) => body.indexOf(s);
    expect(at('1st Appetizer')).toBeGreaterThan(-1);
    expect(at('2nd Salad')).toBeGreaterThan(at('1st Appetizer'));
    expect(at('3rd Dessert')).toBeGreaterThan(at('2nd Salad'));
    expect(body).toContain('x2');
  });

  it('その店がコースの料理を決めていなければ、これまでどおりコース名だけ（余計な問い合わせもしない）', async () => {
    const { admin, inserted, queried } = fakeAdmin({
      claimed: [claimedCourse],
      settings: { kitchenTicket: { split: 'order', language: 'en' } },
    });
    await generateKitchenJobs(admin, printer);
    const body = bodyOf(inserted);
    expect(body).toContain('Girls party 12');
    expect(body).not.toContain('1st');
    expect(queried).toEqual([]);
  });

  it('料理を調べるのに失敗しても、コース名で伝票は出す（止めない）', async () => {
    const { admin, inserted } = fakeAdmin({
      claimed: [claimedCourse],
      settings: { courseSteps: { c1: ['d1'] } },
      failOrderItems: true,
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await generateKitchenJobs(admin, printer);
    spy.mockRestore();
    expect(inserted).toHaveLength(1);
    expect(bodyOf(inserted)).toContain('Girls party 12');
  });

  it('コースでない商品はそのまま出る', async () => {
    const { admin, inserted } = fakeAdmin({
      claimed: [{ ...claimedCourse, order_item_id: 'oi9', item_name: 'ナン', item_name_en: 'Naan' }],
      settings: { courseSteps: { c1: ['d1', 'd2'] } },
      orderItems: [{ id: 'oi9', menu_item_id: 'm-naan' }],
      menuItems: dishes,
    });
    await generateKitchenJobs(admin, printer);
    expect(bodyOf(inserted)).toContain('Naan');
    expect(bodyOf(inserted)).not.toContain('1st');
  });
});
