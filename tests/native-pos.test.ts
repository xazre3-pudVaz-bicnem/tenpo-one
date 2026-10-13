import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jstHm, parseNativePosAction } from '@/lib/native-pos';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const ID = '11111111-2222-4333-8444-555555555555';
const ID2 = '66666666-7777-4888-9999-000000000000';

/** 2026-10-13 Ronnie「Airレジのように全部ネイティブ。まずネットがある時に」 */
describe('iPad アプリのネイティブ画面の操作（/api/app/v1/pos）', () => {
  it('注文確定：明細をまとめて送る（数量 1〜99・選択肢は id だけ）', () => {
    const ok = parseNativePosAction({ type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 2 }] });
    expect(ok).toEqual({ ok: true, action: { type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 2, optionItemIds: [] }] } });
    expect(parseNativePosAction({ type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 0 }] }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 100 }] }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'send', orderId: ID, lines: [{ menuItemId: 'x', quantity: 1 }] }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'send', orderId: 'bad', lines: [] }).ok).toBe(false);
  });

  it('数量は ±1 だけ', () => {
    expect(parseNativePosAction({ type: 'qty', orderId: ID, lineId: ID2, delta: 1 }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'qty', orderId: ID, lineId: ID2, delta: 5 }).ok).toBe(false);
  });

  it('値引きは理由が要る・金額は 0〜1,000万円の整数', () => {
    expect(parseNativePosAction({ type: 'discount', orderId: ID, amount: 500, reason: '' })).toEqual({ ok: false, error: '値引きの理由を入れてください' });
    expect(parseNativePosAction({ type: 'discount', orderId: ID, amount: 500, reason: '幹事様無料' }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'discount', orderId: ID, amount: 0, reason: '' }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'discount', orderId: ID, amount: -1, reason: 'x' }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'discount', orderId: ID, amount: 1.5, reason: 'x' }).ok).toBe(false);
  });

  it('会計：知っている支払方法だけ（商品券・掛売は出さない）', () => {
    const ok = parseNativePosAction({
      type: 'checkout',
      orderId: ID,
      payments: [
        { method: 'cash', amount: 1000, tendered: 5000 },
        { method: 'credit', amount: 1150, provider: 'visa' },
      ],
      memo: 'テスト',
    });
    expect(ok.ok).toBe(true);
    expect(parseNativePosAction({ type: 'checkout', orderId: ID, payments: [{ method: 'voucher', amount: 100 }] }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'checkout', orderId: ID, payments: [{ method: 'cash', amount: 100, tendered: -5 }] }).ok).toBe(false);
  });

  it('来店経路・担当者・stera', () => {
    expect(parseNativePosAction({ type: 'visitSource', orderId: ID, sourceId: 'tabelog' }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'visitSource', orderId: ID, sourceId: null }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'visitSource', orderId: ID, sourceId: 'DROP TABLE' }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'clerk', orderId: ID, clerkId: null }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'steraStart', orderId: ID, terminalId: ID2, paymentType: '02-02' }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'steraStart', orderId: ID, terminalId: ID2, paymentType: 'abc' }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'steraCheck', requestId: ID }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'nope' }).ok).toBe(false);
    expect(parseNativePosAction(null).ok).toBe(false);
  });

  it('時刻は日本時間の HH:MM', () => {
    expect(jstHm('2026-10-13T09:30:00Z')).toBe('18:30');
    expect(jstHm(null)).toBe(null);
  });
});

describe('今の Web・レジは変えない／守り', () => {
  const route = read('app/api/app/v1/pos/route.ts');

  it('アプリの印（x-tenpo-app: 1）が無いと受け付けない', () => {
    expect(route).toContain("request.headers.get(NATIVE_APP_HEADER) === '1'");
    expect(route).toContain("if (!fromApp(request)) return json({ ok: false, error: 'アプリから操作してください' }, 400);");
  });

  it('Server Action と同じ回線の制限・権限・端末の台数を見る', () => {
    expect(route).toContain('const problem = await networkProblem(ctx);');
    expect(route).toContain('isRequestFromStoreNetwork(ctx.currentStore.id)');
    expect(route).toContain('assertHandyOnShopNetwork');
    expect(route).toContain("checkout: 'pos.checkout'");
    expect(route).toContain("discount: 'pos.discount'");
    expect(route).toContain('peekRegisterDevice');
  });

  it('金額・会計・厨房は Web と同じ処理を使う（二重に計算しない）', () => {
    expect(route).toContain("from '@/app/app/pos/actions'");
    expect(route).toContain('await sendOrderToKitchen(action.orderId)');
    expect(route).toContain('await checkout(action.orderId, action.payments');
  });

  it('Web のレジのページは変えていない', () => {
    expect(read('app/app/pos/page.tsx')).not.toContain('native-pos');
  });
});
