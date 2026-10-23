import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { loadReceiptData } from '@/lib/receipts-loader';
import { receiptToStarPrnt } from '@/lib/starprnt';
import { receiptToEposXml } from '@/lib/epos-print';
import { eposXmlToEscPos } from '@/lib/escpos';
import { bluetoothMakerOf } from '@/lib/direct-print';
import { parseCheckoutBluetoothLink, type CheckoutReceipt } from '@/lib/checkout-bluetooth';

/** Called only after successful checkout. A returned receipt must never also be enqueued. */
export async function checkoutBluetoothReceipt(
  supabase: Awaited<ReturnType<typeof createClient>>, storeId: string, orderId: string, requestLink: unknown
): Promise<CheckoutReceipt | null> {
  const link = parseCheckoutBluetoothLink(requestLink);
  if (!link) return null;
  const { data: printer, error } = await supabase.from('printer_configs')
    .select('id, maker, connection_type, paper_width_mm')
    .eq('id', link.printerId).eq('store_id', storeId).eq('status', 'active')
    .eq('usage', 'receipt').eq('auto_print', true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!printer || !['bluetooth', 'usb'].includes(printer.connection_type ?? '')) return null;
  const maker = bluetoothMakerOf(printer.maker);
  if (!maker || maker !== link.maker || printer.connection_type !== link.via) return null;
  const loaded = await loadReceiptData(supabase, orderId);
  if (!loaded || loaded.storeId !== storeId) throw new Error('レシートデータの取得に失敗しました');
  const paperWidth = printer.paper_width_mm === 58 ? 58 : 80;
  const bytes = maker === 'star' ? receiptToStarPrnt(loaded.receipt, { paperWidth })
    : Buffer.from(eposXmlToEscPos(receiptToEposXml(loaded.receipt, { paperWidth })));
  return { data: bytes.toString('base64'), deviceId: link.deviceId, maker, via: link.via };
}
