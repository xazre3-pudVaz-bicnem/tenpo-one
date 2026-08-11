'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { yen } from '@/lib/format';
import { useQrStrings } from './strings-context';
import { KITCHEN_STATUS_LABELS, qrOrderErrorMessage, type KitchenStatus, type QrOrderStatus } from './types';

/**
 * 注文状況の自動更新間隔（ミリ秒）。
 * この画面はQRから匿名アクセスするお客様向けで、Supabaseの認証セッションを持たない
 * （テーブルトークンで get_qr_order_status RPCを都度呼び出す方式）。Supabase Realtimeの
 * postgres_changes購読はRLS評価にauth.uid()等のセッションを要するため匿名では利用できず、
 * 本画面はKDS/フロア/POS/予約台帳と異なりRealtime化の対象外。現状の10秒ポーリングを維持する。
 */
const REFRESH_INTERVAL_MS = 10000;

// 注: get_qr_order_status（RPC）は品目ごとの選択オプション(modifiers)を返さないため、
// この画面ではオプション名までは表示できない。合計金額(status.total)はサーバー側の
// line_total（オプション加算後）を積算したものなので、金額自体はオプションを反映済み。

const STATUS_TONES: Record<KitchenStatus, BadgeTone> = {
  pending: 'gray',
  preparing: 'warning',
  ready: 'success',
  served: 'navy',
};

export function OrderStatusView({ storeSlug, tableToken }: { storeSlug: string; tableToken: string }) {
  const qrStrings = useQrStrings();
  const [status, setStatus] = useState<QrOrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [callNoticeVisible, setCallNoticeVisible] = useState(false);

  const fetchStatus = useCallback(async () => {
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc('get_qr_order_status', {
      p_slug: storeSlug,
      p_token: tableToken,
    });
    if (rpcError || !data) {
      setError(qrOrderErrorMessage(rpcError?.message));
    } else {
      setStatus(data as QrOrderStatus);
      setError(null);
    }
    setLoading(false);
  }, [storeSlug, tableToken]);

  useEffect(() => {
    (async () => {
      await fetchStatus();
    })();
    const id = setInterval(fetchStatus, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !status) {
    return <p className="px-4 py-16 text-center text-sm text-danger">{error ?? qrStrings.status.fetchError}</p>;
  }

  return (
    <div className="pb-10">
      <div className="px-4 py-4">
        <p className="text-sm font-bold text-navy">
          {status.table_name}
          {qrStrings.status.titleSuffix}
        </p>
      </div>

      {status.items.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-gray-400">{qrStrings.status.empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 bg-white">
          {status.items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-navy">
                  {it.name} × {it.quantity}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {it.ordered_at} {qrStrings.status.orderedAtSuffix}
                </p>
              </div>
              <Badge tone={STATUS_TONES[it.kitchen_status] ?? 'gray'}>
                {KITCHEN_STATUS_LABELS[it.kitchen_status] ?? it.kitchen_status}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="mx-4 mt-4 flex justify-between rounded-xl bg-gray-50 px-4 py-3 text-base font-bold text-navy">
        <span>{qrStrings.status.total}</span>
        <span className="tabular-nums">{yen(status.total)}</span>
      </div>

      <div className="mx-4 mt-6 space-y-3">
        <Button variant="secondary" size="lg" className="w-full" onClick={() => setCallNoticeVisible(true)}>
          <Bell className="h-4 w-4" />
          {qrStrings.status.callStaff}
        </Button>
        {callNoticeVisible && (
          <p className="rounded-xl bg-primary-soft px-4 py-3 text-center text-sm font-medium text-primary-deep">
            {qrStrings.status.callNotice}
          </p>
        )}
        <p className="text-center text-xs text-gray-500">{qrStrings.status.payNotice}</p>
      </div>
    </div>
  );
}
