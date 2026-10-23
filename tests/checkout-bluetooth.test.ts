import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { baseReceipt } from './fixtures/receipt';
import { parseCheckoutBluetoothLink } from '@/lib/checkout-bluetooth';
import { parseNativePosAction } from '@/lib/native-pos';
import { receiptToStarPrnt } from '@/lib/starprnt';
import { receiptToEposXml } from '@/lib/epos-print';
import { eposXmlToEscPos } from '@/lib/escpos';
vi.mock('server-only', () => ({}));
const load = vi.hoisted(() => vi.fn());
vi.mock('@/lib/receipts-loader', () => ({ loadReceiptData: load }));
import { checkoutBluetoothReceipt } from '@/lib/checkout-receipt-server';
const printerId = '11111111-2222-4333-8444-555555555555';
const link = { printerId, deviceId: 'Star-123', maker: 'star', via: 'bluetooth' as const };
function database(overrides: Record<string, unknown> = {}) {
  const row = { id: printerId, store_id: 'store', status: 'active', usage: 'receipt', auto_print: true, maker: 'Star', connection_type: 'bluetooth', paper_width_mm: 80, ...overrides };
  const from = vi.fn(() => {
    let matches = true;
    const q = { select: () => q, eq: (key: string, value: unknown) => { matches &&= row[key as keyof typeof row] === value; return q; }, maybeSingle: async () => ({ data: matches ? row : null, error: null }) };
    return q;
  });
  // Test double implements exactly the database operations used by this helper.
  return { from } as unknown as Parameters<typeof checkoutBluetoothReceipt>[0];
}
beforeEach(() => { load.mockReset(); load.mockResolvedValue({ receipt: baseReceipt, storeId: 'store' }); });
describe('checkout direct Bluetooth receipt', () => {
  it('returns the existing StarPRNT bytes and paired target without creating print jobs', async () => {
    const db = database();
    const result = await checkoutBluetoothReceipt(db, 'store', 'order', link);
    expect(result).toEqual({ data: receiptToStarPrnt(baseReceipt, { paperWidth: 80 }).toString('base64'), deviceId: link.deviceId, maker: 'star', via: 'bluetooth' });
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith('printer_configs');
  });
  it('returns ESC/POS for EPSON USB using the existing renderer', async () => {
    const result = await checkoutBluetoothReceipt(database({ maker: 'EPSON', connection_type: 'usb' }), 'store', 'order', { ...link, maker: 'epson', via: 'usb' });
    expect(result?.data).toBe(Buffer.from(eposXmlToEscPos(receiptToEposXml(baseReceipt, { paperWidth: 80 }))).toString('base64'));
    expect(result?.via).toBe('usb');
  });
  it.each([{ store_id: 'other' }, { auto_print: false }, { status: 'inactive' }, { usage: 'kitchen' }, { connection_type: 'lan' }, { connection_type: 'cloudprnt' }, { maker: 'EPSON' }])('does not bypass the queue for an ineligible printer %j', async (row) => {
    expect(await checkoutBluetoothReceipt(database(row), 'store', 'order', link)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
  it('old clients without a link retain the existing queue path', async () => {
    expect(await checkoutBluetoothReceipt(database(), 'store', 'order', undefined)).toBeNull();
  });
  it('receipt load failure does not report a direct handoff', async () => {
    load.mockResolvedValue(null);
    await expect(checkoutBluetoothReceipt(database(), 'store', 'order', link)).rejects.toThrow();
  });
  it('validates the native request target and rejects unsupported transports', () => {
    const action = { type: 'checkout', orderId: printerId, payments: [{ method: 'cash', amount: 1000, tendered: 1000 }], bluetoothLink: link };
    expect(parseNativePosAction(action).ok).toBe(true);
    expect(parseNativePosAction({ ...action, bluetoothLink: { ...link, via: 'agent' } }).ok).toBe(false);
    expect(parseCheckoutBluetoothLink({ ...link, deviceId: '' })).toBeNull();
  });
  it('only successful checkout hands off bytes, skips enqueue when returned, and prints before drawer work', () => {
    const actions = readFileSync('app/app/pos/actions.ts', 'utf8');
    expect(actions).toContain('const printer = receipt ? null : await receiptPrinterForAutoPrint');
    expect(actions).toContain('if (printer) await enqueueReceiptPrint(orderId);');
    expect(actions.indexOf('receipt = (await checkoutBluetoothReceipt')).toBeGreaterThan(actions.indexOf("supabase.rpc('finalize_order'"));
    const swift = readFileSync('ios/Shared/NativePosModels.swift', 'utf8');
    expect(swift.indexOf('WebViewController.printBluetooth')).toBeLessThan(swift.indexOf('"type": "drawer"'));
    expect(swift).not.toContain('next-bt');
    expect(readFileSync('app/api/app/v1/pos/route.ts', 'utf8')).toContain('receipt: outcome.receipt');
  });
});

describe('iPad local Bluetooth target selection', () => {
  const swift = readFileSync('ios/Shared/WebViewController.swift', 'utf8');
  const script = swift.slice(swift.indexOf('func checkoutBluetoothLink()')).match(/let script = """([\s\S]*?)"""/)![1];
  const choose = (links: unknown[], cookie = '') => runInNewContext(script, { localStorage: { getItem: () => JSON.stringify({ bluetooth: links }) }, document: { cookie } });
  it('selects the configured device and does not guess among multiple iPads/printers', () => {
    expect(choose([link]).deviceId).toBe(link.deviceId);
    expect(choose([link, { ...link, printerId: 'other' }])).toBeNull();
    expect(choose([link, { ...link, printerId: 'other' }], 'tenpo_device_printer=' + printerId).printerId).toBe(printerId);
    expect(choose([link], 'tenpo_device_printer=other')).toBeNull();
    expect(choose([{ ...link, via: 'agent' }])).toBeNull();
  });
});
