'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input, FieldError } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { saveCounts, finalizeCount } from '@/app/app/inventory/actions';

export interface CountItemRow {
  id: string;
  name: string;
  unit: string;
  expectedQuantity: number;
  countedQuantity: number | null;
}

/** 棚卸の実数入力フォーム（一括保存・確定） */
export function CountForm({ countId, items }: { countId: string; items: CountItemRow[] }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.id, i.countedQuantity != null ? String(i.countedQuantity) : '']))
  );
  const [busy, setBusy] = useState(false);
  const [showFinalize, setShowFinalize] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const buildEntries = () =>
    Object.entries(values)
      .filter(([, v]) => v !== '')
      .map(([id, v]) => ({ id, countedQuantity: Number(v) }))
      .filter((e) => Number.isFinite(e.countedQuantity));

  const handleSave = async () => {
    setError(null);
    setBusy(true);
    try {
      await saveCounts(countId, buildEntries());
      toast('実数を保存しました');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async () => {
    setError(null);
    setBusy(true);
    try {
      await saveCounts(countId, buildEntries());
      await finalizeCount(countId);
      toast('棚卸を確定しました');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '確定に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>品目</Th>
              <Th className="text-right">理論在庫</Th>
              <Th className="text-right">実数</Th>
            </Tr>
          </THead>
          <TBody>
            {items.map((i) => (
              <Tr key={i.id}>
                <Td className="font-medium text-navy">{i.name}</Td>
                <Td className="text-right tabular-nums">
                  {i.expectedQuantity}
                  {i.unit}
                </Td>
                <Td className="text-right">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="ml-auto w-28"
                    value={values[i.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [i.id]: e.target.value }))}
                  />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <FieldError message={error ?? undefined} />

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => void handleSave()} disabled={busy}>
          {busy ? '保存中…' : '一時保存する'}
        </Button>
        <Button onClick={() => setShowFinalize(true)} disabled={busy}>
          棚卸を確定する
        </Button>
      </div>

      <ConfirmDialog
        open={showFinalize}
        onClose={() => setShowFinalize(false)}
        title="棚卸を確定"
        message="入力済みの実数で在庫数量を更新します。この操作は取り消せません。未入力の品目は変更されません。"
        destructive={false}
        confirmLabel="確定する"
        onConfirm={handleFinalize}
      />
    </div>
  );
}
