import { describe, expect, it } from 'vitest';
import { bookingLinkWithSrc, buildReservationsIcs, icalFeedUrl, reservationBookSettingsFrom, sourceCodeFromSrc } from '@/lib/reservation-book';

describe('予約台帳設定（SNS・Google 連携。2026-09-28 Ronnie）', () => {
  it('?src= → 予約経路', () => {
    expect(sourceCodeFromSrc('instagram')).toBe('instagram');
    expect(sourceCodeFromSrc('Google')).toBe('google');
    expect(sourceCodeFromSrc('junk')).toBe('web');
    expect(sourceCodeFromSrc(null)).toBe('web');
  });

  it('経路付きリンク', () => {
    expect(bookingLinkWithSrc('https://www.tenpo-one.com/book/fogo', 'line')).toBe('https://www.tenpo-one.com/book/fogo?src=line');
    expect(bookingLinkWithSrc('https://x/book/a?lang=en', 'google')).toBe('https://x/book/a?lang=en&src=google');
    expect(icalFeedUrl('https://www.tenpo-one.com', 'abc')).toBe('https://www.tenpo-one.com/api/ical/reservations/abc.ics');
  });

  it('設定の読み取り', () => {
    expect(reservationBookSettingsFrom(null)).toEqual({ icalToken: null, sns: { instagram: undefined, line: undefined, facebook: undefined, x: undefined } });
    expect(reservationBookSettingsFrom({ reservationBook: { icalToken: 't', sns: { instagram: 'https://instagram.com/a' } } }).sns.instagram).toBe('https://instagram.com/a');
  });

  it('iCal を作る（Google カレンダーで購読できる形）', () => {
    const ics = buildReservationsIcs(
      'FULLMOoN 新宿',
      [
        { id: 'r1', code: 'AB12-CD34', guestName: '山田 太郎', partySize: 4, startAt: '2026-10-03T10:00:00.000Z', endAt: '2026-10-03T12:00:00.000Z', status: 'confirmed', tableNames: ['T403'], sourceName: '食べログ', note: '窓側希望' },
        { id: 'r2', code: 'EF56-GH78', guestName: '佐藤', partySize: 2, startAt: '2026-10-04T09:00:00.000Z', endAt: '2026-10-04T11:00:00.000Z', status: 'cancelled' },
      ],
      new Date('2026-09-28T00:00:00Z')
    );
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('X-WR-CALNAME:FULLMOoN 新宿 ご予約');
    expect(ics).toContain('UID:tenpo-one-reservation-r1');
    expect(ics).toContain('DTSTART:20261003T100000Z');
    expect(ics).toContain('SUMMARY:山田 太郎 様 4名（T403）');
    expect(ics).toContain('経路: 食べログ');
    expect(ics).toContain('SUMMARY:【取消】佐藤 様 2名');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l, 'utf8') <= 76)).toBe(true);
  });
});
