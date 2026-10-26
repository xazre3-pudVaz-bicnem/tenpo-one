import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isNativeFloorActionType, NATIVE_FLOOR_ACTION_TYPES, parseNativeFloorAction, pickNativeFloorStore } from '@/lib/native-floor';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('ネイティブのフロア（テーブル一覧）の操作（2026-10-24 Ronnie「レジは全部ネイティブに」）', () => {
  it('知らない形は受け付けない', () => {
    expect(parseNativeFloorAction(null).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'nope' }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorOrder', tableId: 'x' }).ok).toBe(false);
    expect(isNativeFloorActionType('floorOrder')).toBe(true);
    expect(isNativeFloorActionType('send')).toBe(false);
    expect(NATIVE_FLOOR_ACTION_TYPES.length).toBe(20);
  });

  it('着席（お客様情報）：モード・人数・来店経路・時間制・開始時間', () => {
    const r = parseNativeFloorAction({
      type: 'floorStart',
      tableId: U1,
      draft: { plans: ['drink', 'normal'], planItemIds: [U2], male: 2, female: 1, source: '食べログ', timed: true, duration: 120, warningEnabled: true, warningMinutes: 30, startTime: '18:30' },
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.action.type === 'floorStart') {
      expect(r.action.draft.plans).toEqual(['drink', 'normal']);
      expect(r.action.draft.male + r.action.draft.female).toBe(3);
      expect(r.action.draft.startTime).toBe('18:30');
    }
    // 最低限（人数だけ）でも形は通る。来店経路の有無はサーバー（validateVisitDraft）が見る
    const min = parseNativeFloorAction({ type: 'floorStart', tableId: U1, draft: { male: 1, female: 0 } });
    expect(min.ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorStart', tableId: U1, draft: { male: -1, female: 0 } }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorStart', tableId: U1, draft: { male: 1, female: 0, source: '謎' } }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorStart', tableId: U1, draft: { male: 1, female: 0, plans: ['x'] } }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorStart', tableId: U1, draft: { male: 1, female: 0, startTime: '25:00' } }).ok).toBe(false);
  });

  it('お客様情報（席の時間・コース・人数・モード・プラン）', () => {
    const r = parseNativeFloorAction({
      type: 'floorSeatTime',
      orderId: U1,
      input: { startTime: null, durationMinutes: 90, courseId: '', guestCount: 4, plans: ['course'], planItemIds: [U2, U2] },
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.action.type === 'floorSeatTime') {
      expect(r.action.input.courseId).toBeNull();
      expect(r.action.input.durationMinutes).toBe(90);
      expect(r.action.input.planItemIds).toEqual([U2]);
    }
    expect(parseNativeFloorAction({ type: 'floorSeatTime', orderId: U1, input: { durationMinutes: 0 } }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorSeatTime', orderId: U1, input: { guestCount: 0 } }).ok).toBe(false);
  });

  it('印刷・合算・人数・メモ・クリア・呼び出し', () => {
    expect(parseNativeFloorAction({ type: 'floorBill', orderId: U1 }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorExpo', orderId: U1 }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorReceipt', orderId: U1 }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorPrintSelected', orderId: U1, itemIds: [U2] }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorPrintSelected', orderId: U1, itemIds: [] }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorMerge', targetOrderId: U1, sourceOrderId: U2 }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorMerge', targetOrderId: U1, sourceOrderId: U1 }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorGuests', orderId: U1, guestCount: 1000 }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorGuests', orderId: U1, guestCount: 8 }).ok).toBe(true);
    const memo = parseNativeFloorAction({ type: 'floorMemo', orderId: U1, memo: 'a'.repeat(300) });
    expect(memo.ok && memo.action.type === 'floorMemo' && memo.action.memo.length).toBe(200);
    expect(parseNativeFloorAction({ type: 'floorClear', orderId: U1, reason: '', approvedByClerkId: null }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorClear', orderId: U1, reason: '', approvedByClerkId: 'x' }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorCall', callId: U1 }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorGroup', tableIds: [U1, U2, U1] }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorBlock', tableId: U1, unavailable: 'yes' }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorRelease', storeId: U1 }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorNewSlip', orderId: U1 }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorMove', orderId: U1, tableId: U2 }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'floorCancelEmpty', orderId: U1, reason: '', approvedByClerkId: null }).ok).toBe(false);
    expect(parseNativeFloorAction({ type: 'floorCancelEmpty', orderId: U1, reason: '誤着席', approvedByClerkId: U2 }).ok).toBe(true);
  });

  it('API はフロアの操作を Web と同じ Server Action に渡し、part=floor は Web のテーブル一覧と同じ組み立てを返す', () => {
    const route = readFileSync(new URL('../app/api/app/v1/pos/route.ts', import.meta.url), 'utf8');
    expect(route).toContain("if (part === 'floor') {");
    expect(route).toContain('loadNativeFloor(ctx, await createClient()');
    expect(route).toContain('await startRegisterVisit(action.tableId, action.draft, { sourceOptional: true })');
    expect(route).toContain('await goToOrder(action.tableId)');
    expect(route).toContain('await enqueueOrderSlipPrint(action.orderId)');
    expect(route).toContain('await setSeatTime(action.orderId, action.input)');
    expect(route).toContain('await clearTable(action.orderId, action.reason, action.approvedByClerkId)');
    const server = readFileSync(new URL('../lib/native-floor-server.ts', import.meta.url), 'utf8');
    expect(server).toContain('loadFloorView(ctx, supabase, store)');
    expect(server).toContain('cancelApprovers(clerks)');
  });

  it('保存してあった一覧の店がこの人の店でなければ今の店を出す（2026-10-26「テーブルが見つかりません」）', () => {
    const a = { id: U1, name: '五反田' };
    const b = { id: U2, name: '新宿' };
    const other = '33333333-3333-4333-8333-333333333333';
    expect(pickNativeFloorStore({ stores: [a, b], currentStore: a }, U2)).toBe(b);
    // 別のアカウントの店（Ronnies Shop の保存のまま 五反田 のアカウント）→ 今の店
    expect(pickNativeFloorStore({ stores: [a, b], currentStore: a }, other)).toBe(a);
    expect(pickNativeFloorStore({ stores: [a, b], currentStore: null }, other)).toBe(a);
    expect(pickNativeFloorStore({ stores: [a, b], currentStore: b }, null)).toBe(b);
    expect(pickNativeFloorStore({ stores: [a], currentStore: a }, 'x')).toBe(a);
    expect(pickNativeFloorStore({ stores: [], currentStore: null }, other)).toBeNull();
    const route = readFileSync(new URL('../app/api/app/v1/pos/route.ts', import.meta.url), 'utf8');
    expect(route).toContain("const store = pickNativeFloorStore(ctx, url.searchParams.get('store'));");
  });
});
