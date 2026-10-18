import { describe, it, expect } from 'vitest';
import { parseVisitParams, googleCalendarUrl, icsText, googleMapsUrl } from '@/lib/booking-calendar';

/** 2026-10-19 Ronnie「QR から予約したあと、カレンダーに追加と Google マップへ」 */
describe('ご予約完了：カレンダーに追加・Googleマップ', () => {
  const v = {
    date: '2026-10-24',
    time: '19:30',
    minutes: 120,
    title: 'MEAT CROWN 新横浜 ご予約（4名）',
    location: '〒222-0033 神奈川県横浜市港北区新横浜3-17-15',
    details: '予約コード ABC123',
  };

  it('URL の値を確かめる（おかしい日時は出さない・滞在は既定120分）', () => {
    expect(parseVisitParams({ d: '2026-10-24', t: '19:30', m: '90', n: '4' })).toEqual({ date: '2026-10-24', time: '19:30', minutes: 90, party: 4 });
    expect(parseVisitParams({ d: '2026-10-24', t: '19:30' })).toEqual({ date: '2026-10-24', time: '19:30', minutes: 120, party: null });
    expect(parseVisitParams({ d: '2026-10-24', t: '25:00' })).toBeNull();
    expect(parseVisitParams({ d: '24/10/2026', t: '19:30' })).toBeNull();
    expect(parseVisitParams({})).toBeNull();
    expect(parseVisitParams({ d: '2026-10-24', t: '19:30', m: '99999' })?.minutes).toBe(120);
  });

  it('Google カレンダー：日本時間 19:30〜21:30 を UTC で（10:30Z〜12:30Z）', () => {
    const u = new URL(googleCalendarUrl(v));
    expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('dates')).toBe('20261024T103000Z/20261024T123000Z');
    expect(u.searchParams.get('text')).toBe(v.title);
    expect(u.searchParams.get('location')).toBe(v.location);
  });

  it('日をまたぐ予約（23:30 から 120分）', () => {
    const u = new URL(googleCalendarUrl({ ...v, time: '23:30' }));
    expect(u.searchParams.get('dates')).toBe('20261024T143000Z/20261024T163000Z');
  });

  it('.ics（iPhone・Outlook）', () => {
    const ics = icsText({ ...v, uid: 'ABC123@tenpo-one.com', now: new Date('2026-10-19T00:00:00Z') });
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('DTSTART:20261024T103000Z');
    expect(ics).toContain('DTEND:20261024T123000Z');
    expect(ics).toContain('SUMMARY:MEAT CROWN 新横浜 ご予約（4名）');
    expect(ics).toContain('UID:ABC123@tenpo-one.com');
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('Google マップ：店名＋住所で探す', () => {
    expect(googleMapsUrl('MEAT CROWN 新横浜', '神奈川県横浜市')).toBe(
      'https://www.google.com/maps/search/?api=1&query=MEAT%20CROWN%20%E6%96%B0%E6%A8%AA%E6%B5%9C%20%E7%A5%9E%E5%A5%88%E5%B7%9D%E7%9C%8C%E6%A8%AA%E6%B5%9C%E5%B8%82'
    );
    expect(googleMapsUrl('MEAT CROWN', null)).toBe('https://www.google.com/maps/search/?api=1&query=MEAT%20CROWN');
    expect(googleMapsUrl('A', '〒222-0033 神奈川県')).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('A 神奈川県')}`);
  });
});
