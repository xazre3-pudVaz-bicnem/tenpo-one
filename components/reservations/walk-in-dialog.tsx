'use client';

import { useMemo, useState, useTransition } from 'react';
import { UserPlus, Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createWalkInReservation } from '@/app/app/reservations/actions';
import type { StoreRef } from '@/lib/auth';

export interface TableOption {
  id: string;
  name: string;
  capacityMax: number;
}

export function WalkInDialog({
  stores,
  defaultStoreId,
  storeTables,
}: {
  stores: StoreRef[];
  defaultStoreId: string | null;
  storeTables: Record<string, TableOption[]>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialStoreId = defaultStoreId ?? stores[0]?.id ?? '';
  const [storeId, setStoreId] = useState(initialStoreId);
  const [tableId, setTableId] = useState('');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const tables = useMemo(() => storeTables[storeId] ?? [], [storeTables, storeId]);

  const reset = () => {
    setStoreId(initialStoreId);
    setTableId('');
    setAdults(2);
    setChildren(0);
    setName('');
    setPhone('');
  };

  const submit = () => {
    startTransition(async () => {
      try {
        await createWalkInReservation({
          storeId,
          tableId,
          adults,
          children,
          name: name || undefined,
          phone: phone || undefined,
        });
        toast('ウォークインを登録しました');
        reset();
        setOpen(false);
      } catch (e) {
        toast(e instanceof Error ? e.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        ウォークイン登録
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="ウォークイン登録">
        <div className="space-y-3">
          {stores.length > 1 && (
            <div>
              <Label htmlFor="wi-store">店舗</Label>
              <Select
                id="wi-store"
                value={storeId}
                onChange={(e) => {
                  setStoreId(e.target.value);
                  setTableId('');
                }}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="wi-table">テーブル</Label>
            <Select id="wi-table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">選択してください</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（最大{t.capacityMax}名）
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wi-adults">大人</Label>
              <Input id="wi-adults" type="number" min={0} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="wi-children">子ども</Label>
              <Input id="wi-children" type="number" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label htmlFor="wi-name">お名前（任意）</Label>
            <Input id="wi-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="wi-phone">電話番号（任意）</Label>
            <Input id="wi-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !storeId || !tableId || adults + children < 1}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            登録して着席
          </Button>
        </div>
      </Dialog>
    </>
  );
}
