import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jstHm, optionGroupsFrom, parseNativePosAction } from '@/lib/native-pos';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const ID = '11111111-2222-4333-8444-555555555555';
const ID2 = '66666666-7777-4888-9999-000000000000';

/** 2026-10-13 Ronnie「Airレジのように全部ネイティブ。まずネットがある時に」 */
describe('iPad アプリのネイティブ画面の操作（/api/app/v1/pos）', () => {
  it('注文確定：明細をまとめて送る（数量 1〜99・選択肢は id だけ）', () => {
    const ok = parseNativePosAction({ type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 2 }] });
    expect(ok).toEqual({
      ok: true,
      action: { type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 2, optionItemIds: [], openPrice: null }] },
    });
    expect(parseNativePosAction({ type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 0 }] }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 100 }] }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'send', orderId: ID, lines: [{ menuItemId: 'x', quantity: 1 }] }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'send', orderId: 'bad', lines: [] }).ok).toBe(false);
  });

  it('数量は ±1 だけ', () => {
    expect(parseNativePosAction({ type: 'qty', orderId: ID, lineId: ID2, delta: 1 }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'qty', orderId: ID, lineId: ID2, delta: 5 }).ok).toBe(false);
  });

  it('別々会計の「分ける」は 2〜10 人・1品の取消は承認する担当者が id か null', () => {
    expect(parseNativePosAction({ type: 'divide', orderId: ID, lineId: ID2, parts: 3 }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'divide', orderId: ID, lineId: ID2, parts: 1 }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'divide', orderId: ID, lineId: ID2, parts: 11 }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'divide', orderId: ID, lineId: ID2, parts: 2.5 }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'cancelLine', orderId: ID, lineId: ID2, approvedByClerkId: ID })).toEqual({
      ok: true,
      action: { type: 'cancelLine', orderId: ID, lineId: ID2, reason: '', approvedByClerkId: ID },
    });
    expect(parseNativePosAction({ type: 'cancelLine', orderId: ID, lineId: ID2, reason: ' 間違い ', approvedByClerkId: null }).ok).toBe(true);
    expect(parseNativePosAction({ type: 'cancelLine', orderId: ID, lineId: ID2, approvedByClerkId: 'bob' }).ok).toBe(false);
    expect(parseNativePosAction({ type: 'cancelLine', orderId: ID, lineId: 'x', approvedByClerkId: null }).ok).toBe(false);
  });

  it('native split validates item IDs and positive whole quantities', () => {
    expect(parseNativePosAction({ type: 'split', orderId: ID, moves: [{ orderItemId: ID2, quantity: 1 }] }).ok).toBe(true);
    for (const moves of [[], [{ orderItemId: 'bad', quantity: 1 }], [{ orderItemId: ID2, quantity: 0 }], [{ orderItemId: ID2, quantity: 1.5 }]]) {
      expect(parseNativePosAction({ type: 'split', orderId: ID, moves }).ok).toBe(false);
    }
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

  it('選択肢・レジで打つ金額（¥0 の商品）もアプリから送れる', () => {
    const ok = parseNativePosAction({
      type: 'send',
      orderId: ID,
      lines: [{ menuItemId: ID2, quantity: 1, optionItemIds: [ID, ID], openPrice: 3000 }],
    });
    expect(ok).toEqual({
      ok: true,
      action: { type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 1, optionItemIds: [ID], openPrice: 3000 }] },
    });
    for (const openPrice of [-1, 1.5, '3000', 10_000_001]) {
      expect(parseNativePosAction({ type: 'send', orderId: ID, lines: [{ menuItemId: ID2, quantity: 1, openPrice }] }).ok).toBe(false);
    }
    // サーバーは Web と同じ addItem に金額を渡す（¥0 の商品か・上限はそこで確かめる）
    expect(route).toContain('l.quantity, l.openPrice)');
  });

  it('選択肢グループ：有効な選択肢だけ・並び順・必須と最小/最大（Web のレジと同じ）', () => {
    const g = (id: string, items: { id: string; status: string; sort_order: number; price?: number }[], extra = {}) => ({
      id,
      name: `G${id}`,
      is_required: true,
      min_select: 1,
      max_select: 1,
      status: 'active',
      menu_option_items: items.map((o) => ({ name: `O${o.id}`, price: o.price ?? 0, ...o })),
      ...extra,
    });
    const out = optionGroupsFrom([
      { menu_item_id: 'a', sort_order: 2, menu_option_groups: g('2', [{ id: 'x', status: 'active', sort_order: 0, price: 100 }]) },
      {
        menu_item_id: 'a',
        sort_order: 1,
        menu_option_groups: g('1', [
          { id: 'z', status: 'active', sort_order: 2 },
          { id: 'y', status: 'active', sort_order: 1 },
          { id: 'off', status: 'inactive', sort_order: 0 },
        ], { is_required: false, min_select: 0, max_select: 3 }),
      },
      { menu_item_id: 'b', sort_order: 0, menu_option_groups: g('3', [{ id: 'w', status: 'inactive', sort_order: 0 }]) },
      { menu_item_id: 'c', sort_order: 0, menu_option_groups: g('4', [{ id: 'v', status: 'active', sort_order: 0 }], { status: 'archived' }) },
    ]);
    expect(Object.keys(out)).toEqual(['a']);
    expect(out.a.map((x) => x.id)).toEqual(['1', '2']);
    expect(out.a[0]).toMatchObject({ isRequired: false, minSelect: 0, maxSelect: 3 });
    expect(out.a[0].items.map((o) => o.id)).toEqual(['y', 'z']);
    expect(out.a[1].items).toEqual([{ id: 'x', name: 'Ox', english: null, price: 100 }]);
    // 英語名（name_en）があれば英語を主に（iPad は英語。2026-10-13 Ronnie「iPad は全部英語」）
    const en = optionGroupsFrom([
      {
        menu_item_id: 'a',
        menu_option_groups: g('5', [{ id: 'r', status: 'active', sort_order: 0, name_en: 'Rare' } as never]),
      },
    ]);
    expect(en.a[0].items[0].english).toBe('Rare');
  });

  it('Web のレジのページは変えていない', () => {
    expect(read('app/app/pos/page.tsx')).not.toContain('native-pos');
  });
});
