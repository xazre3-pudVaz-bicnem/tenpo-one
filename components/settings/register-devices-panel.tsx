'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { type DeviceSetting } from '@/lib/device-settings';
import { describeNetworkPrinterIds, NETWORK_PRINTER_ADMIN_NOTE } from '@/lib/network-printers';
import { saveRegisterDeviceSetting } from '@/app/app/settings/devices/actions';
import { APPROVAL_LABELS } from '@/lib/device-control';

export interface RegisterDeviceRow {
  id: string;
  name: string;
  kind: string;
  createdAt: string;
  lastSeenAt: string | null;
  status: 'active' | 'revoked';
  /** TENPO ONE 運営の承認（コントロールセンター。migration 00104 の前は approved） */
  approval?: 'pending' | 'approved' | 'rejected' | 'revoked';
  setting: DeviceSetting;
}

export interface PrinterOption {
  id: string;
  name: string;
  detail: string;
}

/** LAN / Wi-Fi のプリンター（この iPad から送る・Wi-Fi で直接印刷。運営が決めたものを見せるだけ） */
export type NetworkPrinterOption = PrinterOption;

interface PanelProps {
  storeId: string;
  devices: RegisterDeviceRow[];
  printers: PrinterOption[];
  lanPrinters?: NetworkPrinterOption[];
  wifiPrinters?: NetworkPrinterOption[];
}

/**
 * レジ端末（iPad）の一覧と、端末ごとの設定（表示名・レシートの出し先）。
 * 2026-10-24 Ronnie「管理画面から全部の設定を。アプリのも、プリンターも」
 * 2026-10-25 Ronnie「LAN / Wi-Fi のプリンターは app からつながない、control centre から。iPad は Bluetooth だけ」
 *   → LAN / Wi-Fi は運営（コントロールセンター /admin）で決める。ここでは見るだけ
 */
export function RegisterDevicesPanel({ storeId, devices, printers, lanPrinters = [], wifiPrinters = [] }: PanelProps) {
  if (devices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-white px-5 py-8 text-center text-sm text-ink-3">
        この店舗で登録されたレジ端末（iPad）はまだありません。iPad の TENPO ONE でこの店舗にログインすると、ここに出ます（台数を決めている店舗では、TENPO ONE 運営の承認のあとで使えます）
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {devices.map((d) => (
        <DeviceCard key={d.id} storeId={storeId} device={d} printers={printers} lanPrinters={lanPrinters} wifiPrinters={wifiPrinters} />
      ))}
    </div>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })} ${d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}`;
}

function DeviceCard({
  storeId,
  device,
  printers,
  lanPrinters,
  wifiPrinters,
}: {
  storeId: string;
  device: RegisterDeviceRow;
  printers: PrinterOption[];
  lanPrinters: NetworkPrinterOption[];
  wifiPrinters: NetworkPrinterOption[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState(device.setting.label ?? '');
  const [printerId, setPrinterId] = useState(device.setting.printerConfigId ?? '');
  const [saved, setSaved] = useState(device.setting);
  const dirty = (saved.label ?? '') !== label.trim() || (saved.printerConfigId ?? '') !== printerId;
  const revoked = device.status === 'revoked';

  const save = () =>
    startTransition(async () => {
      const res = await saveRegisterDeviceSetting({
        storeId,
        deviceId: device.id,
        label,
        printerConfigId: printerId,
        // ネイティブの ON/OFF は無くなった（iPad は常にアプリの画面。2026-10-25 Ronnie「Web の iPad 版はもう要らない」）
        nativePos: 'device',
      });
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      setSaved(res.setting);
      setLabel(res.setting.label ?? '');
      toast('保存しました。iPad は次に画面を開いたときから反映されます');
    });

  return (
    <section className={cn('rounded-xl border border-line bg-white', revoked && 'opacity-60')} aria-label={label || device.name}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-extrabold text-ink">{label.trim() || device.name}</span>
          <span className="text-xs text-ink-3">
            {device.kind}・登録 {fmt(device.createdAt)}・最後に使った {fmt(device.lastSeenAt)}
            {revoked && device.approval !== 'rejected' && '・解除済み'}
            {device.approval && device.approval !== 'approved' && (
              <span className={cn('ml-1 font-bold', device.approval === 'pending' ? 'text-warning' : 'text-ink-3')}>
                ・{APPROVAL_LABELS[device.approval]}
                {device.approval === 'pending' && '（TENPO ONE 運営が承認すると使えます）'}
              </span>
            )}
          </span>
        </div>
        <Button type="button" size="sm" onClick={save} disabled={pending || !dirty || revoked}>
          {pending ? '保存中…' : '保存'}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-bold text-ink-2">表示名</span>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder={device.name} disabled={revoked} />
          <span className="text-xs text-ink-3">「入口レジ」「2階」など。空なら登録時の名前</span>
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-bold text-ink-2">このiPadのレシートプリンター</span>
          <Select value={printerId} onChange={(e) => setPrinterId(e.target.value)} disabled={revoked}>
            <option value="">端末で選んだもの／店の既定</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.detail}）
              </option>
            ))}
          </Select>
          <span className="text-xs text-ink-3">ここで選ぶと、iPad 側の「このiPadのプリンター」より優先</span>
        </label>
      </div>
      {/* LAN / Wi-Fi は運営（コントロールセンター）が決める。ここでは見るだけ（2026-10-25 Ronnie） */}
      <div className="border-t border-line px-5 py-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <NetworkPrinterView title="LAN のプリンターへ、この iPad から送る" value={device.setting.lanPrinterIds} options={lanPrinters} />
          <NetworkPrinterView title="Wi-Fi で直接印刷（EPSON）" value={device.setting.wifiPrinterIds} options={wifiPrinters} />
        </div>
        <p className="mt-3 text-xs text-ink-3">{NETWORK_PRINTER_ADMIN_NOTE}</p>
      </div>
    </section>
  );
}

/** 運営が決めた LAN / Wi-Fi のプリンター（読み取りだけ） */
function NetworkPrinterView({ title, value, options }: { title: string; value: string[] | null; options: NetworkPrinterOption[] }) {
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <span className="font-bold text-ink-2">{title}</span>
      <span className="rounded-lg bg-surface px-3 py-2 text-ink">{describeNetworkPrinterIds(value, options)}</span>
    </div>
  );
}
