import { describe, it, expect } from 'vitest';
import {
  tableChoices,
  tableCombos,
  snugSurplus,
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
    expect(r[0].table.id).toBe('T4a'); // 2名席が埋まっているので4名席がいちばん合う（ただし2名に4名席はピッタリではない）
    expect(r[0].best).toBe(false);
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

describe('予約登録：人数に合う席・つなげて使えるテーブル（2026-10-19 Ronnie）', () => {
  const six = (n: number, floorName: string | null = '3F') => T(`T-${n}`, 1, 6, { name: `T-${n}`, floorName });
  const base = { booked: [], date: '2026-10-20', time: '18:00', stayMinutes: 120, today: '2026-10-19', nowMs: Date.parse('2026-10-19T12:00:00+09:00') };

  it('ピッタリの余りは席数の1/3まで（6名席は4〜6名、4名席は3〜4名、2名席は1〜2名）', () => {
    expect(snugSurplus(6)).toBe(2);
    expect(snugSurplus(4)).toBe(1);
    expect(snugSurplus(2)).toBe(1);
  });

  it('2名に6名席しかない：全部にピッタリとは出さない（人数に合う席として並べるだけ）', () => {
    const tables = [six(1), six(2), six(3)];
    const r = tableChoices({ ...base, tables, party: 2 });
    expect(r.every((c) => c.free && c.fit === 'ok' && !c.best)).toBe(true);
    expect(tableChoices({ ...base, tables, party: 5 }).every((c) => c.best)).toBe(true);
  });

  it('10名：1卓に入らない → となりどうしの2卓（T-1 + T-2・12名）を先に', () => {
    const tables = [six(1), six(2), six(3), six(4)];
    const choices = tableChoices({ ...base, tables, party: 10 });
    expect(choices.every((c) => c.fit === 'small')).toBe(true);
    const combos = tableCombos({ tables, choices, party: 10 });
    expect(combos[0]).toMatchObject({ ids: ['T-1', 'T-2'], seats: 12, adjacent: true, floorName: '3F' });
    expect(combos.slice(0, 3).every((c) => c.adjacent)).toBe(true);
  });

  it('予約の入っている卓は使わない（T-2 が埋まっていれば T-3 + T-4 がとなりどうし）', () => {
    const tables = [six(1), six(2), six(3), six(4)];
    const choices = tableChoices({
      ...base,
      tables,
      party: 10,
      booked: [{ start: '2026-10-20T18:00:00+09:00', end: '2026-10-20T20:00:00+09:00', tableIds: ['T-2'] }],
    });
    const combos = tableCombos({ tables, choices, party: 10 });
    expect(combos.some((c) => c.ids.includes('T-2'))).toBe(false);
    expect(combos[0]).toMatchObject({ ids: ['T-3', 'T-4'], adjacent: true });
  });

  it('14名：2卓では足りない → となりどうしの3卓。ちがうフロアの卓はつなげない', () => {
    const tables = [six(1), six(2), six(3), six(4, '2F'), six(5, '2F')];
    const choices = tableChoices({ ...base, tables, party: 14 });
    const combos = tableCombos({ tables, choices, party: 14 });
    expect(combos[0]).toMatchObject({ ids: ['T-1', 'T-2', 'T-3'], seats: 18 });
    expect(combos.every((c) => new Set(c.tables.map((t) => t.floorName)).size === 1)).toBe(true);
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

describe('予約の時間は5分ごと・選ぶ欄に▼（2026-10-19 Ronnie）', () => {
  it('分は 00・05・…・55 の12個。5分ごとでない今の値は消さずに入れる', async () => {
    const { minuteOptions, HOUR_OPTIONS } = await import('@/components/reservations/entry/entry-select');
    expect(minuteOptions()).toEqual(['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']);
    expect(minuteOptions('21')).toContain('21');
    expect(HOUR_OPTIONS).toHaveLength(24);
  });

  it('ハンディ・レジ・予約の変更・空席検索の時間は TimeSelect（iPhone の1分ごとの時刻欄は使わない）', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
    for (const f of [
      'components/handy/handy-reservation-form.tsx',
      'components/reservations/manual-reservation-dialog.tsx',
      'components/reservations/reservation-sheet.tsx',
      'components/reservations/find-seats-dialog.tsx',
    ]) {
      const src = read(f);
      expect(src).toContain('<TimeSelect');
      expect(src).not.toContain('type="time"');
    }
    const handy = read('components/handy/handy-reservation-form.tsx');
    expect(handy).toContain('<SelectField id="hr-course"');
    expect(handy).toContain('<SelectField id="hr-source"');
    expect(handy).toContain('<SelectField id="hr-clerk"');
  });
});

describe('予約可能なテーブルは横にスライド（2026-10-19 Ronnie「全部並べると長い。スライドに」）', () => {
  it('卓・つなげる組み合わせ・ほかのテーブルは Slider（横スクロール・スナップ）に並べる', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'components/reservations/entry/entry-parts.tsx'), 'utf8');
    expect(src).toContain('overflow-x-auto');
    expect(src).toContain('snap-x snap-mandatory');
    expect(src).toContain('<Slider count={slot.fits.length}>');
    expect(src).toContain('<Slider count={slot.combos.length}>');
    expect(src).toContain('横にスライド');
    // 組み合わせの札に「つなげる」とは書かない（2026-10-19 Ronnie）
    expect(src).not.toContain("'となりをつなげる'");
    expect(src).not.toContain('つなげて使えるテーブル：');
    expect(src).not.toContain('grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5');
  });
});
