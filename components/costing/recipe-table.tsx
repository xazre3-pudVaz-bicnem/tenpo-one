'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { deleteRecipeLine } from '@/app/app/costing/actions';
import { RecipeLineForm, type IngredientOption } from './recipe-line-form';

export interface RecipeLineRow {
  id: string;
  inventoryItemId: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  avgCost: number | null;
  lineCost: number | null;
  note: string | null;
}

const RECIPE_EXAMPLE = '例：唐揚げ定食＝鶏肉200g／油20ml／キャベツ80g／米200g のように、使用する食材と使用量を登録してください';

/** レシピ明細テーブル（追加・編集・削除）。編集のたびに router.refresh() でヘッダーの原価を再計算表示する */
export function RecipeTable({
  menuItemId,
  lines,
  ingredientOptions,
}: {
  menuItemId: string;
  lines: RecipeLineRow[];
  ingredientOptions: IngredientOption[];
}) {
  const [deleting, setDeleting] = useState<RecipeLineRow | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <RecipeLineForm menuItemId={menuItemId} ingredientOptions={ingredientOptions} />
      </div>

      {lines.length === 0 ? (
        <EmptyState
          title="レシピが設定されていません"
          description={RECIPE_EXAMPLE}
          action={<RecipeLineForm menuItemId={menuItemId} ingredientOptions={ingredientOptions} />}
        />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>食材</Th>
                <Th className="text-right">使用量</Th>
                <Th>単位</Th>
                <Th className="text-right">単価</Th>
                <Th className="text-right">行原価</Th>
                <Th>メモ</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {lines.map((l) => (
                <Tr key={l.id}>
                  <Td className="font-medium text-navy">{l.ingredientName}</Td>
                  <Td className="text-right tabular-nums">{l.quantity}</Td>
                  <Td>{l.unit}</Td>
                  <Td className="text-right tabular-nums">{l.avgCost != null ? yen(l.avgCost) : '原価未設定'}</Td>
                  <Td className="text-right tabular-nums">{l.lineCost != null ? yen(l.lineCost) : '—'}</Td>
                  <Td className="max-w-[12rem] truncate text-xs text-gray-500">{l.note ?? ''}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <RecipeLineForm
                        menuItemId={menuItemId}
                        ingredientOptions={ingredientOptions}
                        line={{ id: l.id, inventoryItemId: l.inventoryItemId, quantity: l.quantity, note: l.note }}
                      />
                      <button
                        type="button"
                        onClick={() => setDeleting(l)}
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

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="食材を削除"
          message={`「${deleting.ingredientName}」をレシピから削除します。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteRecipeLine(deleting.id, menuItemId);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('食材を削除しました');
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
