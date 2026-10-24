'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { nativePosToChoice, type DeviceSetting, type NativePosChoice } from '@/lib/device-settings';
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

/**
 * レジ端末（iPad）の一覧と、端末ごとの設定（表示名・レシートの出し先・アプリ画面の ON/OFF）。
 * 2026-10-24 Ronnie「管理画面から全部の設定を。アプリのも、プリンターも」
 */
export function RegisterDevicesPanel({ storeId, devices, printers }: { storeId: string; devices: RegisterDeviceRow[]; printers: PrinterOption[] }) {
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
        <DeviceCard key={d.id} storeId={storeId} device={d} printers={printers} />
      ))}
    </div>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })} ${d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}`;
}

function DeviceCard({ storeId, device, printers }: { storeId: string; device: RegisterDeviceRow; printers: PrinterOption[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState(device.setting.label ?? '');
  const [printerId, setPrinterId] = useState(device.setting.printerConfigId ?? '');
  const [native, setNative] = useState<NativePosChoice>(nativePosToChoice(device.setting.nativePos));
  const [saved, setSaved] = useState(device.setting);
  const dirty = (saved.label ?? '') !== label.trim() || (saved.printerConfigId ?? '') !== printerId || nativePosToChoice(saved.nativePos) !== native;
  const revoked = device.status === 'revoked';

  const save = () =>
    startTransition(async () => {
      const res = await saveRegisterDeviceSetting({ storeId, deviceId: device.id, label, printerConfigId: printerId, nativePos: native });
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
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-bold text-ink-2">アプリのオーダー・会計画面（ネイティブ）</span>
          <Select value={native} onChange={(e) => setNative(e.target.value as NativePosChoice)} disabled={revoked}>
            <option value="device">端末まかせ（iPad の設定）</option>
            <option value="on">ON（アプリの画面）</option>
            <option value="off">OFF（今までの画面）</option>
          </Select>
          <span className="text-xs text-ink-3">アプリが対応した版から効きます（Web のレジは対象外）</span>
        </label>
      </div>
    </section>
  );
}
