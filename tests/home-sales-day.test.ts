import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mdWeekdayLabel, salesDayView, salesDisplayDate, shiftBusinessDate } from '@/lib/register-day';

const read = (p: string) => readFileSync(p, 'utf8');

/** 2026-10-22 Ronnie「ホームの本日の売上・達成率を、レジの営業日で出す」 */
describe('ホームの売上を出す営業日（salesDisplayDate）', () => {
  it('開いているレジがあればその営業日（深夜に前の営業日を続けているときも）', () => {
    expect(salesDisplayDate({ openDates: ['2026-10-22'], lastClosedDate: '2026-10-21', today: '2026-10-23' })).toEqual({
      date: '2026-10-22',
      closed: false,
    });
  });
  it('開いているレジがいくつかあれば新しいほう', () => {
    expect(salesDisplayDate({ openDates: ['2026-10-23', '2026-10-22'], lastClosedDate: null, today: '2026-10-23' }).date).toBe('2026-10-23');
  });
  it('開いているレジが無ければ最後に閉めたレジの営業日（次の開局まで）', () => {
    expect(salesDisplayDate({ openDates: [], lastClosedDate: '2026-10-22', today: '2026-10-23' })).toEqual({
      date: '2026-10-22',
      closed: true,
    });
  });
  it('レジが1つも無ければ今日', () => {
    expect(salesDisplayDate({ openDates: [], lastClosedDate: null, today: '2026-10-23' })).toEqual({ date: '2026-10-23', closed: false });
  });
});

describe('売上の見出し（salesDayView）', () => {
  it('今日なら今まで通り（見出し・注記なし、「本日」）', () => {
    expect(salesDayView({ date: '2026-10-23', today: '2026-10-23', closed: true })).toEqual({
      date: '2026-10-23',
      isToday: true,
      dayLabel: '本日',
      heading: null,
      note: null,
    });
  });
  it('レジクローズ後で今日でなければ「10/22（木）の売上」＋「レジクローズ済み・次の開局まで表示」', () => {
    expect(salesDayView({ date: '2026-10-22', today: '2026-10-23', closed: true })).toEqual({
      date: '2026-10-22',
      isToday: false,
      dayLabel: '10/22（木）',
      heading: '10/22（木）の売上',
      note: 'レジクローズ済み・次の開局まで表示',
    });
  });
  it('前の営業日のレジがまだ開いているときは日付の見出しだけ（閉めていないので注記は出さない）', () => {
    const v = salesDayView({ date: '2026-10-22', today: '2026-10-23', closed: false });
    expect(v.heading).toBe('10/22（木）の売上');
    expect(v.note).toBeNull();
  });
  it('日付と曜日・前日（月・年またぎ）', () => {
    expect(mdWeekdayLabel('2026-10-22')).toBe('10/22（木）');
    expect(mdWeekdayLabel('2026-11-01')).toBe('11/1（日）');
    expect(shiftBusinessDate('2026-10-22', -1)).toBe('2026-10-21');
    expect(shiftBusinessDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftBusinessDate('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftBusinessDate('2026-10-22', -7)).toBe('2026-10-15');
  });
});

describe('ホームの画面がレジの営業日を使う', () => {
  it('店舗のホーム（iPhone/PC・iPad）は loadSalesDisplayDay の営業日で loadHomeData を読む。全店舗は今まで通り today', () => {
    const page = read('app/app/dashboard/page.tsx');
    expect(page).toContain('const d = await loadSalesDisplayDay(supabase, storeId, today);');
    expect(page).toContain('homeDataArgs(ctx, supabase, [store], false, today, metricsOpts, sales.day.date)');
    expect(page).toContain('homeDataArgs(ctx, supabase, [store], false, today, metricsOpts, sd.day.date)');
    expect(page).toContain('loadHomeData(homeDataArgs(ctx, supabase, stores, true, today, metricsOpts)),');
    // レジクローズ後の「時点」は締めた時刻
    expect(page).toContain('day.note && d.closedAt ? nowStampJst(new Date(d.closedAt)) : asOf');
    expect(page).toContain('day={sales.day}');
  });
  it('売上・前日比・予算（月・日別）・リピーター率はその営業日、お知らせ・予約は今日', () => {
    const data = read('components/dashboard/home-data.ts');
    expect(data).toContain('const salesPrevDate = shiftBusinessDate(salesDate, -1);');
    expect(data).toContain(".eq('business_date', salesDate)\n      .in('status', SETTLED_ORDER_STATUSES),");
    expect(data).toContain(".eq('business_date', salesPrevDate)");
    expect(data).toContain(".eq('business_date', salesDate).eq('status', 'open')");
    expect(data).toContain('const monthFirst = `${salesDate.slice(0, 7)}-01`;');
    expect(data).toContain('dailyBudgetFromMonthly(monthly, salesDate)');
    expect(data).toContain(".eq('reserved_date', today)");
    expect(data).not.toContain(".eq('business_date', today)");
  });
  it('見出し・注記・達成率のラベル（BudgetCard・HomeKpis・RegiSales）', () => {
    const budget = read('components/dashboard/budget-card.tsx');
    expect(budget).toContain("{day?.heading ?? '実績売上高'}");
    expect(budget).toContain('{day?.note && ');
    expect(budget).toContain('{dayLabel}の達成率');
    expect(budget).toContain('budget != null && (day?.isToday ?? true)');
    const kpis = read('components/dashboard/home-kpis.tsx');
    expect(kpis).toContain('label={`${dayLabel}のリピーター率`}');
    const regi = read('components/dashboard/regi-sales.tsx');
    expect(regi).toContain("<Label ja={day?.heading ?? '実績売上高'} en=\"Sales\" />");
    expect(regi).toContain('{day?.note && ');
    expect(regi).toContain('{dayLabel}の達成率');
  });
});
