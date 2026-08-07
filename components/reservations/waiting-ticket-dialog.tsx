'use client';

import { useState, useTransition } from 'react';
import { ClipboardList, Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createWaitingTicket } from '@/app/app/reservations/actions';
import type { StoreRef } from '@/lib/auth';

const EMPTY = {
  storeId: '',
  name: '',
  partySize: 2,
  phone: '',
  seatPreference: '',
};

/** 店頭ウェイティングの受付ダイアログ。登録すると受付番号を大きく表示する。 */
export function WaitingTicketDialog({
  stores,
  defaultStoreId,
}: {
  stores: StoreRef[];
  defaultStoreId: string | null;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const initialStoreId = defaultStoreId ?? stores[0]?.id ?? '';
  const [form, setForm] = useState({ ...EMPTY, storeId: initialStoreId });
  const [issued, setIssued] = useState<number | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const reset = () => {
    setForm({ ...EMPTY, storeId: initialStoreId });
    setIssued(null);
  };

  const submit = () => {
    startTransition(async () => {
      try {
        const result = await createWaitingTicket({
          storeId: form.storeId,
          name: form.name,
          partySize: form.partySize,
          phone: form.phone || undefined,
          seatPreference: form.seatPreference || undefined,
        });
        setIssued(result.ticketNo);
      } catch (e) {
        toast(e instanceof Error ? e.message : '受付に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <ClipboardList className="h-4 w-4" />
        受付
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title="店頭受付"
      >
        {issued != null ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm text-gray-500">受付番号</p>
            <p className="text-7xl font-bold tabular-nums text-primary-deep">#{issued}</p>
            <p className="mt-2 text-sm text-gray-600">{form.name} 様　{form.partySize}名</p>
            <Button
              className="mt-5"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              閉じる
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {stores.length > 1 && (
                <div>
                  <Label htmlFor="wt-store">店舗</Label>
                  <Select id="wt-store" value={form.storeId} onChange={(e) => set('storeId', e.target.value)}>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="wt-name">お名前</Label>
                <Input id="wt-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="山田 太郎" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="wt-party">人数</Label>
                  <Input
                    id="wt-party"
                    type="number"
                    min={1}
                    value={form.partySize}
                    onChange={(e) => set('partySize', Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="wt-phone">電話番号（任意）</Label>
                  <Input id="wt-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="店頭のみは省略可" />
                </div>
              </div>
              <div>
                <Label htmlFor="wt-seat">希望席（任意）</Label>
                <Input
                  id="wt-seat"
                  value={form.seatPreference}
                  onChange={(e) => set('seatPreference', e.target.value)}
                  placeholder="カウンター・個室 など"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                キャンセル
              </Button>
              <Button onClick={submit} disabled={pending || !form.storeId || !form.name.trim() || form.partySize < 1}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                受付する
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}
