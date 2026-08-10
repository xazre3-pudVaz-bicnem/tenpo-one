'use client';

import { useState, useTransition } from 'react';
import { Phone, Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Input, Label, Textarea, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { todayJst } from '@/lib/format';
import { createManualReservation } from '@/app/app/reservations/actions';
import type { StoreRef } from '@/lib/auth';

const EMPTY = {
  storeId: '',
  date: todayJst(),
  time: '18:00',
  adults: 2,
  children: 0,
  name: '',
  kana: '',
  phone: '',
  email: '',
  note: '',
  sourceCode: 'phone',
  courseId: '',
  tableIds: [] as string[],
};

export interface ReservationSourceOption {
  code: string;
  name: string;
}
export interface ReservationCourseOption {
  id: string;
  name: string;
}
export interface ReservationTableOption {
  id: string;
  name: string;
}

export interface ManualReservationPrefill {
  storeId?: string;
  date?: string;
  time?: string;
  adults?: number;
  children?: number;
  name?: string;
  kana?: string;
  phone?: string;
  email?: string;
  note?: string;
}

export function ManualReservationDialog({
  stores,
  defaultStoreId,
  prefill,
  sources,
  courses,
  tables,
  /** キャンセル待ちからの変換の場合に指定。登録成功時に waitlist_entries を converted にする */
  waitlistEntryId,
  triggerLabel = '電話予約を登録',
  triggerVariant = 'secondary',
  triggerSize = 'sm',
  onCreated,
}: {
  stores: StoreRef[];
  defaultStoreId: string | null;
  prefill?: ManualReservationPrefill;
  sources?: ReservationSourceOption[];
  courses?: ReservationCourseOption[];
  tables?: ReservationTableOption[];
  waitlistEntryId?: string;
  triggerLabel?: string;
  triggerVariant?: NonNullable<ButtonProps['variant']>;
  triggerSize?: NonNullable<ButtonProps['size']>;
  onCreated?: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const initialStoreId = prefill?.storeId ?? defaultStoreId ?? stores[0]?.id ?? '';
  const [form, setForm] = useState({ ...EMPTY, ...prefill, storeId: initialStoreId });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    startTransition(async () => {
      try {
        await createManualReservation({
          storeId: form.storeId,
          date: form.date,
          time: form.time,
          adults: form.adults,
          children: form.children,
          name: form.name,
          kana: form.kana || undefined,
          phone: form.phone,
          email: form.email || undefined,
          note: form.note || undefined,
          sourceCode: form.sourceCode || undefined,
          courseId: form.courseId || null,
          tableIds: form.tableIds,
          waitlistEntryId,
        });
        toast(waitlistEntryId ? '予約へ変換しました' : '電話予約を登録しました');
        setForm({ ...EMPTY, ...prefill, storeId: initialStoreId });
        setOpen(false);
        onCreated?.();
      } catch (e) {
        toast(e instanceof Error ? e.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} onClick={() => setOpen(true)}>
        <Phone className="h-4 w-4" />
        {triggerLabel}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={waitlistEntryId ? '予約へ変換' : '電話予約の登録'}>
        <div className="space-y-3">
          {stores.length > 1 && (
            <div>
              <Label htmlFor="mr-store">店舗</Label>
              <Select id="mr-store" value={form.storeId} onChange={(e) => set('storeId', e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {sources && sources.length > 0 && (
            <div>
              <Label htmlFor="mr-source">予約経路</Label>
              <Select id="mr-source" value={form.sourceCode} onChange={(e) => set('sourceCode', e.target.value)}>
                {sources.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mr-date">来店日</Label>
              <Input id="mr-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mr-time">時間</Label>
              <Input id="mr-time" type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mr-adults">大人</Label>
              <Input
                id="mr-adults"
                type="number"
                min={0}
                value={form.adults}
                onChange={(e) => set('adults', Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
              />
            </div>
            <div>
              <Label htmlFor="mr-children">子ども</Label>
              <Input
                id="mr-children"
                type="number"
                min={0}
                value={form.children}
                onChange={(e) => set('children', Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
              />
            </div>
          </div>
          {courses && courses.length > 0 && (
            <div>
              <Label htmlFor="mr-course">コース（任意）</Label>
              <Select id="mr-course" value={form.courseId} onChange={(e) => set('courseId', e.target.value)}>
                <option value="">選択しない</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {tables && tables.length > 0 && (
            <div>
              <Label>テーブル割当（任意・複数可）</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {tables.map((t) => {
                  const selected = form.tableIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        set(
                          'tableIds',
                          selected ? form.tableIds.filter((id) => id !== t.id) : [...form.tableIds, t.id]
                        )
                      }
                      className={
                        'rounded-lg border px-2.5 py-1 text-xs font-medium ' +
                        (selected ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 text-navy')
                      }
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-gray-500">未割当のままでも登録できます（後でフロア/台帳から割当可）。</p>
            </div>
          )}
          <div>
            <Label htmlFor="mr-name">お名前</Label>
            <Input id="mr-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="山田 太郎" />
          </div>
          <div>
            <Label htmlFor="mr-kana">フリガナ</Label>
            <Input id="mr-kana" value={form.kana} onChange={(e) => set('kana', e.target.value)} placeholder="ヤマダ タロウ" />
          </div>
          <div>
            <Label htmlFor="mr-phone">電話番号</Label>
            <Input id="mr-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="09012345678" />
          </div>
          <div>
            <Label htmlFor="mr-email">メール（任意）</Label>
            <Input id="mr-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="mr-note">要望メモ</Label>
            <Textarea id="mr-note" value={form.note} onChange={(e) => set('note', e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !form.storeId || !form.name.trim() || form.phone.trim().length < 10}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            登録する
          </Button>
        </div>
      </Dialog>
    </>
  );
}
