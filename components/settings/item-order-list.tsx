'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { moveInList } from '@/lib/menu-book';
import { saveItemOrder } from '@/app/app/settings/menu-book/actions';
import type { MenuItemRow } from './menu-item-dialog';

/**
 * 並び替えの部品（メニューブック・メニュー編集で共通）。
 * 商品の並び順は menu_items.sort_order に保存し、レジ・ハンディ・お客様QRで同じ順になる。
 */

export function SaveBar({
  dirty,
  pending,
  onSave,
  onReset,
  label = '変更を保存',
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  onReset?: () => void;
  label?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex items-center justify-end gap-2 border-t border-gray-200 bg-white/95 px-1 py-3 backdrop-blur">
      {dirty ? (
        <span className="mr-auto text-xs font-medium text-warning">保存していない変更があります</span>
      ) : (
        <span className="mr-auto text-xs text-gray-400">変更はありません</span>
      )}
      {onReset && (
        <Button variant="outline" size="md" onClick={onReset} disabled={!dirty || pending}>
          元に戻す
        </Button>
      )}
      <Button size="md" onClick={onSave} disabled={!dirty || pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </Button>
    </div>
  );
}

export function MoveButtons({
  index,
  count,
  onMove,
  label,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  label: string;
}) {
  const btn =
    'flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 active:bg-gray-100 disabled:opacity-30';
  const first = index === 0;
  const last = index === count - 1;
  return (
    <div className="flex shrink-0 gap-1">
      <button type="button" className={btn} onClick={() => onMove(0)} disabled={first} aria-label={`${label}を先頭へ`}>
        <ChevronsUp className="h-4 w-4" />
      </button>
      <button type="button" className={btn} onClick={() => onMove(index - 1)} disabled={first} aria-label={`${label}を上へ`}>
        <ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className={btn} onClick={() => onMove(index + 1)} disabled={last} aria-label={`${label}を下へ`}>
        <ArrowDown className="h-4 w-4" />
      </button>
      <button type="button" className={btn} onClick={() => onMove(count - 1)} disabled={last} aria-label={`${label}を最後へ`}>
        <ChevronsDown className="h-4 w-4" />
      </button>
    </div>
  );
}

export function sortItems(list: MenuItemRow[]): MenuItemRow[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja'));
}

export function ItemOrderList({
  storeId,
  categoryId,
  items,
  onEdit,
}: {
  storeId: string;
  categoryId: string;
  items: MenuItemRow[];
  onEdit: (item: MenuItemRow) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [order, setOrder] = useState(() => items.map((i) => i.id));
  const [pending, startTransition] = useTransition();
  const byId = new Map(items.map((i) => [i.id, i]));
  const dirty = order.join('|') !== items.map((i) => i.id).join('|');

  const save = () => {
    startTransition(async () => {
      const result = await saveItemOrder(storeId, categoryId, order);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('商品の順番を保存しました（レジ・ハンディ・お客様QRに反映）');
      router.refresh();
    });
  };

  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">このカテゴリに商品はありません</p>;
  }

  return (
    <div>
      <ol className="space-y-2">
        {order.map((id, i) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <li key={id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2 pl-3">
              <MoveButtons
                index={i}
                count={order.length}
                label={item.name}
                onMove={(to) => setOrder((list) => moveInList(list, i, to))}
              />
              <span className="w-6 shrink-0 text-right text-xs text-gray-400 tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className={cn('truncate font-semibold text-navy', item.status === 'hidden' && 'text-gray-400')}>
                  {item.name}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                  <span className="tabular-nums">{item.pricePending ? '価格未定' : yen(item.price)}</span>
                  {item.isSoldOut && <Badge tone="danger">売切</Badge>}
                  {item.status === 'hidden' && <Badge tone="gray">非表示</Badge>}
                  {item.nameEn && <span className="truncate text-gray-400">{item.nameEn}</span>}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onEdit(item)}>
                <Pencil className="h-3.5 w-3.5" />
                編集
              </Button>
            </li>
          );
        })}
      </ol>
      <SaveBar
        dirty={dirty}
        pending={pending}
        onSave={save}
        onReset={() => setOrder(items.map((i) => i.id))}
        label="順番を保存"
      />
    </div>
  );
}
