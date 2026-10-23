import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isNativeLedgerActionType, NATIVE_LEDGER_ACTION_TYPES, parseNativeLedgerAction } from '@/lib/native-ledger';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('ネイティブの店舗台帳の操作（2026-10-24 Ronnie「店舗台帳もネイティブ。色は Tableo 風」）', () => {
  it('知らない形は受け付けない', () => {
    expect(parseNativeLedgerAction(null).ok).toBe(false);
    expect(parseNativeLedgerAction({ type: 'floorBill' }).ok).toBe(false);
    expect(isNativeLedgerActionType('ledgerSeat')).toBe(true);
    expect(isNativeLedgerActionType('send')).toBe(false);
    expect(NATIVE_LEDGER_ACTION_TYPES.length).toBe(11);
  });

  it('予約登録：日時・人数・名前・電話・経路・コース・卓・滞在・仮予約', () => {
    const r = parseNativeLedgerAction({
      type: 'ledgerCreate',
      input: { date: '2026-10-24', time: '18:30', adults: 2, children: 1, name: '山田 太郎', phone: '090-1234-5678', sourceCode: 'tabelog', courseId: U1, tableIds: [U2], stayMinutes: 120, status: 'pending', clerkId: null },
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.action.type === 'ledgerCreate') {
      expect(r.action.input.status).toBe('pending');
      expect(r.action.input.tableIds).toEqual([U2]);
      expect(r.action.input.sourceCode).toBe('tabelog');
    }
    expect(parseNativeLedgerAction({ type: 'ledgerCreate', input: { date: '2026/10/24', time: '18:30', adults: 2, children: 0, name: 'a', phone: '0901234567' } }).ok).toBe(false);
    expect(parseNativeLedgerAction({ type: 'ledgerCreate', input: { date: '2026-10-24', time: '25:00', adults: 2, children: 0, name: 'a', phone: '0901234567' } }).ok).toBe(false);
    expect(parseNativeLedgerAction({ type: 'ledgerCreate', input: { date: '2026-10-24', time: '18:30', adults: 0, children: 0, name: 'a', phone: '0901234567' } }).ok).toBe(false);
    expect(parseNativeLedgerAction({ type: 'ledgerCreate', input: { date: '2026-10-24', time: '18:30', adults: 1, children: 0, name: '', phone: '0901234567' } }).ok).toBe(false);
    // 経路を省略すると電話
    const d = parseNativeLedgerAction({ type: 'ledgerCreate', input: { date: '2026-10-24', time: '18:30', adults: 1, children: 0, name: 'a', phone: '0901234567' } });
    expect(d.ok && d.action.type === 'ledgerCreate' && d.action.input.sourceCode).toBe('phone');
  });

  it('状態・取消・卓・日時・メモ・担当・経路・コース・着席', () => {
    expect(parseNativeLedgerAction({ type: 'ledgerStatus', reservationId: U1, toStatus: 'arrived' }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerStatus', reservationId: U1, toStatus: 'nope' }).ok).toBe(false);
    expect(parseNativeLedgerAction({ type: 'ledgerCancel', reservationId: U1, reason: '' }).ok).toBe(false);
    expect(parseNativeLedgerAction({ type: 'ledgerCancel', reservationId: U1, reason: 'お客様都合' }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerNoShow', reservationId: U1 }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerTables', reservationId: U1, tableIds: [] }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerMove', reservationId: U1, date: '2026-10-25', time: '19:00', stayMinutes: 90 }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerMove', reservationId: U1, date: '2026-10-25', time: '19:00', stayMinutes: 5 }).ok).toBe(false);
    expect(parseNativeLedgerAction({ type: 'ledgerMemo', reservationId: U1, memo: 'x' }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerClerk', reservationId: U1, clerkId: null }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerSource', reservationId: U1, sourceId: U2 }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerCourse', reservationId: U1, courseId: 'x' }).ok).toBe(false);
    expect(parseNativeLedgerAction({ type: 'ledgerSeat', reservationId: U1 }).ok).toBe(true);
  });

  it('API は Web の予約台帳と同じ Server Action に渡す', () => {
    const route = readFileSync(new URL('../app/api/app/v1/pos/route.ts', import.meta.url), 'utf8');
    expect(route).toContain("if (part === 'ledger') {");
    expect(route).toContain('await createManualReservation({');
    expect(route).toContain('await transitionReservationStatus(action.reservationId, action.toStatus)');
    expect(route).toContain('await createOrderForReservation(action.reservationId)');
    // 予約→伝票は Web の createOrderFromReservation と同じ中身（redirect しない版）
    const actions = readFileSync(new URL('../app/app/reservations/actions.ts', import.meta.url), 'utf8');
    expect(actions).toContain('export async function createOrderForReservation(reservationId: string): Promise<string>');
    expect(actions).toContain('const orderId = await createOrderForReservation(reservationId);\n  redirect(`/app/pos?order=${orderId}`);');
  });
});
