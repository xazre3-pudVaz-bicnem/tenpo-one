'use client';

import { useMemo, useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { toggleSoldOut, deleteMenuItem } from '@/app/app/settings/menu/actions';
import { MenuItemDialog, type MenuItemRow } from './menu-item-dialog';
import type { CategoryRow } from './category-panel';

const ITEM_TYPE_LABEL: Record<string, string> = { food: 'フード', drink: 'ドリンク', course: 'コース', option: 'オプション' };

export function MenuItemsPanel({
  storeId,
  categories,
  taxRates,
  initial,
}: {
  storeId: string;
  categories: CategoryRow[];
  taxRates: { id: string; name: string }[];
  initial: MenuItemRow[];
}) {
  const items = initial;

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItemRow | null>(null);
  const [deleting, setDeleting] = useState<MenuItemRow | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const visibleItems = items.filter((i) => i.status !== 'deleted');

  const filtered = useMemo(() => {
    return visibleItems.filter((i) => {
      if (activeCategory === 'uncategorized' && i.categoryId) return false;
      if (activeCategory !== 'all' && activeCategory !== 'uncategorized' && i.categoryId !== activeCategory) return false;
      if (search.trim() && !`${i.name}${i.nameKana}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [visibleItems, activeCategory, search]);

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '未分類';

  const handleToggleSoldOut = (item: MenuItemRow) => {
    startTransition(async () => {
      const result = await toggleSoldOut(item.id, !item.isSoldOut);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(item.isSoldOut ? '販売を再開しました' : '売切に設定しました（POSに即時反映されます）');
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-medium',
            activeCategory === 'all' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          すべて
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCategory(c.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium',
              activeCategory === c.id ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {c.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setActiveCategory('uncategorized')}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-medium',
            activeCategory === 'uncategorized' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          未分類
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="商品名で検索"
            className="pl-9"
          />
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          商品追加
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="該当する商品がありません" description="「商品追加」から登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>商品名</Th>
                <Th>カテゴリ</Th>
                <Th>種別</Th>
                <Th className="text-right">価格</Th>
                <Th className="text-right">テイクアウト</Th>
                <Th className="text-right">原価</Th>
                <Th>売切</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {filtered.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-medium text-navy">
                    {i.name}
                    {i.status === 'hidden' && (
                      <Badge tone="gray" className="ml-2">
                        非表示
                      </Badge>
                    )}
                  </Td>
                  <Td>{categoryName(i.categoryId)}</Td>
                  <Td>{ITEM_TYPE_LABEL[i.itemType] ?? i.itemType}</Td>
                  <Td className="text-right tabular-nums">{yen(i.price)}</Td>
                  <Td className="text-right tabular-nums">{i.takeoutPrice != null ? yen(i.takeoutPrice) : '—'}</Td>
                  <Td className="text-right tabular-nums">{i.cost != null ? yen(i.cost) : '—'}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => handleToggleSoldOut(i)}
                      disabled={pending}
                    >
                      <Badge tone={i.isSoldOut ? 'danger' : 'success'} className="cursor-pointer">
                        {i.isSoldOut ? '売切中' : '販売中'}
                      </Badge>
                    </button>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(i);
                          setDialogOpen(true);
                        }}
                        aria-label="編集"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(i)}
                        aria-label="削除"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {dialogOpen && (
        <MenuItemDialog
          storeId={storeId}
          categories={categories}
          taxRates={taxRates}
          editing={editing}
          defaultCategoryId={activeCategory === 'all' || activeCategory === 'uncategorized' ? null : activeCategory}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="商品を削除"
          message={`「${deleting.name}」を削除します。過去の注文履歴には引き続き表示されます。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteMenuItem(deleting.id);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('商品を削除しました');
          }}
        />
      )}
    </div>
  );
}
