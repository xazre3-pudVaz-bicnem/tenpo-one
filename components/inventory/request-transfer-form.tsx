'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { requestStockTransfer } from '@/app/app/inventory/actions';

interface StoreOption {
  id: string;
  name: string;
}

interface ItemOption {
  id: string;
  name: string;
  unit: string;
  currentQuantity: number;
}

interface Line {
  key: string;
  inventoryItemId: string;
  quantity: string;
}

let seq = 0;
function newLine(): Line {
  seq += 1;
  return { key: `t${seq}`, inventoryItemId: '', quantity: '1' };
}

/** 店舗間移動の「申請」ダイアログ。発送・受取は別途 rpc で行うため、ここでは行数量の起票のみ */
export function RequestTransferForm({
  fromStoreId,
  otherStores,
  items,
}: {
  fromStoreId: string;
  otherStores: StoreOption[];
  items: ItemOption[];
}) {
  const [open, setOpen] = useState(false);
  const [toStoreId, setToStoreId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
    setToStoreId('');
    setNote('');
    setLines([newLine()]);
  };

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const itemById = (id: string) => items.find((i) => i.id === id);

  const handleSubmit = async () => {
    setError(null);
    if (!toStoreId) {
      setError('移動先店舗を選択してください');
      return;
    }
    const validLines = lines.filter((l) => l.inventoryItemId && Number(l.quantity) > 0);
    if (validLines.length === 0) {
      setError('品目を1件以上選択してください');
      return;
    }
    setBusy(true);
    try {
      await requestStockTransfer({
        fromStoreId,
        toStoreId,
        note: note.trim() || null,
        lines: validLines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: Number(l.quantity) })),
      });
      toast('移動を申請しました');
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '申請に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  if (otherStores.length === 0) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        移動を申請
      </Button>
      <Dialog open={open} onClose={close} title="店舗間移動を申請" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="req-store">移動先店舗</Label>
              <Select id="req-store" value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}>
                <option value="">選択してください</option>
                {otherStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="req-note">メモ（任意）</Label>
              <Textarea id="req-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="mb-0">品目</Label>
              <Button type="button" size="sm" variant="secondary" onClick={() => setLines((p) => [...p, newLine()])}>
                <Plus className="h-3.5 w-3.5" />
                行を追加
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((l) => {
                const selected = itemById(l.inventoryItemId);
                return (
                  <div key={l.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-gray-200 p-2">
                    <div className="col-span-7">
                      <Label className="text-[11px]">品目</Label>
                      <Select
                        value={l.inventoryItemId}
                        onChange={(e) => updateLine(l.key, { inventoryItemId: e.target.value })}
                      >
                        <option value="">選択してください</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}（現在庫 {i.currentQuantity}
                            {i.unit}）
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-[11px]">数量{selected ? `（${selected.unit}）` : ''}</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                        disabled={lines.length <= 1}
                        aria-label="この行を削除"
                      >
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={busy}>
              {busy ? '申請中…' : '申請する'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
