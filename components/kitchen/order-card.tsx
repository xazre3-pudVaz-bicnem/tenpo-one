'use client';

import { useTransition } from 'react';
import { cn } from '@/lib/utils';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  getElapsedTone,
  KITCHEN_STATUS_LABELS,
  ORDER_SOURCE_LABELS,
  type KdsOrderGroup,
  type KdsSettings,
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

/** 4段階の警告レベル→カード枠線・経過時間文字色 */
const TONE_BORDER: Record<'default' | 'info' | 'warning' | 'danger', string> = {
  default: 'border-gray-200',
  info: 'border-primary',
  warning: 'border-warning',
  danger: 'border-danger',
};
const TONE_TEXT: Record<'default' | 'info' | 'warning' | 'danger', string> = {
  default: 'text-gray-500',
  info: 'text-primary-deep',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function OrderCard({
  group,
  now,
  showServed,
  kdsSettings,
  setItemStatusAction,
  markOrderServedAction,
}: {
  group: KdsOrderGroup;
  now: number;
  showServed: boolean;
  kdsSettings: KdsSettings;
  setItemStatusAction: (orderItemId: string, nextStatus: KitchenStatus) => Promise<void>;
  markOrderServedAction: (orderId: string, onlyItemIds?: string[]) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(group.orderTime).getTime()) / 60000));
  const tone = getElapsedTone(elapsedMinutes, kdsSettings);

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
    // group.items は呼び出し元（KdsBoard）で表示中のステーション・提供済表示設定により
    // 絞り込まれた品目のため、そのIDのみを対象にする（他ステーションの品目を誤って提供済にしない）
    const activeItemIds = group.items.filter((i) => i.kitchenStatus !== 'served').map((i) => i.id);
    startTransition(async () => {
      try {
        await markOrderServedAction(group.orderId, activeItemIds);
      } catch (e) {
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });
  };

  return (
    <div
      className={cn('flex flex-col rounded-2xl border-2 bg-white p-4 shadow-sm', TONE_BORDER[tone])}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold text-navy">{group.tableName ?? `注文 #${group.orderNo}`}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={group.orderSource === 'qr' ? 'primary' : 'navy'}>
              {ORDER_SOURCE_LABELS[group.orderSource]}
            </Badge>
            <span
              className={cn('text-sm font-bold tabular-nums', TONE_TEXT[tone])}
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
                {item.modifiers.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.modifiers.map((m, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-deep"
                      >
                        {m.name}
                      </span>
                    ))}
                  </div>
                )}
                {item.memo && (
                  <p className="mt-1 rounded-md bg-yellow-100 px-2 py-1 text-sm font-medium text-yellow-800">
                    {item.memo}
                  </p>
                )}
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
