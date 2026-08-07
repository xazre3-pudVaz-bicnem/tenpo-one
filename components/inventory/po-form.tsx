'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { createPurchaseOrder } from '@/app/app/purchases/actions';
import { TAX_RATE_OPTIONS } from './labels';

interface InventoryItemOption {
  id: string;
  name: string;
  unit: string;
  avgCost: number | null;
}

interface VendorOption {
  id: string;
  name: string;
}

interface Line {
  key: string;
  inventoryItemId: string;
  name: string;
  quantity: string;
  unit: string;
  unitCost: string;
  taxRate: string;
}

let seq = 0;
function newLine(overrides?: Partial<Line>): Line {
  seq += 1;
  return { key: `l${seq}`, inventoryItemId: '', name: '', quantity: '1', unit: '個', unitCost: '0', taxRate: '10', ...overrides };
}

function lineSubtotal(l: Line): number {
  return Math.round((Number(l.quantity) || 0) * (Number(l.unitCost) || 0));
}
function lineTax(l: Line): number {
  return Math.round((lineSubtotal(l) * (Number(l.taxRate) || 0)) / 100);
}

/** 発注書作成フォーム。明細行を動的に追加・削除でき、税率を含めた合計金額を自動計算する */
export function PoForm({
  storeId,
  vendors,
  inventoryItems,
  initialItemId,
}: {
  storeId: string;
  vendors: VendorOption[];
  inventoryItems: InventoryItemOption[];
  initialItemId?: string;
}) {
  const [vendorId, setVendorId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => {
    const initialItem = initialItemId ? inventoryItems.find((i) => i.id === initialItemId) : undefined;
    return [
      initialItem
        ? newLine({
            inventoryItemId: initialItem.id,
            name: initialItem.name,
            unit: initialItem.unit,
            unitCost: initialItem.avgCost != null ? String(initialItem.avgCost) : '0',
          })
        : newLine(),
    ];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + lineSubtotal(l), 0), [lines]);
  const taxTotal = useMemo(() => lines.reduce((sum, l) => sum + lineTax(l), 0), [lines]);
  const total = subtotal + taxTotal;

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const selectInventoryItem = (key: string, itemId: string) => {
    const item = inventoryItems.find((i) => i.id === itemId);
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              inventoryItemId: itemId,
              name: item ? item.name : l.name,
              unit: item ? item.unit : l.unit,
              unitCost: item?.avgCost != null ? String(item.avgCost) : l.unitCost,
            }
          : l
      )
    );
  };

  const handleSubmit = async () => {
    setError(null);
    if (!vendorId) {
      setError('仕入先を選択してください');
      return;
    }
    const validLines = lines.filter((l) => l.name.trim() && Number(l.quantity) > 0);
    if (validLines.length === 0) {
      setError('明細を1件以上入力してください');
      return;
    }

    setBusy(true);
    try {
      const id = await createPurchaseOrder({
        storeId,
        vendorId,
        expectedAt: expectedAt || null,
        note: note || null,
        lines: validLines.map((l) => ({
          inventoryItemId: l.inventoryItemId || null,
          name: l.name.trim(),
          quantity: Number(l.quantity),
          unit: l.unit || '個',
          unitCost: Math.round(Number(l.unitCost) || 0),
          taxRate: Number(l.taxRate) || 0,
        })),
      });
      toast('発注書を作成しました');
      router.push(`/app/purchases/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="po-vendor">仕入先</Label>
          <Select id="po-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">選択してください</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="po-expected">入荷予定日</Label>
          <Input id="po-expected" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="po-note">メモ</Label>
          <Input id="po-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label className="mb-0">明細</Label>
          <Button type="button" size="sm" variant="secondary" onClick={() => setLines((p) => [...p, newLine()])}>
            <Plus className="h-3.5 w-3.5" />
            行を追加
          </Button>
        </div>
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-gray-200 p-2">
              <div className="col-span-3">
                <Label className="text-[11px]">品目</Label>
                <Select value={l.inventoryItemId} onChange={(e) => selectInventoryItem(l.key, e.target.value)}>
                  <option value="">自由入力</option>
                  {inventoryItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
                {!l.inventoryItemId && (
                  <Input
                    className="mt-1"
                    placeholder="品目名"
                    value={l.name}
                    onChange={(e) => updateLine(l.key, { name: e.target.value })}
                  />
                )}
              </div>
              <div className="col-span-2">
                <Label className="text-[11px]">数量</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={l.quantity}
                  onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Label className="text-[11px]">単位</Label>
                <Input value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label className="text-[11px]">単価（税抜）</Label>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={l.unitCost}
                  onChange={(e) => updateLine(l.key, { unitCost: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label className="text-[11px]">税率</Label>
                <Select value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })}>
                  {TAX_RATE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-1 text-right text-xs tabular-nums text-gray-500">{yen(lineSubtotal(l))}</div>
              <div className="col-span-1 flex justify-end">
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
          ))}
        </div>
      </div>

      <div className="ml-auto w-full max-w-xs space-y-1 rounded-lg bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>小計（税抜）</span>
          <span className="tabular-nums">{yen(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>消費税</span>
          <span className="tabular-nums">{yen(taxTotal)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 pt-1">
          <span className="text-sm font-medium text-gray-600">合計（税込）</span>
          <span className="text-lg font-bold tabular-nums text-navy">{yen(total)}</span>
        </div>
      </div>

      <FieldError message={error ?? undefined} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push('/app/purchases')} disabled={busy}>
          キャンセル
        </Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={busy}>
          {busy ? '作成中…' : '発注書を作成'}
        </Button>
      </div>
    </div>
  );
}
