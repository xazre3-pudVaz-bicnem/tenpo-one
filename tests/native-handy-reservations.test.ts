import { describe, expect, it } from 'vitest';
import {
  handyMonthGrid,
  handyMonthRange,
  handyRsvStayMinutes,
  isHandyRsvOpen,
  NATIVE_HANDY_RSV_TYPES,
  parseHandyRsvMonth,
  parseHandyRsvTab,
  parseNativeHandyRsvAction,
  shiftHandyMonth,
} from '@/lib/native-handy-reservations';

const R = '11111111-1111-4111-8111-111111111111';
const T1 = '22222222-2222-4222-8222-222222222222';
const T2 = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';

// 2026-10-25 Ronnie「iPhone も native に」：ハンディの予約（一覧・受付管理・メッセージ・登録）
describe('native-handy-reservations: タブ・月・確保時間', () => {
  it('タブは Web の ?tab= と同じ（分からなければ予約一覧）', () => {
    expect(parseHandyRsvTab('inbox')).toBe('inbox');
    expect(parseHandyRsvTab('messages')).toBe('messages');
    expect(parseHandyRsvTab(['messages'])).toBe('messages');
    expect(parseHandyRsvTab('list')).toBe('list');
    expect(parseHandyRsvTab('x')).toBe('list');
    expect(parseHandyRsvTab(null)).toBe('list');
  });
  it('カレンダーの月（壊れていれば今日の月）・前後の月・月の初日と末日', () => {
    expect(parseHandyRsvMonth('2026-11', '2026-10-25')).toBe('2026-11');
    expect(parseHandyRsvMonth('2026-13', '2026-10-25')).toBe('2026-10');
    expect(parseHandyRsvMonth(undefined, '2026-10-25')).toBe('2026-10');
    expect(shiftHandyMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftHandyMonth('2026-01', -1)).toBe('2025-12');
    expect(handyMonthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(handyMonthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('確保時間（日をまたぐときは翌日・終わりが無ければ 2 時間）', () => {
    expect(handyRsvStayMinutes('18:00', '20:00')).toBe(120);
    expect(handyRsvStayMinutes('23:00', '01:30')).toBe(150);
    expect(handyRsvStayMinutes('18:00', null)).toBe(120);
  });
  it('来店・キャンセル・テーブル変更ができるのは来店前の予約だけ', () => {
    for (const s of ['pending', 'confirmed', 'waiting']) expect(isHandyRsvOpen(s)).toBe(true);
    for (const s of ['arrived', 'seated', 'billing', 'completed', 'cancelled', 'no_show']) expect(isHandyRsvOpen(s)).toBe(false);
  });
});

describe('native-handy-reservations: 操作', () => {
  it('操作の種類（registry に 1 行で入れる）', () => {
    expect(NATIVE_HANDY_RSV_TYPES).toEqual(['handyRsvArrive', 'handyRsvCancel', 'handyRsvTables', 'handyRsvInbox', 'handyRsvCreate']);
  });
  it('来店', () => {
    expect(parseNativeHandyRsvAction({ type: 'handyRsvArrive', reservationId: R })).toEqual({ ok: true, action: { type: 'handyRsvArrive', reservationId: R } });
    expect(parseNativeHandyRsvAction({ type: 'handyRsvArrive', reservationId: 'x' }).ok).toBe(false);
  });
  it('キャンセル：お客様・店舗（担当が必須）・無断', () => {
    expect(parseNativeHandyRsvAction({ type: 'handyRsvCancel', reservationId: R, kind: 'guest' })).toEqual({
      ok: true,
      action: { type: 'handyRsvCancel', reservationId: R, kind: 'guest', staffId: null },
    });
    expect(parseNativeHandyRsvAction({ type: 'handyRsvCancel', reservationId: R, kind: 'store', staffId: S })).toEqual({
      ok: true,
      action: { type: 'handyRsvCancel', reservationId: R, kind: 'store', staffId: S },
    });
    const noStaff = parseNativeHandyRsvAction({ type: 'handyRsvCancel', reservationId: R, kind: 'store' });
    expect(noStaff).toEqual({ ok: false, error: '店舗キャンセルは担当を選んでください' });
    // お客様・無断キャンセルに担当は付けない
    const ns = parseNativeHandyRsvAction({ type: 'handyRsvCancel', reservationId: R, kind: 'no_show', staffId: S });
    expect(ns.ok && ns.action.type === 'handyRsvCancel' && ns.action.staffId).toBe(null);
    expect(parseNativeHandyRsvAction({ type: 'handyRsvCancel', reservationId: R, kind: 'later' }).ok).toBe(false);
    expect(parseNativeHandyRsvAction({ type: 'handyRsvCancel', reservationId: R, kind: 'store', staffId: 'x' }).ok).toBe(false);
  });
  it('テーブル変更（重なりは1つに・空にすると割当を外す）', () => {
    const r = parseNativeHandyRsvAction({ type: 'handyRsvTables', reservationId: R, tableIds: [T1, T2, T1] });
    expect(r.ok && r.action.type === 'handyRsvTables' && r.action.tableIds).toEqual([T1, T2]);
    const empty = parseNativeHandyRsvAction({ type: 'handyRsvTables', reservationId: R, tableIds: [] });
    expect(empty.ok && empty.action.type === 'handyRsvTables' && empty.action.tableIds).toEqual([]);
    expect(parseNativeHandyRsvAction({ type: 'handyRsvTables', reservationId: R, tableIds: ['x'] }).ok).toBe(false);
    expect(parseNativeHandyRsvAction({ type: 'handyRsvTables', reservationId: R, tableIds: Array.from({ length: 21 }, () => T1) }).ok).toBe(false);
  });
  it('受付管理（確定する・連絡済み・確認済み・対応済み）', () => {
    for (const act of ['confirm', 'contacted', 'ack', 'resolveImport']) {
      expect(parseNativeHandyRsvAction({ type: 'handyRsvInbox', act, id: R }).ok).toBe(true);
    }
    expect(parseNativeHandyRsvAction({ type: 'handyRsvInbox', act: 'delete', id: R }).ok).toBe(false);
    expect(parseNativeHandyRsvAction({ type: 'handyRsvInbox', act: 'ack', id: 'x' }).ok).toBe(false);
  });
  it('知らない操作・形の違うものは止める', () => {
    expect(parseNativeHandyRsvAction({ type: 'nope' }).ok).toBe(false);
    expect(parseNativeHandyRsvAction(null).ok).toBe(false);
    expect(parseNativeHandyRsvAction([]).ok).toBe(false);
  });
});

describe('native-handy-reservations: 予約登録', () => {
  const base = {
    date: '2026-10-25',
    time: '18:00',
    adults: 2,
    children: 1,
    name: ' 山田 太郎 ',
    phone: '090-1234-5678',
    note: ' 誕生日 ',
    sourceCode: 'phone',
    courseId: null,
    tableIds: [T1],
    stayMinutes: null,
    status: 'confirmed',
    tags: ['当日予約'],
    clerkId: S,
  };
  it('Web のハンディの予約登録と同じ項目', () => {
    const r = parseNativeHandyRsvAction({ type: 'handyRsvCreate', input: base });
    expect(r).toEqual({
      ok: true,
      action: {
        type: 'handyRsvCreate',
        input: {
          date: '2026-10-25',
          time: '18:00',
          adults: 2,
          children: 1,
          name: '山田 太郎',
          phone: '090-1234-5678',
          note: '誕生日',
          sourceCode: 'phone',
          courseId: null,
          tableIds: [T1],
          stayMinutes: null,
          status: 'confirmed',
          tags: ['当日予約'],
          clerkId: S,
        },
      },
    });
  });
  it('予約ステータス：仮予約・要連絡（仮予約＋キーワード「要連絡」）', () => {
    const p = parseNativeHandyRsvAction({ type: 'handyRsvCreate', input: { ...base, status: 'pending' } });
    expect(p.ok && p.action.type === 'handyRsvCreate' && p.action.input.status).toBe('pending');
    const c = parseNativeHandyRsvAction({ type: 'handyRsvCreate', input: { ...base, status: 'needs_contact', tags: ['当日予約', '要連絡'] } });
    expect(c.ok && c.action.type === 'handyRsvCreate' && c.action.input.status).toBe('pending');
    expect(c.ok && c.action.type === 'handyRsvCreate' && c.action.input.tags).toEqual(['要連絡', '当日予約']);
  });
  it('経路が無ければ電話・確保時間は 15分〜12時間', () => {
    const r = parseNativeHandyRsvAction({ type: 'handyRsvCreate', input: { ...base, sourceCode: '', stayMinutes: 90 } });
    expect(r.ok && r.action.type === 'handyRsvCreate' && r.action.input.sourceCode).toBe('phone');
    expect(r.ok && r.action.type === 'handyRsvCreate' && r.action.input.stayMinutes).toBe(90);
    expect(parseNativeHandyRsvAction({ type: 'handyRsvCreate', input: { ...base, stayMinutes: 10 } }).ok).toBe(false);
    expect(parseNativeHandyRsvAction({ type: 'handyRsvCreate', input: { ...base, stayMinutes: 721 } }).ok).toBe(false);
  });
  it('おかしい入力は止める（日付・時間・人数・お名前・電話番号・コース・担当者・卓）', () => {
    const bad = (patch: Record<string, unknown>) => parseNativeHandyRsvAction({ type: 'handyRsvCreate', input: { ...base, ...patch } });
    expect(bad({ date: '2026-02-30' })).toEqual({ ok: false, error: '来店日を確認してください' });
    expect(bad({ time: '25:00' })).toEqual({ ok: false, error: '時間を確認してください' });
    expect(bad({ adults: 0, children: 0 })).toEqual({ ok: false, error: 'ご人数をご確認ください' });
    expect(bad({ adults: 1.5 }).ok).toBe(false);
    expect(bad({ name: '  ' })).toEqual({ ok: false, error: 'お名前を入れてください' });
    expect(bad({ phone: '090-123' })).toEqual({ ok: false, error: '電話番号は10桁以上で入れてください' });
    expect(bad({ courseId: 'x' }).ok).toBe(false);
    expect(bad({ clerkId: 'x' }).ok).toBe(false);
    expect(bad({ tableIds: ['x'] }).ok).toBe(false);
    expect(bad({ tags: [1] }).ok).toBe(false);
    expect(parseNativeHandyRsvAction({ type: 'handyRsvCreate' }).ok).toBe(false);
  });
  it('コース・担当者は空なら無し', () => {
    const r = parseNativeHandyRsvAction({ type: 'handyRsvCreate', input: { ...base, courseId: '', clerkId: '' } });
    expect(r.ok && r.action.type === 'handyRsvCreate' && [r.action.input.courseId, r.action.input.clerkId]).toEqual([null, null]);
  });
});

describe('native-handy-reservations: 日付選択のカレンダー', () => {
  it('日曜はじまり・月の外は空・人数・仮予約／要連絡・休業日（臨時休業・定休日）・祝日', () => {
    const weeks = handyMonthGrid('2026-11', {
      days: { '2026-11-03': { guests: 12, attention: true }, '2026-11-10': { guests: 4, attention: false } },
      closedDates: ['2026-11-20'],
      closedWeekdays: [1],
    });
    // 2026-11-01 は日曜
    expect(weeks[0][0]?.date).toBe('2026-11-01');
    expect(weeks[0][0]?.dow).toBe(0);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const days = weeks.flat().filter((d): d is NonNullable<typeof d> => d !== null);
    expect(days).toHaveLength(30);
    const nov3 = days.find((d) => d.date === '2026-11-03');
    expect(nov3).toMatchObject({ guests: 12, attention: true, holiday: '文化の日', dow: 2, closed: false });
    expect(days.find((d) => d.date === '2026-11-10')).toMatchObject({ guests: 4, attention: false });
    expect(days.find((d) => d.date === '2026-11-20')?.closed).toBe(true);
    // 月曜は定休日
    expect(days.find((d) => d.date === '2026-11-02')?.closed).toBe(true);
    expect(days.find((d) => d.date === '2026-11-04')).toMatchObject({ guests: 0, attention: false, closed: false, holiday: null });
    // 末の週の残りは空
    expect(weeks[weeks.length - 1].slice(-1)[0]).toBeNull();
  });
  it('月の初めが日曜でないときは前を空ける', () => {
    const weeks = handyMonthGrid('2026-10', { days: {}, closedDates: [], closedWeekdays: [] });
    // 2026-10-01 は木曜
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0][4]?.date).toBe('2026-10-01');
  });
});
