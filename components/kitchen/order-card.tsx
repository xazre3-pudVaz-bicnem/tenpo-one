'use client';

import { useTransition } from 'react';
import { cn } from '@/lib/utils';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  KDS_DANGER_MINUTES,
  KDS_WARNING_MINUTES,
  KITCHEN_STATUS_LABELS,
  ORDER_SOURCE_LABELS,
  type KdsOrderGroup,
  type KitchenStatus,
} from './types';

const NEXT_ACTION_LABEL: Partial<Record<KitchenStatus, string>> = {
  pending: '調理開始',
  preparing: '完成',
  ready: '提供済',
};

const NEXT_STATUS: Partial<Record<KitchenStatus, KitchenStatus>> = {
  pending: 'preparing',
  preparing: 'ready',
  ready: 'served',
};

const STATUS_TONES: Record<KitchenStatus, BadgeTone> = {
  pending: 'gray',
  preparing: 'warning',
  ready: 'success',
  served: 'navy',
};

export function OrderCard({
  group,
  now,
  showServed,
  setItemStatusAction,
  markOrderServedAction,
}: {
  group: KdsOrderGroup;
  now: number;
  showServed: boolean;
  setItemStatusAction: (orderItemId: string, nextStatus: KitchenStatus) => Promise<void>;
  markOrderServedAction: (orderId: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(group.orderTime).getTime()) / 60000));
  const isDanger = elapsedMinutes >= KDS_DANGER_MINUTES;
  const isWarning = !isDanger && elapsedMinutes >= KDS_WARNING_MINUTES;

  const visibleItems = showServed ? group.items : group.items.filter((i) => i.kitchenStatus !== 'served');
  const hasActiveItems = group.items.some((i) => i.kitchenStatus !== 'served');

  if (visibleItems.length === 0) return null;

  const handleAdvance = (orderItemId: string, current: KitchenStatus) => {
    const next = NEXT_STATUS[current];
    if (!next) return;
    startTransition(async () => {
      try {
        await setItemStatusAction(orderItemId, next);
      } catch (e) {
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });
  };

  const handleAllServed = () => {
    startTransition(async () => {
      try {
        await markOrderServedAction(group.orderId);
      } catch (e) {
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });
  };

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border-2 bg-white p-4 shadow-sm',
        isDanger ? 'border-danger' : isWarning ? 'border-warning' : 'border-gray-200'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold text-navy">{group.tableName ?? `注文 #${group.orderNo}`}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={group.orderSource === 'qr' ? 'primary' : 'navy'}>
              {ORDER_SOURCE_LABELS[group.orderSource]}
            </Badge>
            <span
              className={cn(
                'text-sm font-bold tabular-nums',
                isDanger ? 'text-danger' : isWarning ? 'text-warning' : 'text-gray-500'
              )}
            >
              経過 {elapsedMinutes}分
            </span>
          </div>
        </div>
      </div>

      <ul className="mt-3 flex-1 divide-y divide-gray-100">
        {visibleItems.map((item) => (
          <li key={item.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-base font-bold',
                    item.kitchenStatus === 'served' ? 'text-gray-400 line-through' : 'text-navy'
                  )}
                >
                  {item.name} × {item.quantity}
                </p>
                {item.memo && <p className="mt-0.5 text-sm text-warning">{item.memo}</p>}
              </div>
              <Badge tone={STATUS_TONES[item.kitchenStatus]}>{KITCHEN_STATUS_LABELS[item.kitchenStatus]}</Badge>
            </div>
            {item.kitchenStatus !== 'served' && (
              <Button
                size="pos"
                className="mt-2 w-full"
                disabled={pending}
                onClick={() => handleAdvance(item.id, item.kitchenStatus)}
              >
                {NEXT_ACTION_LABEL[item.kitchenStatus]}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {hasActiveItems && (
        <Button variant="secondary" className="mt-3 w-full" disabled={pending} onClick={handleAllServed}>
          すべて提供済にする
        </Button>
      )}
    </div>
  );
}
