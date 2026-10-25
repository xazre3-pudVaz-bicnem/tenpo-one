'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Copy, Inbox, Loader2, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import {
  CONNECTION_PROTOCOL,
  drawerFieldOf,
  drawerPinValue,
  KITCHEN_STATION_OPTIONS,
  makerKind,
  polledAgo,
  printerConnectionKind,
  printerConnectionKindLabel,
  printerConnectionStatus,
  printerConnectionUrl,
  usesConnectionUrl,
  usesPollInterval,
  type PrinterConnectionRow,
  type PrinterConnectionStatus,
} from '@/lib/printer-connection';
import { usePrinterClock } from '@/components/settings/cloudprnt-panel';
import {
  enqueueAdminPrinterConnectionTest,
  regenerateAdminPrinterConnectionToken,
  saveAdminPrinterConnection,
} from '@/app/admin/organizations/printer-connection-actions';
import type { AdminStorePrinterConnections } from '@/lib/admin-printer-connections-server';

const USAGE_LABEL: Record<string, string> = { receipt: 'レシート', kitchen: '厨房' };

/** 状態のバッジ（接続中／未接続。お店の画面と同じ last_polled_at の判定） */
function statusBadge(status: PrinterConnectionStatus, viaIpad: boolean): { label: string; tone: BadgeTone; title?: string } {
  if (status === 'disabled') return { label: '使わない', tone: 'gray' };
  if (viaIpad) return { label: 'iPad', tone: 'gray', title: 'iPad の TENPO ONE レジ アプリとつなぐプリンター' };
  switch (status) {
    case 'online':
      return { label: '接続中', tone: 'success' };
    case 'offline':
      return { label: '未接続', tone: 'warning', title: '以前はつながっていました（今は通信がありません）' };
    case 'never':
      return { label: '未接続', tone: 'danger', title: '一度も通信がありません' };
    default:
      return { label: '確認中', tone: 'gray' };
  }
}

/**
 * 運営コンソール：店舗の「プリンター接続」（Star CloudPRNT・EPSON Server Direct Print・iPad の Bluetooth / USB / LAN）
 * （2026-10-25 Ronnie「yo data haru pani control centre mai rakhdeu — buti sano compact tarikale」）。
 * 1 台 1 行。行を開くと「このプリンタを使う」・接続用URL・問い合わせ間隔・ドロア・伝票・テスト印刷・URL再発行。
 * お店の管理画面（設定 › レジ・プリンター › プリンター接続）では見るだけ（テスト印刷・ドロアを開くはお店でも使える）。
 */
export function PrinterConnectionsAdmin({
  organizationId,
  siteUrl,
  stores,
}: {
  organizationId: string;
  siteUrl: string;
  stores: AdminStorePrinterConnections[];
}) {
  const router = useRouter();
  const now = usePrinterClock();
  const [refreshing, startRefresh] = useTransition();
  const withPrinters = stores.filter((s) => s.printers.length > 0);
  const withoutPrinters = stores.filter((s) => s.printers.length === 0);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-gray-500">
          レシート・厨房のプリンターの接続を運営が設定します（行を開くと設定）。お店の管理画面では見るだけです（テスト印刷・ドロアを開くはお店でも使えます）。
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          最新にする
        </Button>
      </div>
      {!siteUrl && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          公開URL（NEXT_PUBLIC_SITE_URL）が未設定のため、接続用URLを作れません
        </p>
      )}
      {withPrinters.length === 0 ? (
        <p className="text-xs text-gray-400">レシート・厨房のプリンターはまだありません</p>
      ) : (
        withPrinters.map((store) => (
          <StorePrinterConnections key={store.storeId} organizationId={organizationId} siteUrl={siteUrl} store={store} now={now} />
        ))
      )}
      {withPrinters.length > 0 && withoutPrinters.length > 0 && (
        <p className="text-[11px] text-gray-400">プリンターなし：{withoutPrinters.map((s) => s.storeName).join('、')}</p>
      )}
    </div>
  );
}

/** 列の並び（一覧の見出しと各行で同じ） */
const GRID = 'sm:grid sm:grid-cols-[1rem_minmax(0,1.3fr)_minmax(0,1.1fr)_3rem_6.5rem_4.5rem_7.5rem_4.5rem] sm:items-center sm:gap-2';

function StorePrinterConnections({
  organizationId,
  siteUrl,
  store,
  now,
}: {
  organizationId: string;
  siteUrl: string;
  store: AdminStorePrinterConnections;
  now: number;
}) {
  const notConnected = store.printers.filter((p) => {
    const s = printerConnectionStatus(p, now);
    return printerConnectionKind(p) !== 'ipad' && (s === 'offline' || s === 'never');
  }).length;
  return (
    <section aria-label={`${store.storeName} のプリンター接続`}>
      <p className="mb-1 flex items-baseline gap-2 text-xs font-semibold text-navy">
        {store.storeName}
        <span className="font-normal text-gray-400">
          {store.printers.length}台{notConnected > 0 && `・未接続 ${notConnected}`}
        </span>
      </p>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-xs">
        <div className={cn('hidden px-2 py-1 text-[10px] text-gray-400', GRID)} aria-hidden>
          <span />
          <span>名前</span>
          <span>メーカー / 型番</span>
          <span>用途</span>
          <span>接続</span>
          <span>状態</span>
          <span>MAC</span>
          <span>最終通信</span>
        </div>
        {store.printers.map((p) => (
          <ConnectionRow key={p.id} organizationId={organizationId} storeId={store.storeId} siteUrl={siteUrl} printer={p} now={now} />
        ))}
      </div>
    </section>
  );
}

function ConnectionRow({
  organizationId,
  storeId,
  siteUrl,
  printer,
  now,
}: {
  organizationId: string;
  storeId: string;
  siteUrl: string;
  printer: PrinterConnectionRow;
  now: number;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(printer.cloudprntEnabled);
  const [poll, setPoll] = useState(String(printer.pollIntervalSeconds));
  const [drawerCommand, setDrawerCommand] = useState(printer.drawerCommand);
  const [stations, setStations] = useState<string[]>(printer.kitchenStations);
  const [copied, setCopied] = useState(false);
  const [reissuing, setReissuing] = useState(false);

  const kind = printerConnectionKind(printer);
  const viaIpad = kind === 'ipad';
  const isKitchen = printer.usage === 'kitchen';
  const drawerField = drawerFieldOf(printer);
  const status = printerConnectionStatus({ ...printer, cloudprntEnabled: enabled }, now);
  const badge = statusBadge(status, viaIpad);
  const url = printerConnectionUrl(siteUrl, printer.maker, printer.cloudprntToken);
  const protocol = CONNECTION_PROTOCOL[makerKind(printer.maker)];
  const ref = { organizationId, storeId, printerId: printer.id };

  const run = (fn: () => Promise<{ error?: string }>, okMsg: string, onError?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast(res.error, 'error');
        onError?.();
        return;
      }
      toast(okMsg);
      router.refresh();
    });

  const toggleEnabled = (v: boolean) => {
    setEnabled(v);
    run(() => saveAdminPrinterConnection({ ...ref, enabled: v }), v ? '使うにしました' : '使わないにしました', () => setEnabled(!v));
  };

  const save = () =>
    run(
      () =>
        saveAdminPrinterConnection({
          ...ref,
          enabled,
          ...(usesPollInterval(kind) ? { pollIntervalSeconds: Number(poll) } : {}),
          ...(drawerField !== 'none' ? { drawerCommand } : {}),
          ...(isKitchen ? { kitchenStations: stations } : {}),
        }),
      '保存しました'
    );

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  const toggleStation = (key: string) => setStations((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));

  return (
    <details className="group">
      <summary
        className={cn(
          'flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1.5 hover:bg-gray-50 [&::-webkit-details-marker]:hidden',
          GRID
        )}
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-open:rotate-90" aria-hidden />
        <span className="min-w-0 truncate font-medium text-navy">{printer.name}</span>
        <span className="min-w-0 truncate text-gray-500">
          {printer.maker || '—'}
          {printer.model && ` / ${printer.model}`}
        </span>
        <span className="text-gray-600">{USAGE_LABEL[printer.usage] ?? printer.usage}</span>
        <span className="text-gray-600">{printerConnectionKindLabel(printer)}</span>
        <span>
          <Badge tone={badge.tone} className="px-1.5 py-0 text-[10px]" title={badge.title}>
            {badge.label}
          </Badge>
        </span>
        <span className="truncate font-mono text-[10px] text-gray-500">{printer.macAddress ?? '—'}</span>
        <span className="text-[10px] text-gray-500" title={printer.lastPolledAt ? formatDateTime(printer.lastPolledAt) : undefined}>
          {printer.lastPolledAt ? (now > 0 ? polledAgo(printer.lastPolledAt, now) : formatDateTime(printer.lastPolledAt)) : '—'}
          {printer.pendingJobs > 0 && <span className="ml-1 text-warning">待ち{printer.pendingJobs}</span>}
        </span>
      </summary>

      <div className="space-y-2 border-t border-gray-100 bg-surface/60 px-3 py-2 sm:pl-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 font-medium text-navy">
            <input
              type="checkbox"
              checked={enabled}
              disabled={pending}
              onChange={(e) => toggleEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
            />
            このプリンタを使う
          </label>
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={pending || !enabled}
              title={status === 'online' || viaIpad ? undefined : 'プリンタが接続されると印刷されます（10分以内）'}
              onClick={() => run(() => enqueueAdminPrinterConnectionTest({ ...ref, kind: 'receipt' }), 'テスト印刷を送りました')}
            >
              <Printer className="h-3.5 w-3.5" />
              テスト印刷
            </Button>
            {!isKitchen && printer.drawerKick && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={pending || !enabled}
                onClick={() => run(() => enqueueAdminPrinterConnectionTest({ ...ref, kind: 'drawer' }), 'ドロア開放を送りました')}
              >
                <Inbox className="h-3.5 w-3.5" />
                ドロアを開く
              </Button>
            )}
            {usesConnectionUrl(kind) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={pending}
                onClick={() => setReissuing(true)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                URLを再発行
              </Button>
            )}
          </div>
        </div>

        {usesConnectionUrl(kind) ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-gray-500">接続用URL</span>
            <Input
              readOnly
              value={url}
              placeholder="（まだありません）"
              aria-label={`接続用URL（プリンタの ${protocol.urlField} に設定）`}
              title={`プリンタの ${protocol.urlField} に設定`}
              className="h-7 min-w-0 flex-1 px-2 font-mono text-[11px]"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="secondary" size="sm" className="h-7 px-2" onClick={copyUrl} disabled={!url} aria-label="接続用URLをコピー">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        ) : (
          <p className="text-gray-500">
            {viaIpad
              ? `iPad で接続（${printer.connectionType === 'usb' ? 'USB' : 'Bluetooth'}。接続用URLは使いません）`
              : 'レジの iPad から お店の LAN で送ります（接続用URLは使いません）'}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          {usesPollInterval(kind) && (
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">問い合わせ間隔（秒）</span>
              <Input
                type="number"
                min={1}
                max={60}
                value={poll}
                onChange={(e) => setPoll(e.target.value)}
                className="h-7 w-16 px-2 text-xs"
              />
            </label>
          )}
          {drawerField === 'pin' && (
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">ドロアの接続ピン</span>
              <Select value={drawerPinValue(drawerCommand)} onChange={(e) => setDrawerCommand(e.target.value)} className="h-7 w-auto px-2 text-xs">
                <option value="[drawer: 1]">2番ピン（通常）</option>
                <option value="[drawer: 2]">5番ピン</option>
              </Select>
            </label>
          )}
          {drawerField === 'command' && (
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">ドロア開放コマンド</span>
              <Input
                value={drawerCommand}
                onChange={(e) => setDrawerCommand(e.target.value)}
                placeholder="[drawer: 1]"
                className="h-7 w-32 px-2 font-mono text-[11px]"
              />
            </label>
          )}
        </div>

        {isKitchen && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-gray-500">このプリンタで印刷する伝票</span>
            {KITCHEN_STATION_OPTIONS.map((s) => (
              <label key={s.key} className="flex items-center gap-1 text-gray-700">
                <input
                  type="checkbox"
                  checked={stations.includes(s.key)}
                  onChange={() => toggleStation(s.key)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                {s.label}
              </label>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" className="h-7 px-3 text-xs" onClick={save} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </Button>
          {printer.pendingJobs > 0 && <span className="text-[11px] text-gray-400">印刷待ち {printer.pendingJobs}件</span>}
        </div>
      </div>

      {reissuing && (
        <ConfirmDialog
          open
          onClose={() => setReissuing(false)}
          title="接続用URLを再発行"
          message={`「${printer.name}」の接続用URLを作り直します。今のURLは使えなくなるので、プリンタ側（${protocol.urlField}）に新しいURLを入れ直すまで印刷されません。`}
          confirmLabel="再発行する"
          onConfirm={async () => {
            const res = await regenerateAdminPrinterConnectionToken(ref);
            if (res.error) {
              toast(res.error, 'error');
              return;
            }
            toast('URLを再発行しました。プリンタ側の設定を新しいURLにしてください');
            router.refresh();
          }}
        />
      )}
    </details>
  );
}
