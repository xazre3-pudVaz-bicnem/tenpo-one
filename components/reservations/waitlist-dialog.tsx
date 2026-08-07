'use client';

import { useState, useTransition } from 'react';
import { UserPlus, Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { todayJst } from '@/lib/format';
import { createWaitlistEntry } from '@/app/app/reservations/actions';
import type { StoreRef } from '@/lib/auth';

const EMPTY = {
  storeId: '',
  name: '',
  phone: '',
  partySize: 2,
  desiredDate: todayJst(),
  timeFrom: '',
  timeTo: '',
  note: '',
};

export function WaitlistDialog({
  stores,
  defaultStoreId,
  defaultDate,
}: {
  stores: StoreRef[];
  defaultStoreId: string | null;
  defaultDate?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const initialStoreId = defaultStoreId ?? stores[0]?.id ?? '';
  const [form, setForm] = useState({ ...EMPTY, storeId: initialStoreId, desiredDate: defaultDate ?? EMPTY.desiredDate });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    startTransition(async () => {
      try {
        await createWaitlistEntry({
          storeId: form.storeId,
          name: form.name,
          phone: form.phone,
          partySize: form.partySize,
          desiredDate: form.desiredDate,
          timeFrom: form.timeFrom || undefined,
          timeTo: form.timeTo || undefined,
          note: form.note || undefined,
        });
        toast('キャンセル待ちを登録しました');
        setForm({ ...EMPTY, storeId: initialStoreId, desiredDate: defaultDate ?? EMPTY.desiredDate });
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
        キャンセル待ちを登録
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="キャンセル待ちの登録">
        <div className="space-y-3">
          {stores.length > 1 && (
            <div>
              <Label htmlFor="wl-store">店舗</Label>
              <Select id="wl-store" value={form.storeId} onChange={(e) => set('storeId', e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="wl-name">お名前</Label>
            <Input id="wl-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="山田 太郎" />
          </div>
          <div>
            <Label htmlFor="wl-phone">電話番号</Label>
            <Input id="wl-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="09012345678" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wl-party">人数</Label>
              <Input id="wl-party" type="number" min={1} value={form.partySize} onChange={(e) => set('partySize', Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="wl-date">希望日</Label>
              <Input id="wl-date" type="date" value={form.desiredDate} onChange={(e) => set('desiredDate', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wl-from">希望時間（から）</Label>
              <Input id="wl-from" type="time" value={form.timeFrom} onChange={(e) => set('timeFrom', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="wl-to">希望時間（まで）</Label>
              <Input id="wl-to" type="time" value={form.timeTo} onChange={(e) => set('timeTo', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="wl-note">メモ</Label>
            <Textarea id="wl-note" value={form.note} onChange={(e) => set('note', e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !form.storeId || !form.name.trim() || form.phone.trim().length < 10}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            登録する
          </Button>
        </div>
      </Dialog>
    </>
  );
}
