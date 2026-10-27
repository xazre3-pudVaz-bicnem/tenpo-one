import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateVisitDraft, visitGuestCount, visitMemo } from '@/lib/handy-visit';
import { isNativeVisitEditType, minutesFromLabel, parseNativeVisitEdit, visitFromMemo } from '@/lib/native-visit-edit';

const ORDER = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';
const route = readFileSync('app/api/app/v1/pos/route.ts', 'utf8');

describe('着席中のお客様情報を来店登録と同じ画面で直す（2026-10-24 Ronnie）', () => {
  it('人数だけを登録・編集しても性別を推測せず、メモの人数を来店経路と取り違えない', () => {
    const draft = { plans: ['normal'] as const, planItemIds: [], male: 0, female: 0, guestCount: 6,
      source: '', timed: false, duration: 120, warningEnabled: false, warningMinutes: 30, startTime: null };
    const parsed = parseNativeVisitEdit({ type: 'visitEdit', orderId: ORDER, draft });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('total-only draft rejected');
    expect(visitGuestCount(parsed.action.draft)).toBe(6);
    expect(validateVisitDraft(parsed.action.draft, { requireSource: false })).toBeNull();
    expect(visitMemo(parsed.action.draft)).toBe('ハンディ: アラカルト / 人数6名');
    expect(visitFromMemo(visitMemo(parsed.action.draft))).toMatchObject({ guestCount: 6, male: null, female: null, source: null });
  });

  it('人数だけの不正な値や内訳を超える変更は受け付けず、旧アプリの人数も保つ', () => {
    const draft = { male: 0, female: 0, guestCount: 4 };
    for (const guestCount of [0, 1000, -1, 1.5, '4']) {
      expect(parseNativeVisitEdit({ type: 'visitEdit', orderId: ORDER, draft: { ...draft, guestCount } }).ok).toBe(false);
    }
    expect(parseNativeVisitEdit({ type: 'visitEdit', orderId: ORDER, draft: { male: 3, female: 2, guestCount: 4 } }).ok).toBe(false);
    expect(visitGuestCount({ male: 2, female: 3 })).toBe(5);
  });
  it('伝票メモを読む（visitMemo の逆）', () => {
    const memo = visitMemo({
      plans: ['drink', 'normal'], male: 2, female: 1, source: '食べログ', timed: true, duration: 90, warningEnabled: true, warningMinutes: 30,
    });
    expect(visitFromMemo(memo)).toEqual({
      plans: ['drink', 'normal'], male: 2, female: 1, source: '食べログ', timed: true, duration: 90, warningEnabled: true, warningMinutes: 30,
    });
    const plain = visitMemo({ plans: ['normal'], male: 0, female: 4, source: '', timed: false, duration: 120, warningEnabled: false, warningMinutes: 30 });
    expect(visitFromMemo(plain)).toMatchObject({ plans: ['normal'], male: 0, female: 4, source: null, timed: false, warningEnabled: false });
    expect(visitFromMemo('手書きのメモ')).toBeNull();
    expect(visitFromMemo(null)).toBeNull();
  });

  it('時間の名前を分に戻す', () => {
    expect(minutesFromLabel('2時間')).toBe(120);
    expect(minutesFromLabel('1時間30分')).toBe(90);
    expect(minutesFromLabel('45分')).toBe(45);
    expect(minutesFromLabel('ふつう')).toBeNull();
  });

  it('保存の形を確かめる（人数1人以上・来店経路は決まった名前・コースは id）', () => {
    expect(isNativeVisitEditType('visitEdit')).toBe(true);
    const draft = { plans: ['normal'], planItemIds: [], male: 1, female: 2, source: '食べログ', timed: true, duration: 120, warningEnabled: true, warningMinutes: 30, startTime: '10:15' };
    const ok = parseNativeVisitEdit({ type: 'visitEdit', orderId: ORDER, draft, courseId: COURSE });
    expect(ok.ok && ok.action.draft.male + ok.action.draft.female).toBe(3);
    expect(ok.ok && ok.action.courseId).toBe(COURSE);
    expect(parseNativeVisitEdit({ type: 'visitEdit', orderId: ORDER, draft: { ...draft, male: 0, female: 0 } }).ok).toBe(false);
    expect(parseNativeVisitEdit({ type: 'visitEdit', orderId: ORDER, draft: { ...draft, source: 'なぞ' } }).ok).toBe(false);
    expect(parseNativeVisitEdit({ type: 'visitEdit', orderId: 'x', draft }).ok).toBe(false);
    expect(parseNativeVisitEdit({ type: 'visitEdit', orderId: ORDER, draft, courseId: 'x' }).ok).toBe(false);
  });

  it('サーバーは pos.order → 店の回線の順で、Web と同じ setSeatTime を使う', () => {
    const block = route.slice(route.indexOf('isNativeVisitEditType((raw'));
    expect(block.indexOf("can(ctx.role, 'pos.order')")).toBeLessThan(block.indexOf('networkProblem(ctx)'));
    expect(readFileSync('lib/native-visit-edit-server.ts', 'utf8')).toContain('await setSeatTime(a.orderId');
  });
});
