'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Minus, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { createManualReservation } from '@/app/app/reservations/actions';
import { handyReservationsHref, isIsoDate } from '@/lib/handy-reservations';

export interface HandyReservationOption {
  value: string;
  label: string;
}

/**
 * ハンディで予約を追加する（2026-10-15 Ronnie「予約の追加もハンディでできるように」）。
 * レジの予約台帳の「電話予約を登録」と同じ登録（createManualReservation）。項目もそれに合わせる：
 * 来店日・時間・大人・子ども・お名前・電話番号（必須）・予約経路・コース・ご要望
 */
export function HandyReservationForm({
  storeId,
  date,
  today,
  sources,
  courses,
}: {
  storeId: string;
  date: string;
  today: string;
  sources: HandyReservationOption[];
  courses: HandyReservationOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    date,
    time: '18:00',
    adults: 2,
    children: 0,
    name: '',
    phone: '',
    sourceCode: sources.some((s) => s.value === 'phone') ? 'phone' : (sources[0]?.value ?? 'phone'),
    courseId: '',
    note: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const phoneDigits = form.phone.replace(/\D/g, '');
  const ready =
    isIsoDate(form.date) && /^\d{2}:\d{2}$/.test(form.time) && form.name.trim().length > 0 && phoneDigits.length >= 10 && form.adults + form.children >= 1;

  const submit = () => {
    if (!ready || pending) return;
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
        });
        toast('予約を追加しました');
        router.push(handyReservationsHref(form.date, today));
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '予約を追加できませんでした', 'error');
      }
    });
  };

  const field = 'h-12 w-full rounded-[9px] border border-[#e3dbf1] bg-white px-3 text-base text-[#2a2138] outline-none focus:border-[#7b3fe4]';
  const label = 'mb-1 block text-[12px] font-bold text-[#5e5470]';

  return (
    <form
      className="space-y-3.5 px-3.5 pt-3 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label htmlFor="hr-date" className={label}>
            来店日
          </label>
          <input id="hr-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={field} required />
        </div>
        <div>
          <label htmlFor="hr-time" className={label}>
            時間
          </label>
          <input
            id="hr-time"
            type="time"
            step={900}
            value={form.time}
            onChange={(e) => set('time', e.target.value)}
            className={field}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Counter label="大人" value={form.adults} min={0} onChange={(v) => set('adults', v)} />
        <Counter label="子ども" value={form.children} min={0} onChange={(v) => set('children', v)} />
      </div>

      <div>
        <label htmlFor="hr-name" className={label}>
          お名前 <span className="text-[#b3341f]">*</span>
        </label>
        <input
          id="hr-name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="山田 太郎"
          autoComplete="off"
          className={field}
          required
        />
      </div>

      <div>
        <label htmlFor="hr-phone" className={label}>
          電話番号 <span className="text-[#b3341f]">*</span>
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
        {form.phone.length > 0 && phoneDigits.length < 10 && (
          <p className="mt-1 text-[11px] text-[#b3341f]">電話番号は10桁以上で入れてください</p>
        )}
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

      <div>
        <label htmlFor="hr-note" className={label}>
          ご要望・メモ
        </label>
        <textarea
          id="hr-note"
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
          rows={3}
          placeholder="アレルギー・記念日など"
          className="w-full rounded-[9px] border border-[#e3dbf1] bg-white px-3 py-2.5 text-base text-[#2a2138] outline-none focus:border-[#7b3fe4]"
        />
      </div>

      <p className="text-[10.5px] leading-relaxed text-[#7a7090]">
        席の割り当て・変更・来店処理はレジ（管理画面）の予約台帳で行います。
      </p>

      <button
        type="submit"
        disabled={!ready || pending}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[9px] bg-[#7b3fe4] px-4 text-base font-bold text-white shadow-[0_3px_10px_#7b3fe41a] active:bg-[#6630c7] disabled:opacity-40"
      >
        {pending && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
        予約を追加する
        <span className="text-[11px] font-semibold text-white/75">Add</span>
      </button>
    </form>
  );
}

function Counter({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (v: number) => void }) {
  const btn =
    'flex h-12 w-12 shrink-0 items-center justify-center rounded-[9px] border border-[#e3dbf1] bg-white text-[#4f3868] active:bg-[#efe8fa] disabled:opacity-40';
  return (
    <div>
      <span className="mb-1 block text-[12px] font-bold text-[#5e5470]">{label}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label={`${label}を減らす`} className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus className="h-4 w-4" strokeWidth={2.6} aria-hidden />
        </button>
        <span className={cn('flex-1 text-center text-xl font-bold tabular-nums text-[#2a2138]')}>{value}</span>
        <button type="button" aria-label={`${label}を増やす`} className={btn} disabled={value >= 99} onClick={() => onChange(Math.min(99, value + 1))}>
          <Plus className="h-4 w-4" strokeWidth={2.6} aria-hidden />
        </button>
      </div>
    </div>
  );
}
