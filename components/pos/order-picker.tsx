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
}

export function OrderPicker({
  orders,
  startTakeoutAction,
}: {
  orders: OpenOrderRow[];
  startTakeoutAction: () => Promise<{ orderId: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

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
                <Badge tone="primary">{o.guestCount}名</Badge>
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
