'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Monitor, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { DISPLAY_FLAG_ADMIN_NOTE, resolveDisplayMonitorFlag } from '@/lib/display-monitor';
import { setOrgDisplayMonitor, setStoreDisplayMonitor } from '@/app/admin/organizations/display-actions';

/**
 * 運営コンソール：ディスプレイ端末（キッチンディスプレイ・呼び出しモニター）の ON/OFF（2026-10-24 Ronnie）。
 * 企業の ON と店舗の ON の両方がそろったときだけ、その店で使える（既定は OFF）。
 * OFF にしても、つないである端末は解除しない（端末の画面に「この機能は使えません」と出る）。
 */
export function DisplayMonitorFlags({
  organizationId,
  orgEnabled,
  storeTableMissing,
  stores,
}: {
  organizationId: string;
  orgEnabled: boolean;
  storeTableMissing: boolean;
  stores: { id: string; name: string; enabled: boolean; activeDevices: number }[];
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const run = (fn: () => Promise<void>) => {
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '更新に失敗しました', 'error');
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        店のモニター・タブレットをQRでつないで、キッチンディスプレイ・呼び出しモニターにする機能です。<strong>企業と店舗の両方を ON</strong> にした店だけで使えます（既定は OFF）。
      </p>
      {storeTableMissing && (
        <div className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          migration 00103（ディスプレイ端末）が未適用です。適用するまで店舗ごとの ON/OFF はできず、どの店でも使えません。
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Monitor className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-navy">企業として使う</p>
            <p className="font-mono text-[11px] text-gray-400">display_monitor</p>
          </div>
        </div>
        <Switch
          on={orgEnabled}
          label="ディスプレイ端末（企業）"
          disabled={pending}
          onClick={() => run(() => setOrgDisplayMonitor(organizationId, !orgEnabled))}
        />
      </div>

      {stores.length === 0 ? (
        <p className="text-xs text-gray-400">店舗がありません</p>
      ) : (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {stores.map((s) => {
            const state = resolveDisplayMonitorFlag({ orgEnabled, storeEnabled: s.enabled, storeTableMissing });
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy">{s.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={state.on ? 'success' : 'gray'}>{state.on ? '使える' : '使えない'}</Badge>
                    {!state.on && <span className="text-[11px] text-gray-400">{DISPLAY_FLAG_ADMIN_NOTE[state.reason]}</span>}
                    {s.activeDevices > 0 && <span className="text-[11px] text-gray-500">つないでいる端末 {s.activeDevices}台</span>}
                  </div>
                </div>
                <Switch
                  on={s.enabled}
                  label={`ディスプレイ端末（${s.name}）`}
                  disabled={pending || storeTableMissing}
                  onClick={() => run(() => setStoreDisplayMonitor(organizationId, s.id, !s.enabled))}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
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
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}
