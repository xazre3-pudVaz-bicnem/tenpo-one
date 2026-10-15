import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  handyDayLabel,
  handyEmptyText,
  handyNewReservationHref,
  handyReservationsHref,
  handyReservationsTitle,
  isIsoDate,
  parseHandyDate,
  shiftDate,
  weekdayOf,
} from '@/lib/handy-reservations';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** 2026-10-15 Ronnie「ハンディの予約でほかの日も見られるように。予約の追加もハンディで」 */
describe('ハンディの予約：ほかの日', () => {
  const today = '2026-10-15';

  it('?date= を読む（壊れていれば今日）', () => {
    expect(parseHandyDate('2026-10-20', today)).toBe('2026-10-20');
    expect(parseHandyDate(['2026-10-21', 'x'], today)).toBe('2026-10-21');
    expect(parseHandyDate('2026-02-30', today)).toBe(today);
    expect(parseHandyDate('abc', today)).toBe(today);
    expect(parseHandyDate(undefined, today)).toBe(today);
    expect(isIsoDate('2026-10-15')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });

  it('前の日・次の日（月・年をまたぐ）', () => {
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('見出し：今日・明日・昨日・それ以外は日付と曜日', () => {
    expect(weekdayOf('2026-10-15')).toBe('木');
    expect(handyDayLabel('2026-10-15')).toBe('10/15（木）');
    expect(handyReservationsTitle(today, today)).toBe('今日の予約');
    expect(handyReservationsTitle('2026-10-16', today)).toBe('明日の予約');
    expect(handyReservationsTitle('2026-10-14', today)).toBe('昨日の予約');
    expect(handyReservationsTitle('2026-10-20', today)).toBe('10/20（火）の予約');
    expect(handyEmptyText(today, today)).toBe('今日の予約はありません。');
    expect(handyEmptyText('2026-10-20', today)).toBe('10/20（火）の予約はありません。');
  });

  it('URL：今日は ?date なし。追加はその日付で開く', () => {
    expect(handyReservationsHref(today, today)).toBe('/handy/reservations');
    expect(handyReservationsHref('2026-10-20', today)).toBe('/handy/reservations?date=2026-10-20');
    expect(handyNewReservationHref('2026-10-20')).toBe('/handy/reservations/new?date=2026-10-20');
  });

  it('一覧はその日の予約を読む', () => {
    const page = read('app/handy/reservations/page.tsx');
    expect(page).toContain(".eq('reserved_date', date)");
    expect(page).toContain("<HandyReservationDateBar date={date} today={today} canAdd={can(ctx.role, 'reservations.write')} />");
  });
});

describe('ハンディの予約：追加', () => {
  it('レジの予約台帳の「電話予約を登録」と同じ登録・同じ権限', () => {
    const page = read('app/handy/reservations/new/page.tsx');
    expect(page).toContain("can(ctx.role, 'reservations.write')");
    const form = read('components/handy/handy-reservation-form.tsx');
    expect(form).toContain('await createManualReservation({');
    expect(form).toContain('phoneDigits.length >= 10');
    expect(read('app/app/reservations/actions.ts')).toContain("revalidatePath('/handy/reservations');");
  });
});
