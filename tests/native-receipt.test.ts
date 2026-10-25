import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

// レシートのプレビュー（ネイティブ。2026-10-25 12:49 Ronnie「レシートのプレビュー Native banau」）
// 中身・入口の確かめは Web の /app/pos/receipt/[orderId] と同じ

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    order: null as Row | null,
    items: [] as Row[],
    payments: [] as Row[],
    settings: null as Row | null,
    refunds: [] as Row[],
    pointTx: [] as Row[],
    jobs: [] as Row[],
    printers: 0,
    customer: null as Row | null,
    register: null as Row | null,
    selects: [] as { table: string; cols: string }[],
  };
  const client = {
    from(table: string) {
      const filters: Row = {};
      const result = (single: boolean) => {
        switch (table) {
          case 'orders':
            return { data: state.order && state.order.id === filters.id ? state.order : null, error: null };
          case 'order_items':
            return { data: state.items, error: null };
          case 'payments':
            return { data: state.payments, error: null };
          case 'store_settings':
            return { data: state.settings, error: null };
          case 'refunds':
            return { data: state.refunds, error: null };
          case 'point_transactions':
            return { data: state.pointTx, error: null };
          case 'print_jobs':
            return { data: state.jobs, error: null };
          case 'printer_configs':
            return { data: null, count: state.printers, error: null };
          case 'customers':
            return { data: state.customer, error: null };
          case 'register_sessions':
            return { data: state.register, error: null };
          default:
            return { data: single ? null : [], error: null };
        }
      };
      const q: Record<string, unknown> = {
        select: (cols: string) => { state.selects.push({ table, cols }); return q; },
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        order: () => q,
        maybeSingle: async () => result(true),
        single: async () => result(true),
        then: (resolve: (r: unknown) => void) => resolve(result(false)),
      };
      return q;
    },
  };
  return { state, client };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.client }));

import { buildNativeReceiptBody, parseNativeReceiptQuery, receiptGet } from '@/lib/native-modules/receipt';
import { buildReceipt } from '@/lib/receipts';
import { METHOD_LABELS } from '@/components/cash/labels';
import type { SessionContext } from '@/lib/auth';

const ORDER = '11111111-1111-4111-8111-111111111111';
const STORE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '44444444-4444-4444-8444-444444444444';

const ctx = (patch: Partial<SessionContext> = {}): SessionContext => ({
  userId: 'u', email: null, displayName: '山田 太郎', isCypressAdmin: false, organizationId: 'org', organizationName: 'テスト',
  role: 'store_manager' as SessionContext['role'], stores: [{ id: STORE, name: 'TENPO ONE 新宿店' }] as SessionContext['stores'],
  currentStore: { id: STORE, name: 'TENPO ONE 新宿店' } as SessionContext['currentStore'], isHq: false, disabledFeatures: new Set(), ...patch,
});
const get = (query: string, c = ctx(), store = { id: STORE, name: 'TENPO ONE 新宿店' }) =>
  receiptGet({ ctx: c, store, url: new URL(`https://x.test/api/app/v1/pos?part=receipt&${query}`) });

const baseOrder = () => ({
  id: ORDER, order_no: 1024, order_type: 'dine_in', status: 'paid', guest_count: 2, subtotal: 3000, tax_total: 300, service_charge: 0,
  discount_total: 200, coupon_code: 'WELCOME', customer_id: null, register_session_id: null, staff_id: null, clerk_name: '山田 太郎',
  total: 3100, opened_at: '2026-10-25T09:00:00.000Z', closed_at: '2026-10-25T10:30:00.000Z', business_date: '2026-10-25', store_id: STORE,
  stores: { name: 'TENPO ONE 新宿店', address: '東京都新宿区新宿2-1-1 テストビル3F', phone: '03-0000-0000' },
  profiles: { display_name: '店長' }, restaurant_tables: { name: 'A-3' },
});

beforeEach(() => {
  Object.assign(h.state, {
    order: baseOrder(),
    items: [
      { id: 'i1', name: '生ビール', unit_price: 600, quantity: 2, tax_rate: 10, tax_included: true, line_total: 1200, modifiers: [] },
      { id: 'i2', name: '飲み放題の中身', unit_price: 0, quantity: 1, tax_rate: 10, tax_included: true, line_total: 0, modifiers: [] },
      { id: 'i3', name: '生ビール', unit_price: 600, quantity: 1, tax_rate: 10, tax_included: true, line_total: 600, modifiers: [] },
      { id: 'i4', name: '唐揚げ', unit_price: 1500, quantity: 1, tax_rate: 10, tax_included: true, line_total: 1500, modifiers: [{ name: '大盛り', price: 0 }] },
    ],
    payments: [
      { method: 'cash', amount: 2000, tendered: 5000, change_amount: 3000, paid_at: '2026-10-25T10:30:00.000Z' },
      { method: 'credit', amount: 1100, tendered: null, change_amount: null, paid_at: '2026-10-25T10:30:01.000Z' },
    ],
    settings: { receipt_header: null, receipt_footer: null, invoice_registration_number: 'T1234567890123' },
    refunds: [],
    pointTx: [],
    jobs: [],
    printers: 1,
    customer: null,
    register: null,
    selects: [],
  });
});

describe('レシートのプレビュー：入口', () => {
  it('?id= は UUID だけ。reissue=1 は再発行の印', () => {
    expect(parseNativeReceiptQuery(new URLSearchParams({ id: ORDER, reissue: '1' }))).toEqual({ id: ORDER, reissue: true });
    expect(parseNativeReceiptQuery(new URLSearchParams({ id: ORDER }))).toEqual({ id: ORDER, reissue: false });
    expect(parseNativeReceiptQuery(new URLSearchParams({ id: 'abc' }))).toBeNull();
    expect(parseNativeReceiptQuery(new URLSearchParams())).toBeNull();
  });

  it('壊れた id は 400、無い伝票は 404', async () => {
    expect((await get('id=nope')).status).toBe(400);
    h.state.order = null;
    const r = await get(`id=${ORDER}`);
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
  });

  it('ほかの店の伝票は本部以外 404（Web のページと同じ）。本部なら見られる', async () => {
    h.state.order = { ...baseOrder(), store_id: OTHER };
    expect((await get(`id=${ORDER}`)).status).toBe(404);
    const hq = await get(`id=${ORDER}`, ctx({ isHq: true }));
    expect(hq.status).toBeUndefined();
    expect(hq.body.ok).toBe(true);
  });
});

describe('レシートのプレビュー：中身（Web の ReceiptView と同じ）', () => {
  it('明細は0円を落として同じものをまとめる・支払方法は METHOD_LABELS・預り金とお釣り', async () => {
    const r = await get(`id=${ORDER}`);
    const b = r.body as ReturnType<typeof buildNativeReceiptBody>;
    expect(b.ok).toBe(true);
    expect(b.orderId).toBe(ORDER);
    expect(b.storeName).toBe('TENPO ONE 新宿店');
    expect(b.receipt.lines.map((l) => [l.name, l.quantity, l.lineTotal])).toEqual([
      ['生ビール', 3, 1800],
      ['唐揚げ', 1, 1500],
    ]);
    expect(b.receipt.lines[1].modifiers).toEqual([{ name: '大盛り', price: 0 }]);
    expect(b.receipt.payments).toEqual([
      { label: METHOD_LABELS.cash, amount: 2000 },
      { label: METHOD_LABELS.credit, amount: 1100 },
    ]);
    expect(b.receipt.tendered).toBe(5000);
    expect(b.receipt.change).toBe(3000);
    expect(b.receipt.tableName).toBe('A-3');
    expect(b.receipt.staffName).toBe('山田 太郎');
    expect(b.receipt.discount).toBe(200);
    expect(b.receipt.couponCode).toBe('WELCOME');
    expect(b.receipt.registrationNumber).toBe('T1234567890123');
    expect(b.receipt.storeAddress).toBe('東京都新宿区新宿2-1-1\nテストビル3F');
    expect(b.receipt.completedAt).toBeTruthy();
    expect(b.receipt.isReissue).toBe(false);
    expect(b.receipt.qrContent.startsWith('TENPOONE:1024:')).toBe(true);
    // 非会員はポイント欄を出さない
    expect(b.receipt.pointsEarned).toBeNull();
    expect(b.receipt.pointBalance).toBeNull();
    expect(b.canPrint).toBe(true);
    expect(b.canRyoshusho).toBe(true);
    expect(b.printerReady).toBe(true);
    expect(b.ryoshusho).toMatchObject({ issued: false, count: 0, atLabel: '' });
    expect(b.invoice.amount).toBe(3100);
    expect(b.invoice.invoiceNote).toBe('（適格簡易請求書・登録番号記載）');
  });

  it('reissue=1 は再発行の印（Web と同じ）', async () => {
    const b = (await get(`id=${ORDER}&reissue=1`)).body as ReturnType<typeof buildNativeReceiptBody>;
    expect(b.receipt.isReissue).toBe(true);
  });

  it('テイクアウト（卓なし）は「テイクアウト」。会員はポイント（付与・利用・残高）', async () => {
    h.state.order = { ...baseOrder(), order_type: 'takeout', restaurant_tables: null, customer_id: CUSTOMER };
    h.state.pointTx = [{ kind: 'earn', points: 31 }, { kind: 'redeem', points: -100 }];
    h.state.customer = { point_balance: 420 };
    const b = (await get(`id=${ORDER}`)).body as ReturnType<typeof buildNativeReceiptBody>;
    expect(b.receipt.tableName).toBe('テイクアウト');
    expect(b.receipt.pointsEarned).toBe(31);
    expect(b.receipt.pointsUsed).toBe(100);
    expect(b.receipt.pointBalance).toBe(420);
  });

  it('返金があれば返金・実質お支払い額。取消（VOID）の伝票は領収書を出せない', async () => {
    h.state.refunds = [{ amount: 1100, kind: 'void' }];
    const b = (await get(`id=${ORDER}`)).body as ReturnType<typeof buildNativeReceiptBody>;
    expect(b.receipt.refundTotal).toBe(1100);
    expect(b.receipt.netPaid).toBe(2000);
    expect(b.canRyoshusho).toBe(false);
    expect(b.invoice.amount).toBe(2000);
  });

  it('領収書は一度きり：print_jobs に失敗以外があれば発行済み（日時・枚数）', async () => {
    h.state.jobs = [
      { job_type: 'ryoshusho', status: 'failed', printed_at: null, created_at: '2026-10-25T10:31:00.000Z', sheets: null },
      { job_type: 'ryoshusho', status: 'printed', printed_at: '2026-10-25T10:40:00.000Z', created_at: '2026-10-25T10:39:00.000Z', sheets: 2 },
    ];
    const b = (await get(`id=${ORDER}`)).body as ReturnType<typeof buildNativeReceiptBody>;
    expect(b.ryoshusho.issued).toBe(true);
    expect(b.ryoshusho.count).toBe(2);
    expect(b.ryoshusho.atLabel).toBe('10/25 19:40');
    expect(b.ryoshusho.message).toContain('一度しか');
  });

  it('未会計の伝票は再印刷・領収書なし。プリンター未設定は printerReady=false', async () => {
    h.state.order = { ...baseOrder(), status: 'open', closed_at: null };
    h.state.printers = 0;
    const b = (await get(`id=${ORDER}`)).body as ReturnType<typeof buildNativeReceiptBody>;
    expect(b.canPrint).toBe(false);
    expect(b.canRyoshusho).toBe(false);
    expect(b.printerReady).toBe(false);
    expect(b.receipt.completedAt).toBeNull();
  });

  it('領収書の座標は印字と同じ（classicInvoiceLayout）。Swift で読めるように全部の項目がそろう', () => {
    const receipt = buildReceipt({
      store: { name: 'TENPO ONE 新宿店', registrationNumber: 'T1234567890123' },
      order: { orderNo: 7, closedAt: '2026-10-25T10:30:00.000Z', subtotal: 1000, taxTotal: 100, serviceCharge: 0, discountTotal: 0, total: 1100 },
      items: [{ name: 'ランチ', quantity: 1, unitPrice: 1100, lineTotal: 1100, taxRate: 10 }],
      payments: [{ method: 'cash', amount: 1100 }],
      methodLabels: METHOD_LABELS,
    });
    const b = buildNativeReceiptBody({ orderId: ORDER, status: 'paid', hasVoid: false, receipt, ryoshusho: { issued: false, at: null, count: 0 }, printerReady: false });
    const layout = b.invoice.layout;
    expect(layout.width).toBe(1080);
    expect(layout.height).toBeGreaterThan(300);
    expect(layout.items.some((i) => i.kind === 'text' && i.text === '領 収 書')).toBe(true);
    expect(layout.items.some((i) => i.kind === 'text' && i.text === '¥1,100−')).toBe(true);
    expect(layout.items.some((i) => i.kind === 'box' && i.h > 0)).toBe(true);
    for (const it of layout.items) {
      expect(Object.keys(it).sort()).toEqual(['align', 'bold', 'h', 'kind', 'size', 'text', 'w', 'x', 'y']);
      expect(['left', 'right', 'center']).toContain(it.align);
    }
  });
});

describe('レシートのプレビュー：登録（1 行ずつ）', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  it('GET part=receipt がサーバー・iPad・iPhone に登録されている', () => {
    expect(read('lib/native-modules/registry.ts')).toMatch(/receipt: receiptGet/);
    expect(read('ios/Shared/NativeModules.swift')).toMatch(/\("\/app\/pos\/receipt", "receipt"\)/);
    expect(read('ios/Shared/NativePhoneOwner.swift')).toMatch(/\("\/app\/pos\/receipt", "receipt"\)/);
    expect(read('ios/Shared/NativeReceiptView.swift')).toMatch(/part: "receipt"/);
  });
});
