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
    expect(page).toContain('<HandyReservationDateBar date={date} today={today} />');
    // ＋予約登録は上のバーの右・更新の横（2026-10-19 Ronnie「予約の追加は上に。すっきりと」）
    expect(page).toContain("{can(ctx.role, 'reservations.write') && <HandyAddReservationButton date={date} />}");
    expect(page).toContain('<HandyRefreshButton labeled />');
    expect(page).not.toContain('HandyBookingShareButton');
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

/** 2026-10-15 Ronnie「予約一覧をこの形に」（予約アプリの予約リストと同じ並び） */
describe('ハンディの予約一覧の形', () => {
  it('左：状態・お名前・電話 ／ 右：時間〜人数・席・コース・経路・要望・メモ・キャンセルを除く', () => {
    const list = read('components/handy/handy-reservation-list.tsx');
    expect(list).toContain('キャンセルを除く');
    expect(list).toContain('{r.time}〜 {r.partySize}名');
    expect(list).toContain('href={`tel:${r.phone}`}');
    expect(list).toContain('要望：{request ||');
    expect(list).toContain('メモ：{r.memo ||');
    const page = read('app/handy/reservations/page.tsx');
    expect(page).toContain('guest_phone, party_size');
    expect(page).toContain('course:menu_items(name)');
    expect(page).toContain('courseName: one(r.course)?.name ?? null,');
  });
});

/** 2026-10-18 Ronnie「Handy bata booking garda table sentaku pani garna milne banau」 */
describe('ハンディの予約：テーブルを選ぶ（2026-10-19 Ronnie「レストランボードのように空いている卓・ピッタリ」）', () => {
  it('予約可能なテーブル（その時間に空いている卓・人数にピッタリ）から選び、レジと同じ createManualReservation の tableIds で登録', () => {
    const form = read('components/handy/handy-reservation-form.tsx');
    expect(form).toContain('<TableSuggest');
    expect(form).toContain('tableIds: form.tableIds,');
    expect(form).toContain('<PartyCountField label="大人"');
    expect(form).toContain('<KeywordPicker');
    expect(form).toContain('<StayControl');
    expect(form).toContain('<StatusPicker');
    expect(form).toContain("step === 1 ? '詳細を入力する' : 'この内容で登録する'");
    // 他店の卓を入れない検証は登録側（レジと同じ）
    expect(read('app/app/reservations/actions.ts')).toContain("throw new Error('指定されたテーブルが正しくありません')");
  });

  it('卓・その日の予約はこの店の有効な卓（テーブル一覧と同じ並び・フロアつき）', () => {
    const page = read('app/handy/reservations/new/page.tsx');
    expect(page).toContain('loadReservationEntryData(supabase, store.id, date)');
    const loader = read('lib/reservation-entry-server.ts');
    expect(loader).toContain(".from('restaurant_tables')");
    expect(loader).toContain(".eq('store_id', storeId)");
    expect(loader).toContain(".eq('status', 'active')");
    expect(loader).toContain('floorName: floorName.get(');
  });
});
