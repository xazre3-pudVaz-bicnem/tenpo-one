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
import { entryStatusToDb, normalizeTags, type EntryStatus } from '@/lib/reservation-entry';
import { PartyCountField } from './entry/party-count-field';
import { KeywordPicker, StatusPicker, StayControl, TableSuggest } from './entry/entry-parts';
import { useReservationEntryData } from './entry/use-entry-data';
import { TimeSelect } from './entry/entry-select';

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
  // 2026-10-19 Ronnie「レストランボードのように。ハンディだけでなくレジ・PC も」
  tags: [] as string[],
  stayCustom: null as number | null,
  status: 'confirmed' as EntryStatus,
  clerkId: '',
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
  /** 先に選んでおくテーブル（スケジュールの空きマスを押したとき） */
  tableIds?: string[];
}

export function ManualReservationDialog({
  stores,
  defaultStoreId,
  prefill,
  sources,
  courses,
  /** キャンセル待ちからの変換の場合に指定。登録成功時に waitlist_entries を converted にする */
  waitlistEntryId,
  triggerLabel = '電話予約を登録',
  triggerVariant = 'secondary',
  triggerSize = 'sm',
  triggerClassName,
  triggerContent,
  onCreated,
  defaultOpen = false,
  hideTrigger = false,
  onDialogClose,
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
  /** ボタンの見た目を上書き（店舗台帳の大きなタイルボタンなど） */
  triggerClassName?: string;
  /** ボタンの中身を上書き（未指定なら電話アイコン＋triggerLabel） */
  triggerContent?: React.ReactNode;
  onCreated?: () => void;
  /** 開いた状態で出す（スケジュールの空きマスから「新規予約」を押したとき） */
  defaultOpen?: boolean;
  /** ボタンを出さない（上の用途） */
  hideTrigger?: boolean;
  /** 閉じたときに呼ぶ（呼び出し側の状態を戻す） */
  onDialogClose?: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [pending, startTransition] = useTransition();
  const initialStoreId = prefill?.storeId ?? defaultStoreId ?? stores[0]?.id ?? '';
  const [form, setForm] = useState({ ...EMPTY, ...prefill, storeId: initialStoreId });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const [nowMs] = useState(() => Date.now());
  // 開いているときだけ、その日の卓・予約・キーワード・担当者を読む（予約可能なテーブル・ピッタリ）
  const { data: entry, loading: entryLoading } = useReservationEntryData(open ? form.storeId : '', form.date);
  const defaultStay = (form.courseId && entry.courseDurations[form.courseId]) || entry.defaultStay;
  const stay = form.stayCustom ?? defaultStay;
  const party = form.adults + form.children;

  const submit = () => {
    const { status, tag } = entryStatusToDb(form.status);
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
          stayMinutes: stay,
          status,
          tags: normalizeTags([...(tag ? [tag] : []), ...form.tags]),
          clerkId: form.clerkId || null,
          waitlistEntryId,
        });
        toast(waitlistEntryId ? '予約へ変換しました' : '電話予約を登録しました');
        setForm({ ...EMPTY, ...prefill, storeId: initialStoreId });
        setOpen(false);
        onCreated?.();
        onDialogClose?.();
      } catch (e) {
        toast(e instanceof Error ? e.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      {!hideTrigger && (
        <Button variant={triggerVariant} size={triggerSize} onClick={() => setOpen(true)} className={triggerClassName}>
          {triggerContent ?? (
            <>
              <Phone className="h-4 w-4" />
              {triggerLabel}
            </>
          )}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onDialogClose?.();
        }}
        title={waitlistEntryId ? '予約へ変換' : '電話予約の登録'}
        wide
      >
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
              <Input id="mr-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value, tableIds: [] }))} />
            </div>
            <div>
              <Label htmlFor="mr-time">時間</Label>
              {/* 時と分を別々に。分は5分ごと（2026-10-19 Ronnie「選べる時間の分は5分毎で」） */}
              <TimeSelect
                id="mr-time"
                value={form.time}
                onChange={(v) => setForm((f) => ({ ...f, time: v, tableIds: [] }))}
                className="ui-input h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-primary focus:outline-2 focus:outline-primary/30"
              />
            </div>
          </div>
          {/* 人数はテンキーでも入れられる（2026-10-19 Ronnie「150名でも＋を150回押さない」） */}
          <div className="grid grid-cols-2 gap-3">
            <PartyCountField label="大人" value={form.adults} onChange={(v) => set('adults', v)} />
            <PartyCountField label="子ども" value={form.children} onChange={(v) => set('children', v)} />
          </div>
          {/* 予約可能なテーブル（その時間に空いている卓・人数にピッタリの卓。30分後も） */}
          {entry.tables.length > 0 ? (
            <TableSuggest
              tables={entry.tables}
              booked={entry.booked}
              date={form.date}
              time={form.time}
              stayMinutes={stay}
              party={party}
              today={todayJst()}
              nowMs={nowMs}
              selected={form.tableIds}
              loading={entryLoading}
              onSelect={(ids, time) => setForm((f) => ({ ...f, tableIds: ids, time }))}
            />
          ) : (
            entryLoading && <p className="text-xs text-gray-500">テーブルを確認しています…</p>
          )}
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
          <KeywordPicker keywords={entry.keywords} selected={form.tags} onChange={(v) => set('tags', v)} />
          <StayControl minutes={stay} defaultMinutes={defaultStay} onChange={(m) => set('stayCustom', m === defaultStay ? null : m)} />
          <StatusPicker value={form.status} onChange={(v) => set('status', v)} />
          {entry.clerks.length > 0 && (
            <div>
              <Label htmlFor="mr-clerk">担当者</Label>
              <Select id="mr-clerk" value={form.clerkId} onChange={(e) => set('clerkId', e.target.value)}>
                <option value="">選ばない</option>
                {entry.clerks.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="mr-note">要望メモ</Label>
            <Textarea id="mr-note" value={form.note} onChange={(e) => set('note', e.target.value)} maxLength={1000} />
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
