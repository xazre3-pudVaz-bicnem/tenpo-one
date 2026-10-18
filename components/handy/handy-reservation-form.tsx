'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { createManualReservation } from '@/app/app/reservations/actions';
import { handyDayLabel, handyReservationsHref, isIsoDate } from '@/lib/handy-reservations';
import { entryStatusToDb, normalizeTags, stayLabel, type EntryStatus } from '@/lib/reservation-entry';
import type { ReservationEntryData } from '@/lib/reservation-entry-server';
import { PartyCountField } from '@/components/reservations/entry/party-count-field';
import { KeywordPicker, StatusPicker, StayControl, TableSuggest } from '@/components/reservations/entry/entry-parts';
import { useReservationEntryData } from '@/components/reservations/entry/use-entry-data';

export interface HandyReservationOption {
  value: string;
  label: string;
}

/**
 * ハンディで予約を追加する（2026-10-15 Ronnie「予約の追加もハンディでできるように」）。
 * 2026-10-19 Ronnie「レストランボードのように」→ 2ステップ：
 *   1. 来店日・時間・人数（テンキー）→ 予約可能なテーブル（その時間に空いている卓・人数にピッタリの卓。30分後も）
 *   2. お名前・電話番号・予約経路・コース・キーワード・確保時間・予約ステータス・担当者・ご要望
 *   下に いま入れた内容（日時・人数・テーブル・お名前・電話番号）と「この内容で登録する」
 * 登録はレジの予約台帳の「電話予約を登録」と同じ（createManualReservation・予約の登録の権限）。
 */
export function HandyReservationForm({
  storeId,
  date,
  today,
  sources,
  courses,
  clerk,
  initialEntry,
}: {
  storeId: string;
  date: string;
  today: string;
  sources: HandyReservationOption[];
  courses: HandyReservationOption[];
  /** いまハンディを使っている担当者（担当者の最初の値） */
  clerk: { id: string; name: string } | null;
  /** サーバーで読んだその日の卓・予約など（最初の表示を速くする） */
  initialEntry?: ReservationEntryData;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [nowMs] = useState(() => Date.now());
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({
    date,
    time: '18:00',
    adults: 2,
    children: 0,
    tableIds: [] as string[],
    name: '',
    phone: '',
    sourceCode: sources.some((s) => s.value === 'phone') ? 'phone' : (sources[0]?.value ?? 'phone'),
    courseId: '',
    tags: [] as string[],
    stayCustom: null as number | null,
    status: 'confirmed' as EntryStatus,
    clerkId: clerk?.id ?? '',
    note: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const { data, loading } = useReservationEntryData(storeId, form.date, initialEntry ? { date, data: initialEntry } : undefined);
  const defaultStay = (form.courseId && data.courseDurations[form.courseId]) || data.defaultStay;
  const stay = form.stayCustom ?? defaultStay;
  const party = form.adults + form.children;

  const phoneDigits = form.phone.replace(/\D/g, '');
  const step1Ready = isIsoDate(form.date) && /^\d{2}:\d{2}$/.test(form.time) && party >= 1;
  const ready = step1Ready && form.name.trim().length > 0 && phoneDigits.length >= 10;
  const pickedTables = data.tables.filter((t) => form.tableIds.includes(t.id));

  const submit = () => {
    if (!ready || pending) return;
    const { status, tag } = entryStatusToDb(form.status);
    startTransition(async () => {
      try {
        await createManualReservation({
          storeId,
          date: form.date,
          time: form.time,
          adults: form.adults,
          children: form.children,
          name: form.name.trim(),
          phone: form.phone.trim(),
          note: form.note.trim() || undefined,
          sourceCode: form.sourceCode || undefined,
          courseId: form.courseId || null,
          tableIds: form.tableIds,
          stayMinutes: stay,
          status,
          tags: normalizeTags([...(tag ? [tag] : []), ...form.tags]),
          clerkId: form.clerkId || null,
        });
        toast('予約を追加しました');
        router.push(handyReservationsHref(form.date, today));
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '予約を追加できませんでした', 'error');
      }
    });
  };

  // iPhone の日付・時間の欄が横にはみ出さないように（2026-10-19 Ronnie「画面が横に動く」）
  const field =
    'block h-12 w-full min-w-0 appearance-none rounded-[9px] border border-[#e5dfd5] bg-white px-3 text-base text-[#292725] outline-none focus:border-[#bc5940]';
  const label = 'mb-1 block text-[12px] font-bold text-[#5c5650]';

  return (
    <form
      className="flex min-h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 1) {
          if (step1Ready) setStep(2);
        } else submit();
      }}
    >
      <div className="flex-1 space-y-4 px-3.5 pt-3 pb-4">
        {step === 1 ? (
          <>
            <p className="text-[15px] font-bold text-[#45403b]">日時・人数を入れて、テーブルを選んでください</p>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
              <div className="min-w-0">
                <label htmlFor="hr-date" className={label}>
                  来店日 <span className="text-[#c62828]">*</span>
                </label>
                <input
                  id="hr-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value, tableIds: [] }))}
                  className={field}
                  required
                />
              </div>
              <div className="min-w-0">
                <label htmlFor="hr-time" className={label}>
                  時間 <span className="text-[#c62828]">*</span>
                </label>
                <input
                  id="hr-time"
                  type="time"
                  step={300}
                  value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value, tableIds: [] }))}
                  className={field}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
              <PartyCountField label="大人" value={form.adults} onChange={(v) => set('adults', v)} />
              <PartyCountField label="子ども" value={form.children} onChange={(v) => set('children', v)} />
            </div>
            <TableSuggest
              tables={data.tables}
              booked={data.booked}
              date={form.date}
              time={form.time}
              stayMinutes={stay}
              party={party}
              today={today}
              nowMs={nowMs}
              selected={form.tableIds}
              loading={loading}
              onSelect={(ids, time) => setForm((f) => ({ ...f, tableIds: ids, time }))}
            />
          </>
        ) : (
          <>
            <div>
              <label htmlFor="hr-name" className={label}>
                お名前 <span className="text-[#c62828]">*</span>
              </label>
              <input id="hr-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="山田 太郎" autoComplete="off" className={field} required />
            </div>
            <div>
              <label htmlFor="hr-phone" className={label}>
                電話番号 <span className="text-[#c62828]">*</span>
              </label>
              <input
                id="hr-phone"
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="09012345678"
                autoComplete="off"
                className={field}
                required
              />
              {form.phone.length > 0 && phoneDigits.length < 10 && <p className="mt-1 text-[11px] text-[#c62828]">電話番号は10桁以上で入れてください</p>}
            </div>
            {courses.length > 0 && (
              <div>
                <label htmlFor="hr-course" className={label}>
                  コース
                </label>
                <select id="hr-course" value={form.courseId} onChange={(e) => set('courseId', e.target.value)} className={field}>
                  <option value="">なし（席のみ）</option>
                  {courses.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <KeywordPicker keywords={data.keywords} selected={form.tags} onChange={(v) => set('tags', v)} />
            <StayControl minutes={stay} defaultMinutes={defaultStay} onChange={(m) => set('stayCustom', m === defaultStay ? null : m)} />
            <StatusPicker value={form.status} onChange={(v) => set('status', v)} />
            <div>
              <label htmlFor="hr-note" className={label}>
                ご要望・メモ
              </label>
              <textarea
                id="hr-note"
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="アレルギー・記念日など"
                className="block w-full rounded-[9px] border border-[#e5dfd5] bg-white px-3 py-2.5 text-base text-[#292725] outline-none focus:border-[#bc5940]"
              />
              <p className="mt-0.5 text-right text-[10.5px] text-[#9c948a]">残り {1000 - form.note.length} 文字</p>
            </div>
            {sources.length > 0 && (
              <div>
                <label htmlFor="hr-source" className={label}>
                  予約経路
                </label>
                <select id="hr-source" value={form.sourceCode} onChange={(e) => set('sourceCode', e.target.value)} className={field}>
                  {sources.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {data.clerks.length > 0 && (
              <div>
                <label htmlFor="hr-clerk" className={label}>
                  担当者
                </label>
                <select id="hr-clerk" value={form.clerkId} onChange={(e) => set('clerkId', e.target.value)} className={field}>
                  <option value="">選ばない</option>
                  {data.clerks.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {/* 下：いま入れた内容と、次へ・登録（レストランボードと同じ） */}
      <div className="sticky bottom-0 border-t border-[#e5dfd5] bg-white/95 px-3.5 pt-2.5 pb-3 backdrop-blur">
        <ul className="mb-2 space-y-0.5 text-[13px]">
          <Summary on={step1Ready}>
            {handyDayLabel(form.date)} {form.time}　{party}名{stay ? `（${stayLabel(stay)}）` : ''}
          </Summary>
          <Summary on={pickedTables.length > 0}>
            {pickedTables.length > 0 ? pickedTables.map((t) => t.name).join(' + ') : 'テーブル未定'}
          </Summary>
          {step === 2 && (
            <li className="grid grid-cols-2 gap-2">
              <Summary on={form.name.trim().length > 0} as="span">
                {form.name.trim() || 'お名前'}
              </Summary>
              <Summary on={phoneDigits.length >= 10} as="span">
                {form.phone.trim() || '電話番号'}
              </Summary>
            </li>
          )}
        </ul>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
          <button
            type="button"
            onClick={() => (step === 2 ? setStep(1) : router.push(handyReservationsHref(form.date, today)))}
            className="flex min-h-[48px] items-center justify-center gap-1 rounded-[9px] border border-[#e5dfd5] bg-white text-[14px] font-bold text-[#5c5650] active:bg-[#f6ebe3]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {step === 2 ? '前に戻る' : 'やめる'}
          </button>
          <button
            type="submit"
            disabled={step === 1 ? !step1Ready : !ready || pending}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-[9px] bg-[#bc5940] px-3 text-[15px] font-bold text-white shadow-[0_3px_10px_#bc59401a] active:bg-[#9f4630] disabled:opacity-40"
          >
            {pending && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
            {step === 1 ? '詳細を入力する' : 'この内容で登録する'}
          </button>
        </div>
      </div>
    </form>
  );
}

function Summary({ on, children, as = 'li' }: { on: boolean; children: React.ReactNode; as?: 'li' | 'span' }) {
  const Tag = as;
  return (
    <Tag className={cn('flex min-w-0 items-center gap-1.5 font-bold', on ? 'text-[#292725]' : 'text-[#c9bfb3]')}>
      <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', on ? 'bg-[#bc5940]' : 'bg-[#e5dfd5]')} />
      <span className="truncate tabular-nums">{children}</span>
    </Tag>
  );
}
