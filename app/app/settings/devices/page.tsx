import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { RegisterDevicesPanel, type NetworkPrinterOption, type PrinterOption, type RegisterDeviceRow } from '@/components/settings/register-devices-panel';
import { ADMIN_ONLY_MESSAGE } from '@/lib/admin-only-settings';
import { deviceKind, deviceSettingsFrom, EMPTY_DEVICE_SETTING } from '@/lib/device-settings';
import { PRINTER_MAKER_LABEL } from '@/lib/printer-models';
import { isEpsonMaker, isLanRelayPrinter, isLocalPrinterHost } from '@/lib/direct-print';

export const metadata: Metadata = { title: 'レジ端末（iPad） | 設定' };

const CONNECTION_LABEL: Record<string, string> = { bluetooth: 'Bluetooth', usb: 'USB', lan: '有線LAN', wifi: 'Wi-Fi' };
const USAGE_LABEL: Record<string, string> = { receipt: 'レシート', kitchen: '厨房', drink: 'ドリンク', label: 'ラベル' };

/**
 * レジ端末（iPad）ごとの設定を管理画面から（2026-10-24 Ronnie「管理画面から全部の設定を。アプリのも、プリンターも」）。
 * 端末の一覧は register_devices（レジとして登録した iPad）、設定は store_settings.settings.devices（lib/device-settings.ts）。
 * レジ（iPad）のアカウントからは開けない（管理画面だけ）。
 */
export default async function RegisterDevicesSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (ctx.isRegisterDevice) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="レジ端末（iPad）" en="Register iPads" />
        <EmptyState title="管理画面で設定してください" description={ADMIN_ONLY_MESSAGE} />
      </div>
    );
  }
  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="レジ端末（iPad）" en="Register iPads" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: deviceRows }, { data: printerRows }, { data: settingsRow }, { data: netRows }] = await Promise.all([
    supabase
      .from('register_devices')
      .select('id, name, user_agent, created_at, last_seen_at, status')
      .eq('store_id', targetStore.id)
      .order('status')
      .order('created_at'),
    supabase
      .from('printer_configs')
      .select('id, name, maker, model, usage, bill_slips, connection_type, cloudprnt_enabled')
      .eq('store_id', targetStore.id)
      .eq('status', 'active')
      .or('usage.eq.receipt,bill_slips.eq.true')
      .order('name'),
    supabase.from('store_settings').select('settings').eq('store_id', targetStore.id).maybeSingle(),
    // LAN / Wi-Fi のプリンター（厨房も含む。2026-10-25 Ronnie「LAN / Wi-Fi は app からつながない、control centre から」）
    supabase
      .from('printer_configs')
      .select('id, name, maker, usage, connection_type, ip_address, cloudprnt_enabled')
      .eq('store_id', targetStore.id)
      .eq('status', 'active')
      .in('connection_type', ['lan', 'wifi'])
      .order('name'),
  ]);
  const settings = deviceSettingsFrom(settingsRow?.settings ?? null);
  const devices: RegisterDeviceRow[] = (deviceRows ?? []).map((d) => ({
    id: d.id as string,
    name: ((d.name as string | null) ?? '').trim() || 'レジ端末',
    kind: deviceKind(d.user_agent as string | null),
    createdAt: d.created_at as string,
    lastSeenAt: (d.last_seen_at as string | null) ?? null,
    status: d.status === 'revoked' ? 'revoked' : 'active',
    setting: settings[d.id as string] ?? EMPTY_DEVICE_SETTING,
  }));
  const printers: PrinterOption[] = (printerRows ?? []).map((p) => {
    const maker = (p.maker as string | null) ?? null;
    const conn = (p.connection_type as string | null) ?? null;
    const bits = [maker ? ((PRINTER_MAKER_LABEL as Record<string, string>)[maker] ?? maker) : null, (p.model as string | null) ?? null, conn ? (CONNECTION_LABEL[conn] ?? conn) : null, p.usage === 'receipt' ? 'レシート' : '会計伝票も出す'].filter(Boolean);
    return { id: p.id as string, name: p.name as string, detail: bits.join('・') };
  });
  // lib/native-settings-server.ts と同じ判定（iPad の設定画面に出していたものを、ここで決める）
  const lanPrinters: NetworkPrinterOption[] = [];
  const wifiPrinters: NetworkPrinterOption[] = [];
  for (const p of netRows ?? []) {
    if (p.cloudprnt_enabled !== true) continue;
    const maker = (p.maker as string | null) ?? null;
    const connection = (p.connection_type as string | null) ?? null;
    const ip = ((p.ip_address as string | null) ?? '').trim() || null;
    const usage = (p.usage as string | null) ?? 'receipt';
    const option: NetworkPrinterOption = {
      id: p.id as string,
      name: p.name as string,
      detail: [USAGE_LABEL[usage] ?? usage, connection ? (CONNECTION_LABEL[connection] ?? connection) : null, ip].filter(Boolean).join('・'),
    };
    if (isLanRelayPrinter({ maker, connection, ip })) lanPrinters.push(option);
    if (isEpsonMaker(maker) && isLocalPrinterHost(ip)) wifiPrinters.push(option);
  }

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="レジ端末（iPad）"
        en="Register iPads"
        description={`${targetStore.name}・レジとして登録した iPad ごとに、レシートの出し先・LAN / Wi-Fi のプリンター・アプリ画面の ON/OFF を管理画面から決めます（iPad では Bluetooth のプリンターだけつなぎます）`}
      />
      <RegisterDevicesPanel storeId={targetStore.id} devices={devices} printers={printers} lanPrinters={lanPrinters} wifiPrinters={wifiPrinters} />
      <p className="mt-4 text-xs text-ink-3">
        端末の登録・解除（台数）は運営（CYPRESS）の設定です。プリンター自体の追加・接続は「ハードウェア」から。
      </p>
    </div>
  );
}
