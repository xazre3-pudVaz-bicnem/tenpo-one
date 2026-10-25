'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { type DeviceSetting } from '@/lib/device-settings';
import { saveRegisterDeviceSetting } from '@/app/app/settings/devices/actions';

export interface RegisterDeviceRow {
  id: string;
  name: string;
  kind: string;
  createdAt: string;
  lastSeenAt: string | null;
  status: 'active' | 'revoked';
  setting: DeviceSetting;
}

export interface PrinterOption {
  id: string;
  name: string;
  detail: string;
}

/** LAN / Wi-Fi のプリンター（この iPad から送る・Wi-Fi で直接印刷の候補） */
export type NetworkPrinterOption = PrinterOption;

interface PanelProps {
  storeId: string;
  devices: RegisterDeviceRow[];
  printers: PrinterOption[];
  lanPrinters?: NetworkPrinterOption[];
  wifiPrinters?: NetworkPrinterOption[];
}

/**
 * レジ端末（iPad）の一覧と、端末ごとの設定（表示名・レシートの出し先・LAN / Wi-Fi のプリンター・アプリ画面の ON/OFF）。
 * 2026-10-24 Ronnie「管理画面から全部の設定を。アプリのも、プリンターも」
 * 2026-10-25 Ronnie「LAN / Wi-Fi のプリンターは app からつながない、control centre から。iPad は Bluetooth だけ」
 */
export function RegisterDevicesPanel({ storeId, devices, printers, lanPrinters = [], wifiPrinters = [] }: PanelProps) {
  if (devices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-white px-5 py-8 text-center text-sm text-ink-3">
        この店舗で登録されたレジ端末（iPad）はまだありません。iPad の TENPO ONE でこの店舗にログインすると、ここに出ます
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

function sameIds(a: string[] | null, b: string[] | null): boolean {
  if (a == null || b == null) return a === b;
  return a.length === b.length && a.every((id) => b.includes(id));
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
  const [lanIds, setLanIds] = useState<string[] | null>(device.setting.lanPrinterIds);
  const [wifiIds, setWifiIds] = useState<string[] | null>(device.setting.wifiPrinterIds);
  const [saved, setSaved] = useState(device.setting);
  const dirty =
    (saved.label ?? '') !== label.trim() ||
    (saved.printerConfigId ?? '') !== printerId ||
    !sameIds(saved.lanPrinterIds, lanIds) ||
    !sameIds(saved.wifiPrinterIds, wifiIds);
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
        lanPrinterIds: lanIds,
        wifiPrinterIds: wifiIds,
      });
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      setSaved(res.setting);
      setLabel(res.setting.label ?? '');
      setLanIds(res.setting.lanPrinterIds);
      setWifiIds(res.setting.wifiPrinterIds);
      toast('保存しました。iPad は次に画面を開いたときから反映されます');
    });

  return (
    <section className={cn('rounded-xl border border-line bg-white', revoked && 'opacity-60')} aria-label={label || device.name}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-extrabold text-ink">{label.trim() || device.name}</span>
          <span className="text-xs text-ink-3">
            {device.kind}・登録 {fmt(device.createdAt)}・最後に使った {fmt(device.lastSeenAt)}
            {revoked && '・解除済み'}
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
      <div className="grid grid-cols-1 gap-4 border-t border-line px-5 py-4 md:grid-cols-2">
        <NetworkPrinterPick
          title="LAN のプリンターへ、この iPad から送る"
          help="厨房・レシートの LAN プリンターへ、この iPad が中継して送ります（パソコン・ブリッジなしで印刷）"
          options={lanPrinters}
          value={lanIds}
          onChange={setLanIds}
          disabled={revoked}
          emptyText="中継できる LAN のプリンターがありません（ハードウェアで IP を入れて「使う」にすると出ます）"
        />
        <NetworkPrinterPick
          title="Wi-Fi で直接印刷（EPSON）"
          help="同じ Wi-Fi の EPSON プリンターへ、この iPad から直接送ります"
          options={wifiPrinters}
          value={wifiIds}
          onChange={setWifiIds}
          disabled={revoked}
          emptyText="直接印刷できる EPSON のプリンターがありません"
        />
      </div>
    </section>
  );
}

/** 「端末まかせ（今までどおり）」か「ここで決める（チェックしたプリンターだけ）」 */
function NetworkPrinterPick({
  title,
  help,
  options,
  value,
  onChange,
  disabled,
  emptyText,
}: {
  title: string;
  help: string;
  options: NetworkPrinterOption[];
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  disabled: boolean;
  emptyText: string;
}) {
  const managed = value != null;
  const toggle = (id: string) => {
    const cur = value ?? [];
    onChange(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <span className="font-bold text-ink-2">{title}</span>
      <Select value={managed ? 'set' : 'device'} onChange={(e) => onChange(e.target.value === 'set' ? (value ?? []) : null)} disabled={disabled}>
        <option value="device">端末まかせ（今までどおり）</option>
        <option value="set">ここで決める</option>
      </Select>
      {managed &&
        (options.length === 0 ? (
          <span className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-3">{emptyText}</span>
        ) : (
          <div className="flex flex-col gap-1 rounded-lg border border-line px-3 py-2">
            {options.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 py-1">
                <input type="checkbox" checked={(value ?? []).includes(p.id)} onChange={() => toggle(p.id)} disabled={disabled} className="h-4 w-4 accent-[#2A6FE6]" />
                <span className="font-semibold text-ink">{p.name}</span>
                <span className="truncate text-xs text-ink-3">{p.detail}</span>
              </label>
            ))}
          </div>
        ))}
      <span className="text-xs text-ink-3">{help}</span>
    </div>
  );
}
