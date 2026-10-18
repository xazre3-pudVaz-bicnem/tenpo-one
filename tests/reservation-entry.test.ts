import { describe, it, expect } from 'vitest';
import {
  tableChoices,
  addMinutesToTime,
  stayLabel,
  adjustStay,
  entryStatusToDb,
  reservationKeywordsFrom,
  normalizeTags,
  DEFAULT_RESERVATION_KEYWORDS,
  type EntryTable,
} from '@/lib/reservation-entry';

/** 2026-10-19 Ronnie「レストランボードのように：空いているテーブルと人数にピッタリのテーブル・キーワード・確保時間・ステータス」 */
const T = (id: string, min: number, max: number, extra: Partial<EntryTable> = {}): EntryTable => ({
  id,
  name: id,
  capacityMin: min,
  capacityMax: max,
  floorName: null,
  locked: false,
  inUse: false,
  ...extra,
});

describe('予約登録：空いているテーブルとピッタリ', () => {
  const tables = [T('T8', 1, 8), T('T4a', 1, 4), T('T2', 1, 2), T('T4b', 1, 4), T('T6', 3, 6)];
  const base = { tables, booked: [], date: '2026-10-20', time: '19:00', stayMinutes: 120, today: '2026-10-19', nowMs: Date.parse('2026-10-19T12:00:00+09:00') };

  it('4名：4名席がピッタリ（同じ大きさは両方）→ 6名 → 8名 → 2名（小さい）', () => {
    const r = tableChoices({ ...base, party: 4 });
    expect(r.map((c) => [c.table.id, c.fit, c.best])).toEqual([
      ['T4a', 'just', true],
      ['T4b', 'just', true],
      ['T6', 'ok', false],
      ['T8', 'ok', false],
      ['T2', 'small', false],
    ]);
  });

  it('時間が重なる予約の卓・ロック中の卓は空いていない（いちばん後ろ）', () => {
    const r = tableChoices({
      ...base,
      party: 2,
      tables: [...tables.slice(0, 4), T('T6', 3, 6, { locked: true })],
      booked: [{ start: '2026-10-20T18:00:00+09:00', end: '2026-10-20T20:00:00+09:00', tableIds: ['T2'] }],
    });
    const t2 = r.find((c) => c.table.id === 'T2')!;
    expect(t2.free).toBe(false);
    expect(t2.reason).toBe('予約あり');
    expect(r.find((c) => c.table.id === 'T6')!.reason).toBe('使用不可');
    expect(r[0].table.id).toBe('T4a'); // 2名席が埋まっているので4名席がピッタリ
    expect(r.slice(-2).every((c) => !c.free)).toBe(true);
  });

  it('終わった直後からなら空いている（21:00 までの予約 → 21:00 から）', () => {
    const r = tableChoices({
      ...base,
      time: '21:00',
      party: 2,
      booked: [{ start: '2026-10-20T19:00:00+09:00', end: '2026-10-20T21:00:00+09:00', tableIds: ['T2'] }],
    });
    expect(r[0].table.id).toBe('T2');
    expect(r[0].best).toBe(true);
  });

  it('今日・いま座っている卓は、すぐの時間なら「使用中」', () => {
    const now = Date.parse('2026-10-19T18:30:00+09:00');
    const r = tableChoices({ ...base, date: '2026-10-19', today: '2026-10-19', time: '19:00', nowMs: now, party: 2, tables: [T('T2', 1, 2, { inUse: true }), T('T4', 1, 4)] });
    expect(r.find((c) => c.table.id === 'T2')!.reason).toBe('使用中');
    expect(r[0].table.id).toBe('T4');
  });
});

describe('予約登録：時間・確保時間・ステータス・キーワード', () => {
  it('時間に分を足す・確保時間の表示と範囲', () => {
    expect(addMinutesToTime('19:00', 30)).toBe('19:30');
    expect(addMinutesToTime('23:45', 30)).toBe('23:59');
    expect(stayLabel(120)).toBe('2時間');
    expect(stayLabel(90)).toBe('1時間30分');
    expect(stayLabel(45)).toBe('45分');
    expect(adjustStay(20, -30)).toBe(15);
    expect(adjustStay(120, 5)).toBe(125);
  });
  it('要連絡は 仮予約＋キーワード「要連絡」', () => {
    expect(entryStatusToDb('confirmed')).toEqual({ status: 'confirmed', tag: null });
    expect(entryStatusToDb('pending')).toEqual({ status: 'pending', tag: null });
    expect(entryStatusToDb('needs_contact')).toEqual({ status: 'pending', tag: '要連絡' });
  });
  it('キーワード：店舗の設定が無ければ既定・空白と重複は除く', () => {
    expect(reservationKeywordsFrom(null)).toEqual([...DEFAULT_RESERVATION_KEYWORDS]);
    expect(reservationKeywordsFrom({ reservation_keywords: [' 個室 ', '個室', '', 3, '誕生日'] })).toEqual(['個室', '誕生日']);
    expect(normalizeTags([' 当日予約', '当日予約', ''])).toEqual(['当日予約']);
  });
});
