'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveTable } from '@/app/app/settings/tables/actions';
import type { FloorRow } from './floors-panel';

export interface TableRow {
  id: string;
  name: string;
  floorId: string | null;
  capacityMin: number;
  capacityMax: number;
  isPrivateRoom: boolean;
  isCounter: boolean;
  smokingAllowed: boolean;
  sortOrder: number;
}

export function TableDialog({
  storeId,
  floors,
  editing,
  onClose,
}: {
  storeId: string;
  floors: FloorRow[];
  editing: TableRow | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<TableRow>(
    editing ?? {
      id: '',
      name: '',
      floorId: floors[0]?.id ?? null,
      capacityMin: 1,
      capacityMax: 4,
      isPrivateRoom: false,
      isCounter: false,
      smokingAllowed: false,
      sortOrder: 0,
    }
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof TableRow>(key: K, value: TableRow[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    if (!form.name.trim()) {
      setError('テーブル名を入力してください');
      return;
    }
    if (form.capacityMin < 1 || form.capacityMax < form.capacityMin) {
      setError('席数の指定が正しくありません');
      return;
    }
    startTransition(async () => {
      const result = await saveTable({
        id: editing?.id,
        storeId,
        floorId: form.floorId || null,
        name: form.name,
        capacityMin: form.capacityMin,
        capacityMax: form.capacityMax,
        isPrivateRoom: form.isPrivateRoom,
        isCounter: form.isCounter,
        smokingAllowed: form.smokingAllowed,
        sortOrder: form.sortOrder,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editing ? 'テーブルを更新しました' : 'テーブルを追加しました');
      onClose();
    });
  };

  return (
    <Dialog open onClose={onClose} title={editing ? 'テーブル編集' : 'テーブル追加'}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="table-name">テーブル名</Label>
          <Input id="table-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="T-01" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="table-min">最小席数</Label>
            <Input
              id="table-min"
              type="number"
              min={1}
              value={form.capacityMin}
              onChange={(e) => set('capacityMin', Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="table-max">最大席数</Label>
            <Input
              id="table-max"
              type="number"
              min={1}
              value={form.capacityMax}
              onChange={(e) => set('capacityMax', Number(e.target.value))}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="table-floor">フロア</Label>
          <Select id="table-floor" value={form.floorId ?? ''} onChange={(e) => set('floorId', e.target.value || null)}>
            <option value="">未割当</option>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="table-sort">並び順</Label>
          <Input
            id="table-sort"
            type="number"
            value={form.sortOrder}
            onChange={(e) => set('sortOrder', Number(e.target.value))}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={form.isPrivateRoom}
              onChange={(e) => set('isPrivateRoom', e.target.checked)}
            />
            個室
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={form.isCounter}
              onChange={(e) => set('isCounter', e.target.checked)}
            />
            カウンター
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={form.smokingAllowed}
              onChange={(e) => set('smokingAllowed', e.target.checked)}
            />
            喫煙可
          </label>
        </div>

        <FieldError message={error ?? undefined} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
