import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { CheckoutBluetoothLink, CheckoutReceipt } from '@/lib/checkout-bluetooth';
import { bluetoothMakerOf } from '@/lib/direct-print';
import { drawerKickStarPrnt } from '@/lib/starprnt';
import { drawerKickEpos } from '@/lib/epos-print';
import { eposXmlToEscPos } from '@/lib/escpos';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * ドロアを開くバイト列を、iPad が Bluetooth・USB でつないでいるレシートプリンターへそのまま送る形で返す（キューに積まない）。
 * 会計のレシート（checkoutBluetoothReceipt）と同じ確かめ方：その店の有効なレシートプリンターで、ドロアを開く設定（drawer_kick）があり、
 * つなぎ方・メーカーが iPad の言うものと同じときだけ。使えなければ null（今まで通りキューへ＝enqueueDrawerKick）。
 * 2026-10-26 Ronnie「App bata Bluetooth le rezi chalne tyo pani banau」→「Sabai」（ドロアも Bluetooth で）
 */
export async function directDrawerBytes(supabase: Supabase, storeId: string, link: CheckoutBluetoothLink): Promise<CheckoutReceipt | null> {
  const { data, error } = await supabase
    .from('printer_configs')
    .select('id, maker, connection_type, drawer_kick, drawer_command')
    .eq('id', link.printerId)
    .eq('store_id', storeId)
    .eq('status', 'active')
    .eq('usage', 'receipt')
    .maybeSingle();
  if (error || !data) return null;
  const p = data as { maker: string | null; connection_type: string | null; drawer_kick: boolean | null; drawer_command: string | null };
  if (!p.drawer_kick || !['bluetooth', 'usb'].includes(p.connection_type ?? '')) return null;
  const maker = bluetoothMakerOf(p.maker);
  if (!maker || maker !== link.maker || p.connection_type !== link.via) return null;
  const bytes = maker === 'star' ? drawerKickStarPrnt(p.drawer_command ?? '') : eposXmlToEscPos(drawerKickEpos(p.drawer_command));
  return { data: Buffer.from(bytes).toString('base64'), deviceId: link.deviceId, maker, via: link.via };
}
