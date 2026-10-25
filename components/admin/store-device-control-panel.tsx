'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, MonitorSmartphone, QrCode, Smartphone, Tv } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';
import { APPROVAL_LABELS, DEVICE_TYPE_LABELS, DEVICE_TYPES, type ApprovalStatus, type DeviceType } from '@/lib/device-control';
import { DISPLAY_FLAG_ADMIN_NOTE } from '@/lib/display-monitor';
import { QR_ORDER_ADMIN_NOTE } from '@/lib/qr-order-flag';
import type { AdminDeviceRow, StoreDeviceControlData } from '@/lib/device-control-admin-server';
import { saveStoreDeviceContract, setStoreQrOrder } from '@/app/admin/tenants/device-actions';
import { DeviceApprovalActions } from '@/components/admin/device-approval-actions';

const APPROVAL_TONE: Record<ApprovalStatus, BadgeTone> = { pending: 'warning', approved: 'success', rejected: 'danger', revoked: 'gray' };
const TYPE_ICON: Record<DeviceType, typeof Smartphone> = { register: MonitorSmartphone, handy: Smartphone, display: Tv };

/**
 * コントロールセンター（運営コンソール）：店舗の端末の契約（ON/OFF・台数）・テーブルQR・端末の承認（2026-10-25 Ronnie）。
 * 新しい端末（iPad のレジのログイン・ハンディの QR・ディスプレイの QR）は承認待ちで登録され、ここで承認するまで使えない。
 * 店舗の管理画面は一覧を見るだけ（承認・解除・台数はここだけ）。
 */
export function StoreDeviceControlPanel({ data }: { data: StoreDeviceControlData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    registerEnabled: data.register.enabled,
    registerLimit: String(data.register.limit),
    handyEnabled: data.handy.enabled,
    handyLimit: String(data.handy.limit),
    displayEnabled: data.display.enabled,
    displayLimit: String(data.display.limit),
  });

  const save = () =>
    startTransition(async () => {
      const r = await saveStoreDeviceContract({
        storeId: data.storeId,
        registerEnabled: form.registerEnabled,
        registerLimit: Number(form.registerLimit) || 0,
        handyEnabled: form.handyEnabled,
        handyLimit: Number(form.handyLimit) || 0,
        displayEnabled: form.displayEnabled,
        displayLimit: Number(form.displayLimit) || 0,
      });
      if (r.error) toast(r.error, 'error');
      else {
        toast(r.warning ?? '端末の契約を保存しました', r.warning ? 'warning' : 'success');
        router.refresh();
      }
    });

  const toggleQr = () =>
    startTransition(async () => {
      const next = !(data.qr.storeEnabled ?? true);
      const r = await setStoreQrOrder({ storeId: data.storeId, enabled: next });
      if (r.error) toast(r.error, 'error');
      else {
        toast(r.warning ?? (next ? 'テーブルQR を ON にしました' : 'テーブルQR を OFF にしました'), r.warning ? 'warning' : 'success');
        router.refresh();
      }
    });

  const byType = (t: DeviceType) => data.devices.filter((d) => d.type === t);
  const approvedActive = (t: DeviceType) => byType(t).filter((d) => d.approval === 'approved' && d.status === 'active').length;
  const pendingOf = (t: DeviceType) => byType(t).filter((d) => d.approval === 'pending' && d.status === 'active').length;
  const pendingRows = data.devices.filter((d) => d.approval === 'pending' && d.status === 'active');
  const activeRows = data.devices.filter((d) => d.approval === 'approved' && d.status === 'active');
  const otherRows = data.devices.filter((d) => d.status !== 'active');

  const rows: { type: DeviceType; enabledKey: 'registerEnabled' | 'handyEnabled' | 'displayEnabled'; limitKey: 'registerLimit' | 'handyLimit' | 'displayLimit'; note: string }[] = [
    {
      type: 'register',
      enabledKey: 'registerEnabled',
      limitKey: 'registerLimit',
      note: data.register.counted ? '' : '台数・承認を数えていません（契約を保存すると数えます）',
    },
    { type: 'handy', enabledKey: 'handyEnabled', limitKey: 'handyLimit', note: data.handy.counted ? '' : '台数は数えていません（承認は必要）' },
    {
      type: 'display',
      enabledKey: 'displayEnabled',
      limitKey: 'displayLimit',
      note: data.display.enabled ? '' : DISPLAY_FLAG_ADMIN_NOTE[data.display.reason],
    },
  ];

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-gray-500">
        レジ（iPad）・ハンディ・ディスプレイ端末の契約（ON/OFF・台数）と、新しい端末の承認はここで行います。新しい端末は
        <strong>承認待ち</strong>で登録され、承認するまで使えません。今使っている端末は承認済みのまま使えます。店舗の管理画面では一覧を見るだけです。
      </p>

      {!data.ready && (
        <div className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            migration 00104（端末の承認）が未適用です。適用するまでは今まで通り（新しい端末も承認なしで使える・レジ／ハンディの契約 OFF とディスプレイの台数は効かない）。
            台数・ディスプレイの ON/OFF・テーブルQR は今でも保存できます。
          </span>
        </div>
      )}
      {!data.contractExists && (
        <div className="flex items-start gap-2 rounded-lg bg-primary-soft px-3 py-2.5 text-xs text-primary-deep">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            この店舗はまだ契約（台数）を保存していません。いまはレジ（iPad）の台数・承認を数えていません（今まで通り）。保存すると、この店舗の iPad は
            次にレジを開いたとき「登録 → 承認待ち」になります。営業時間外に保存し、下の「承認待ち」から承認してください。
          </span>
        </div>
      )}

      {/* 契約 */}
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {rows.map((r) => {
          const Icon = TYPE_ICON[r.type];
          const on = form[r.enabledKey];
          return (
            <div key={r.type} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="flex min-w-[11rem] flex-1 items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-navy">{DEVICE_TYPE_LABELS[r.type]}</p>
                  <p className="text-[11px] text-gray-500">
                    承認済み <span className="tabular-nums">{approvedActive(r.type)}</span>台
                    {pendingOf(r.type) > 0 && (
                      <span className="ml-1.5 font-semibold text-warning">承認待ち {pendingOf(r.type)}台</span>
                    )}
                    {r.note && <span className="ml-1.5 text-gray-400">{r.note}</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                契約
                <Switch
                  on={on}
                  label={`${DEVICE_TYPE_LABELS[r.type]}の契約`}
                  disabled={pending}
                  onClick={() => setForm((f) => ({ ...f, [r.enabledKey]: !on }))}
                />
                <span className={cn('w-7 font-semibold', on ? 'text-primary' : 'text-gray-400')}>{on ? 'ON' : 'OFF'}</span>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                台数
                <Input
                  value={form[r.limitKey]}
                  onChange={(e) => setForm((f) => ({ ...f, [r.limitKey]: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))}
                  className="h-8 w-16 text-right"
                  inputMode="numeric"
                  aria-label={`${DEVICE_TYPE_LABELS[r.type]}の台数`}
                />
                台
              </label>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500">台数を 0 にすると数えません（レジは台数・承認とも数えない＝今まで通り）。OFF にした種類の端末はログイン・接続・操作ができなくなります。</p>
        <Button onClick={save} disabled={pending}>
          {pending ? '保存中…' : '契約を保存する'}
        </Button>
      </div>

      {/* テーブルQR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <QrCode className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-navy">テーブルQR（お客様の QR 注文）</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={data.qr.on ? 'success' : 'gray'}>{data.qr.on ? '受け付け中' : '停止中'}</Badge>
              {!data.qr.on && <span className="text-[11px] text-gray-400">{QR_ORDER_ADMIN_NOTE[data.qr.reason]}</span>}
              {!data.qr.tableReady && <span className="text-[11px] text-warning">migration 00103 未適用のため店舗ごとの ON/OFF はまだ使えません</span>}
            </div>
          </div>
        </div>
        <Switch on={data.qr.storeEnabled ?? true} label="テーブルQR（この店舗）" disabled={pending || !data.qr.tableReady} onClick={toggleQr} />
      </div>

      {/* 承認待ち */}
      <DeviceList
        title={`承認待ち（${pendingRows.length}）`}
        empty="承認待ちの端末はありません"
        rows={pendingRows}
        storeId={data.storeId}
        ready={data.ready}
        highlight
      />
      <DeviceList title={`使用中の端末（${activeRows.length}）`} empty="使用中の端末はありません" rows={activeRows} storeId={data.storeId} ready={data.ready} />
      {otherRows.length > 0 && (
        <details className="rounded-xl border border-gray-100 bg-surface px-4 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-navy">解除・却下した端末（{otherRows.length}）</summary>
          <div className="mt-2">
            <DeviceList title="" empty="" rows={otherRows} storeId={data.storeId} ready={data.ready} />
          </div>
        </details>
      )}
    </div>
  );
}

function DeviceList({
  title,
  empty,
  rows,
  storeId,
  ready,
  highlight,
}: {
  title: string;
  empty: string;
  rows: AdminDeviceRow[];
  storeId: string;
  ready: boolean;
  highlight?: boolean;
}) {
  const sorted = [...rows].sort((a, b) => DEVICE_TYPES.indexOf(a.type) - DEVICE_TYPES.indexOf(b.type) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return (
    <div>
      {title && <p className="mb-2 text-sm font-semibold text-navy">{title}</p>}
      {sorted.length === 0 ? (
        empty && <p className="text-xs text-gray-400">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((d) => (
            <DeviceItem key={`${d.type}:${d.id}`} device={d} storeId={storeId} ready={ready} highlight={highlight} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function DeviceItem({
  device: d,
  storeId,
  ready,
  highlight,
  extra,
}: {
  device: AdminDeviceRow;
  storeId: string;
  ready: boolean;
  highlight?: boolean;
  extra?: React.ReactNode;
}) {
  const Icon = TYPE_ICON[d.type];
  const stateLabel = d.approval !== 'approved' ? APPROVAL_LABELS[d.approval] : d.status === 'active' ? '使用中' : '解除済み';
  const tone: BadgeTone = d.approval !== 'approved' ? APPROVAL_TONE[d.approval] : d.status === 'active' ? 'success' : 'gray';
  return (
    <li
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm',
        highlight ? 'border-amber-200 bg-amber-50/60' : 'border-gray-100 bg-white'
      )}
    >
      <span className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-500">{DEVICE_TYPE_LABELS[d.type]}</span>
            <span className="font-medium text-navy">{d.name}</span>
            <Badge tone={tone}>{stateLabel}</Badge>
          </span>
          <span className="block text-[11px] text-gray-500">
            {extra}
            {d.detail || '—'}
            <span className="ml-2">登録 {formatDateTime(d.createdAt)}</span>
            <span className="ml-2">{d.lastSeenAt ? `最終 ${formatDateTime(d.lastSeenAt)}` : '未使用'}</span>
          </span>
        </span>
      </span>
      <DeviceApprovalActions
        storeId={storeId}
        type={d.type}
        deviceId={d.id}
        deviceName={d.name}
        approval={d.approval}
        active={d.status === 'active'}
        ready={ready}
      />
    </li>
  );
}

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', on ? 'bg-primary' : 'bg-gray-300')}
    >
      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}
