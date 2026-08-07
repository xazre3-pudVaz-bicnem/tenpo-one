'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBag, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: '店内',
  takeout: 'テイクアウト',
  delivery: 'デリバリー',
  course: 'コース',
  pre_order: '事前注文',
};

export interface OpenOrderRow {
  id: string;
  orderNo: number;
  orderType: string;
  guestCount: number;
  openedAt: string;
  tableName: string | null;
  /** 伝票分割・再会計で作成された伝票か（source_order_id が設定されている） */
  isDerived: boolean;
}

export function OrderPicker({
  storeId,
  orders,
  startTakeoutAction,
}: {
  storeId: string;
  orders: OpenOrderRow[];
  startTakeoutAction: () => Promise<{ orderId: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  // 会計待ち注文の一覧はフロア・KDS側の操作でも変わるため、ordersの変更をRealtimeで検知して更新する。
  useStoreRealtimeRefresh({ storeId, tables: ['orders'] });

  const handleTakeout = () => {
    startTransition(async () => {
      try {
        const { orderId } = await startTakeoutAction();
        router.push(`/app/pos?order=${orderId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'テイクアウト注文の作成に失敗しました', 'error');
      }
    });
  };

  return (
    <div className="space-y-4">
      <Button size="pos" onClick={handleTakeout} disabled={pending} className="w-full sm:w-auto">
        <ShoppingBag className="h-5 w-5" />
        テイクアウト注文を開始
      </Button>

      {orders.length === 0 ? (
        <EmptyState
          title="会計待ちの注文はありません"
          description="フロアマップから着席・ウォークインすると注文が作成されます"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((o) => (
            <Card key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-navy">
                    {o.tableName ?? ORDER_TYPE_LABELS[o.orderType] ?? o.orderType}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">#{o.orderNo}　{formatDateTime(o.openedAt)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone="primary">{o.guestCount}名</Badge>
                  {o.isDerived && <Badge tone="warning">分割伝票</Badge>}
                </div>
              </div>
              <Button
                variant="secondary"
                size="md"
                className="mt-3 w-full"
                onClick={() => router.push(`/app/pos?order=${o.id}`)}
              >
                開く
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
