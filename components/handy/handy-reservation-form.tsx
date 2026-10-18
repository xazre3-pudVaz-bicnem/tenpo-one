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

/** 予約で選べる卓（テーブル一覧と同じ並び） */
export interface HandyReservationTable {
  id: string;
  name: string;
  capacity: number;
  /** フロア（3F・4F など）。決めていない卓は null */
  floorName: string | null;
}

/**
 * ハンディで予約を追加する（2026-10-15 Ronnie「予約の追加もハンディでできるように」）。
 * レジの予約台帳の「電話予約を登録」と同じ登録（createManualReservation）。項目もそれに合わせる：
 * 来店日・時間・大人・子ども・お名前・電話番号（必須）・予約経路・コース・テーブル・ご要望
 * テーブルは任意・複数可（2026-10-18 Ronnie「Handy bata booking garda table sentaku pani garna milne banau」。
 * レジの「テーブル割当（任意・複数可）」と同じ）
 */
export function HandyReservationForm({
  storeId,
  date,
  today,
  sources,
  courses,
  tables = [],
}: {
  storeId: string;
  date: string;
  today: string;
  sources: HandyReservationOption[];
  courses: HandyReservationOption[];
  tables?: HandyReservationTable[];
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
    tableIds: [] as string[],
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
          tableIds: form.tableIds,
        });
        toast('予約を追加しました');
        router.push(handyReservationsHref(form.date, today));
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '予約を追加できませんでした', 'error');
      }
    });
  };

  const field = 'h-12 w-full rounded-[9px] border border-[#e5dfd5] bg-white px-3 text-base text-[#292725] outline-none focus:border-[#bc5940]';
  const label = 'mb-1 block text-[12px] font-bold text-[#5c5650]';

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
          お名前 <span className="text-[#c62828]">*</span>
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
        {form.phone.length > 0 && phoneDigits.length < 10 && (
          <p className="mt-1 text-[11px] text-[#c62828]">電話番号は10桁以上で入れてください</p>
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

      {tables.length > 0 && (
        <TablePicker
          tables={tables}
          selected={form.tableIds}
          onToggle={(id) =>
            set('tableIds', form.tableIds.includes(id) ? form.tableIds.filter((x) => x !== id) : [...form.tableIds, id])
          }
        />
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
          className="w-full rounded-[9px] border border-[#e5dfd5] bg-white px-3 py-2.5 text-base text-[#292725] outline-none focus:border-[#bc5940]"
        />
      </div>

      <p className="text-[10.5px] leading-relaxed text-[#766b62]">
        席の変更・来店処理はレジ（管理画面）の予約台帳で行います。
      </p>

      <button
        type="submit"
        disabled={!ready || pending}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[9px] bg-[#bc5940] px-4 text-base font-bold text-white shadow-[0_3px_10px_#bc59401a] active:bg-[#9f4630] disabled:opacity-40"
      >
        {pending && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
        予約を追加する
        <span className="text-[11px] font-semibold text-white/75">Add</span>
      </button>
    </form>
  );
}

/** テーブル（任意・複数可）。フロアが2つ以上あればフロアごとに分けて出す */
function TablePicker({
  tables,
  selected,
  onToggle,
}: {
  tables: HandyReservationTable[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const floors = [...new Set(tables.map((t) => t.floorName ?? ''))];
  const byFloor = floors.length > 1 ? floors.map((f) => ({ floor: f, list: tables.filter((t) => (t.floorName ?? '') === f) })) : [{ floor: '', list: tables }];
  const picked = tables.filter((t) => selected.includes(t.id));
  const seats = picked.reduce((sum, t) => sum + t.capacity, 0);
  return (
    <div>
      <span className="mb-1 block text-[12px] font-bold text-[#5c5650]">
        テーブル <span className="text-[10.5px] font-medium text-[#766b62]">（任意・複数可）</span>
      </span>
      <div className="space-y-2">
        {byFloor.map(({ floor, list }) => (
          <div key={floor || 'all'}>
            {floors.length > 1 && <p className="mb-1 text-[11px] font-bold text-[#766b62]">{floor || 'その他'}</p>}
            <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={floor ? `${floor} のテーブル` : 'テーブル'}>
              {list.map((t) => {
                const on = selected.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggle(t.id)}
                    className={cn(
                      'flex min-h-[48px] flex-col items-center justify-center rounded-[9px] border px-1 leading-tight',
                      on ? 'border-transparent bg-[#bc5940] text-white' : 'border-[#e5dfd5] bg-white text-[#45403b] active:bg-[#f6ebe3]'
                    )}
                  >
                    <span className="max-w-full truncate text-[14px] font-bold">{t.name}</span>
                    {t.capacity > 0 && (
                      <span className={cn('text-[9px]', on ? 'text-white/80' : 'text-[#766b62]')}>{t.capacity}名</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {picked.length > 0 && (
        <p className="mt-1.5 text-[12px] font-bold text-[#bc5940]">
          {picked.map((t) => t.name).join(' + ')}
          {seats > 0 && <span className="font-medium"> · {seats}名席</span>}
        </p>
      )}
    </div>
  );
}

function Counter({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (v: number) => void }) {
  const btn =
    'flex h-12 w-12 shrink-0 items-center justify-center rounded-[9px] border border-[#e5dfd5] bg-white text-[#45403b] active:bg-[#f6ebe3] disabled:opacity-40';
  return (
    <div>
      <span className="mb-1 block text-[12px] font-bold text-[#5c5650]">{label}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label={`${label}を減らす`} className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus className="h-4 w-4" strokeWidth={2.6} aria-hidden />
        </button>
        <span className={cn('flex-1 text-center text-xl font-bold tabular-nums text-[#292725]')}>{value}</span>
        <button type="button" aria-label={`${label}を増やす`} className={btn} disabled={value >= 99} onClick={() => onChange(Math.min(99, value + 1))}>
          <Plus className="h-4 w-4" strokeWidth={2.6} aria-hidden />
        </button>
      </div>
    </div>
  );
}
