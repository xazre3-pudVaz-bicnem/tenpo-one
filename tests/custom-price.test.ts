import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PRICE_ITEM_NAME,
  CUSTOM_PRICE_MARKER,
  CUSTOM_PRICE_MAX,
  CUSTOM_PRICE_MEMO_MAX,
  customHelperItemType,
  customItemName,
  customLineId,
  customPriceProblem,
  isCustomLineId,
  isCustomPriceHelper,
  normalizeCustomMemo,
} from '@/lib/custom-price';
import { repriceLines } from '@/lib/cart-reprice';
import { addCartLine, cartLineKey, type HandyCartLine } from '@/components/handy/logic';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/**
 * 「その他（価格入力）」— 各カテゴリの最後のボタン（2026-10-07 Ronnie
 * 「お客様が何か追加したとき、金額を自分で打てる Other ボタンを全カテゴリの最後に。ハンディと iPad だけ」）。
 */
describe('その他（価格入力）の決まり', () => {
  it('明細の名前は打った内容。無ければ「その他」。長さを詰める', () => {
    expect(customItemName('大盛り')).toBe('大盛り');
    expect(customItemName('  チーズ   追加 ')).toBe('チーズ 追加');
    expect(customItemName('')).toBe(CUSTOM_PRICE_ITEM_NAME);
    expect(customItemName(null)).toBe('その他');
    expect(normalizeCustomMemo('あ'.repeat(100))).toHaveLength(CUSTOM_PRICE_MEMO_MAX);
  });

  it('金額は 0〜上限の整数、数量は 1〜99', () => {
    expect(customPriceProblem(500, 1)).toBeNull();
    expect(customPriceProblem(0, 1)).toBeNull();
    expect(customPriceProblem(-1, 1)).not.toBeNull();
    expect(customPriceProblem(1.5, 1)).not.toBeNull();
    expect(customPriceProblem(CUSTOM_PRICE_MAX + 1, 1)).not.toBeNull();
    expect(customPriceProblem(500, 0)).not.toBeNull();
    expect(customPriceProblem(500, 100)).not.toBeNull();
  });

  it('補助の商品は説明欄の印で見分ける（名前では見分けない）', () => {
    expect(isCustomPriceHelper({ description: CUSTOM_PRICE_MARKER })).toBe(true);
    expect(isCustomPriceHelper({ description: null })).toBe(false);
    expect(isCustomPriceHelper({ description: 'その他' })).toBe(false);
  });

  it('ドリンクの持ち場のカテゴリはドリンク（テイクアウトの税率に使う）', () => {
    expect(customHelperItemType('drink')).toBe('drink');
    expect(customHelperItemType('kitchen')).toBe('food');
    expect(customHelperItemType(null)).toBe('food');
  });
});

describe('カートの「その他」の行', () => {
  it('入れるたびに別の行（同じ金額でもまとめない）', () => {
    const base = { name: 'その他', nameEn: 'Other', unitPrice: 300, optionItemIds: [], optionLabel: 'FOOD' };
    let cart: HandyCartLine[] = [];
    cart = addCartLine(cart, { ...base, menuItemId: customLineId('cat-1', 1) }, 1);
    cart = addCartLine(cart, { ...base, menuItemId: customLineId('cat-1', 2) }, 1);
    expect(cart).toHaveLength(2);
    expect(cart.every((l) => isCustomLineId(l.menuItemId))).toBe(true);
    expect(cart[0].key).toBe(cartLineKey(customLineId('cat-1', 1), []));
    expect(customLineId(null, 3)).toBe('custom:none:3');
  });

  it('メニューの値段の付け直しでは打った金額が変わらない', () => {
    const lines = [{ menuItemId: customLineId('cat-1', 1), optionItemIds: [], unitPrice: 480 }];
    expect(repriceLines(lines, () => undefined, () => undefined)).toBe(lines);
  });
});

describe('画面とサーバー', () => {
  it('ハンディ：各カテゴリの最後に Other。送るときは addCustomPriceItem', () => {
    const screen = read('components/handy/handy-order-screen.tsx');
    expect(screen).toContain('setCustomTarget({ categoryId: c.id');
    expect(screen).toContain('<OpenPriceDialog');
    expect(screen).toContain('...(l.custom ? { custom: l.custom } : {})');
    const actions = read('app/app/handy/actions.ts');
    expect(actions).toContain('line.custom\n        ? await addCustomPriceItem(orderId');
  });

  it('レジ（iPad）：開いているカテゴリの最後に Other（おすすめ・売れ筋・検索には出さない）', () => {
    const pos = read('components/pos/pos-screen.tsx');
    expect(pos).toContain('activeCategory === FAVORITES_TAB || activeCategory === BESTSELLERS_TAB');
    expect(pos).toContain('onClick={() => setCustomTarget(customCategory)}');
    expect(pos).toContain('await addCustomItemAction(order.id, {');
    expect(read('app/app/pos/page.tsx')).toContain(
      'addCustomItemAction={seatTableId ? addCustomPriceItemAtSeat.bind(null, seatTableId) : addCustomPriceItem}'
    );
  });

  it('サーバー：カテゴリを確かめ、非表示の補助の商品（無ければ作る）として未送信で入れる', () => {
    const src = read('app/app/pos/actions.ts');
    expect(src).toContain("export async function addCustomPriceItem(orderId: string, input: CustomPriceInput)");
    expect(src).toContain(".eq('description', CUSTOM_PRICE_MARKER)");
    expect(src).toContain("status: 'hidden',");
    expect(src).toContain('name: customItemName(input.memo),');
    expect(src).toContain('kitchen_sent_at: null,');
  });

  it('お客様QR には出ない（非表示の商品は QR のメニューに入らない）・設定の一覧からも外す', () => {
    expect(read('supabase/migrations/00048_menu_english_names.sql')).toContain("and mi.status = 'active'");
    expect(read('app/app/settings/menu/data.ts')).toContain('.filter((i) => !isCustomPriceHelper(i))');
    expect(read('app/app/settings/menu-book/page.tsx')).toContain('.filter((i) => !isCustomPriceHelper(i))');
  });
});
