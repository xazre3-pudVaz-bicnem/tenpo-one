import { describe, it, expect } from 'vitest';
import {
  addCartLine,
  buildHandyTabs,
  callToneByTable,
  cartCount,
  cartLineKey,
  cartTotal,
  changeCartQuantity,
  classifyMenuItem,
  elapsedLabel,
  handyTabOf,
  initialHandyTab,
  isOnSaleAt,
  MAX_LINE_QUANTITY,
  sortServiceCalls,
  tableState,
  type HandyCartLine,
  type HandyCategoryInput,
  type HandyMenuItemInput,
  type HandyServiceCall,
} from '@/components/handy/logic';

function category(
  id: string,
  name: string,
  station: string | null,
  sortOrder = 0
): HandyCategoryInput {
  return { id, name, nameEn: null, station, sortOrder };
}

function item(
  id: string,
  categoryId: string | null,
  itemType: string,
  overrides: Partial<HandyMenuItemInput> = {}
): HandyMenuItemInput {
  return {
    id,
    categoryId,
    name: id,
    nameEn: null,
    price: 1000,
    itemType,
    isSoldOut: false,
    sortOrder: 0,
    sellStartTime: null,
    sellEndTime: null,
    imagePath: null,
    hasOptions: false,
    ...overrides,
  };
}

describe('classifyMenuItem', () => {
  it('item_type をそのまま上位分類に対応させる', () => {
    expect(classifyMenuItem('food', 'kitchen')).toBe('food');
    expect(classifyMenuItem('drink', 'drink')).toBe('drink');
    expect(classifyMenuItem('course', 'kitchen')).toBe('course');
    expect(classifyMenuItem('option', 'kitchen')).toBe('service');
  });

  it('item_type を優先し、station では上書きしない', () => {
    // デザートのカテゴリでも item_type が food ならフード
    expect(classifyMenuItem('food', 'dessert')).toBe('food');
    // ドリンクのステーションでもコース商品はコース
    expect(classifyMenuItem('course', 'drink')).toBe('course');
  });

  it('item_type が未知のときだけ station で判断する', () => {
    expect(classifyMenuItem('unknown', 'drink')).toBe('drink');
    expect(classifyMenuItem('unknown', 'dessert')).toBe('food');
    expect(classifyMenuItem('unknown', 'kitchen')).toBe('food');
  });

  it('どちらでも判断できなければ「その他」にする（カテゴリ名からは推測しない）', () => {
    expect(classifyMenuItem('unknown', null)).toBe('other');
    expect(classifyMenuItem(null, undefined)).toBe('other');
    expect(classifyMenuItem('set', 'takeout')).toBe('other');
  });
});

describe('isOnSaleAt', () => {
  it('開始・終了が無ければ終日販売', () => {
    expect(isOnSaleAt({ sellStartTime: null, sellEndTime: null }, '03:00')).toBe(true);
    expect(isOnSaleAt({ sellStartTime: '11:00:00', sellEndTime: null }, '03:00')).toBe(true);
  });

  it('通常の時間帯を判定する', () => {
    const lunch = { sellStartTime: '11:00:00', sellEndTime: '15:00:00' };
    expect(isOnSaleAt(lunch, '11:00')).toBe(true);
    expect(isOnSaleAt(lunch, '14:59')).toBe(true);
    // 終了時刻ちょうどは販売中（QRのサーバー側判定 between と揃える）
    expect(isOnSaleAt(lunch, '15:00')).toBe(true);
    expect(isOnSaleAt(lunch, '15:01')).toBe(false);
    expect(isOnSaleAt(lunch, '10:59')).toBe(false);
  });

  it('日をまたぐ時間帯を判定する', () => {
    const late = { sellStartTime: '22:00:00', sellEndTime: '02:00:00' };
    expect(isOnSaleAt(late, '23:30')).toBe(true);
    expect(isOnSaleAt(late, '01:59')).toBe(true);
    expect(isOnSaleAt(late, '02:00')).toBe(true);
    expect(isOnSaleAt(late, '02:01')).toBe(false);
    expect(isOnSaleAt(late, '12:00')).toBe(false);
  });

  it('読めない値は終日販売として扱う（商品を隠さない）', () => {
    expect(isOnSaleAt({ sellStartTime: 'abc', sellEndTime: '15:00' }, '12:00')).toBe(true);
    expect(isOnSaleAt({ sellStartTime: '11:00', sellEndTime: '15:00' }, '？？')).toBe(true);
  });
});

describe('handyTabOf（上のタブ：1 単品／2 コース・飲み放題／3 サービス）', () => {
  it('フード・ドリンク・種類が分からない商品は単品', () => {
    expect(handyTabOf('food', false)).toBe('alacarte');
    expect(handyTabOf('drink', false)).toBe('alacarte');
    expect(handyTabOf('mystery', false)).toBe('alacarte');
    expect(handyTabOf(null, false)).toBe('alacarte');
  });

  it('コースの商品と「プランのときだけ」のカテゴリの商品はコース・飲み放題', () => {
    expect(handyTabOf('course', false)).toBe('plan');
    expect(handyTabOf('drink', true)).toBe('plan');
    expect(handyTabOf('food', true)).toBe('plan');
  });

  it('サービス（オプション）はプランのカテゴリに入っていてもサービス', () => {
    expect(handyTabOf('option', false)).toBe('service');
    expect(handyTabOf('option', true)).toBe('service');
  });
});

describe('buildHandyTabs', () => {
  const categories = [
    category('c-soup', 'SOUP', 'kitchen', 10),
    category('c-app', 'APPETIZER', 'kitchen', 20),
    category('c-salad', 'SALAD', 'kitchen', 30),
    category('c-beer', 'BEER', 'drink', 40),
    category('c-fsoft', '(F) SOFT DRINK', 'drink', 50),
    category('c-course', 'Course', 'kitchen', 60),
    category('c-opt', 'オプション', 'kitchen', 70),
  ];
  const items = [
    item('i-soup2', 'c-soup', 'food', { sortOrder: 2 }),
    item('i-soup1', 'c-soup', 'food', { sortOrder: 1 }),
    item('i-app', 'c-app', 'food'),
    item('i-salad', 'c-salad', 'food'),
    item('i-beer', 'c-beer', 'drink'),
    item('i-ftea', 'c-fsoft', 'drink', { price: 0 }),
    item('i-plan', 'c-course', 'course'),
    item('i-opt', 'c-opt', 'option'),
  ];
  const planCategoryIds = new Set(['c-fsoft']);

  it('上のタブを 単品 → コース・飲み放題 → サービス の順に作る（フードとドリンクは同じ単品）', () => {
    const tabs = buildHandyTabs(categories, items, '12:00', { planCategoryIds });
    expect(tabs.map((t) => t.id)).toEqual(['alacarte', 'plan', 'service']);
    expect(tabs.map((t) => t.label)).toEqual(['単品', 'コース・飲み放題', 'サービス']);
    const alacarte = tabs[0];
    expect(alacarte.pages.map((p) => p.label)).toEqual(['SOUP', 'APPETIZER', 'SALAD', 'BEER']);
    expect(alacarte.itemCount).toBe(5);
    // カテゴリ内は sort_order 順
    expect(alacarte.pages[0].categories[0].items.map((i) => i.id)).toEqual(['i-soup1', 'i-soup2']);
  });

  it('飲み放題の中身（プランのときだけのカテゴリ）とコースの商品は 2 コース・飲み放題 に出す', () => {
    const tabs = buildHandyTabs(categories, items, '12:00', { planCategoryIds });
    const plan = tabs.find((t) => t.id === 'plan');
    expect(plan?.pages.map((p) => p.label)).toEqual(['(F) SOFT DRINK', 'Course']);
    const service = tabs.find((t) => t.id === 'service');
    expect(service?.pages.flatMap((p) => p.categories.flatMap((c) => c.items)).map((i) => i.id)).toEqual(['i-opt']);
  });

  it('メニューブックのページ：前のカテゴリと同じページのカテゴリを1つのタイルにまとめる', () => {
    const tabs = buildHandyTabs(categories, items, '12:00', {
      planCategoryIds,
      pages: { joinPrev: ['c-app', 'c-salad'], pageNames: {} },
    });
    const pages = tabs[0].pages;
    expect(pages.map((p) => p.label)).toEqual(['SOUP・APPETIZER・SALAD', 'BEER']);
    expect(pages[0].key).toBe('c-soup');
    expect(pages[0].categories.map((c) => c.name)).toEqual(['SOUP', 'APPETIZER', 'SALAD']);
    expect(pages[0].itemCount).toBe(4);
  });

  it('ページに名前を付けたらその名前を出す', () => {
    const tabs = buildHandyTabs(categories, items, '12:00', {
      pages: { joinPrev: ['c-app', 'c-salad'], pageNames: { 'c-soup': '前菜' } },
    });
    expect(tabs[0].pages[0].label).toBe('前菜');
    expect(tabs[0].pages[0].name).toBe('前菜');
  });

  it('ページの途中のカテゴリに商品が無くても、区切りは変わらない', () => {
    const withoutAppetizer = items.filter((i) => i.id !== 'i-app');
    const tabs = buildHandyTabs(categories, withoutAppetizer, '12:00', {
      planCategoryIds,
      pages: { joinPrev: ['c-app', 'c-salad'], pageNames: {} },
    });
    expect(tabs[0].pages.map((p) => p.label)).toEqual(['SOUP・SALAD', 'BEER']);
  });

  it('ページの先頭のカテゴリが出ない時間帯でも、同じページの残りはまとまったまま', () => {
    const withoutSoup = items.filter((i) => !i.id.startsWith('i-soup'));
    const tabs = buildHandyTabs(categories, withoutSoup, '12:00', {
      pages: { joinPrev: ['c-app', 'c-salad'], pageNames: { 'c-soup': '前菜' } },
    });
    expect(tabs[0].pages[0].label).toBe('前菜');
    expect(tabs[0].pages[0].categories.map((c) => c.name)).toEqual(['APPETIZER', 'SALAD']);
  });

  it('タブが違うカテゴリはページにまとめてもタブごとに分かれる', () => {
    const tabs = buildHandyTabs(categories, items, '12:00', {
      planCategoryIds,
      pages: { joinPrev: ['c-fsoft'], pageNames: {} },
    });
    expect(tabs[0].pages.map((p) => p.label)).toEqual(['SOUP', 'APPETIZER', 'SALAD', 'BEER']);
    expect(tabs[1].pages.map((p) => p.label)).toEqual(['(F) SOFT DRINK', 'Course']);
  });

  it('商品が無いタブは出さない', () => {
    const tabs = buildHandyTabs(categories, [item('i-beer', 'c-beer', 'drink')], '12:00');
    expect(tabs.map((t) => t.id)).toEqual(['alacarte']);
  });

  it('カテゴリが無い・削除済みの商品はレジと同じく出さない', () => {
    expect(buildHandyTabs(categories, [item('i-x', null, 'food')], '12:00')).toEqual([]);
    expect(buildHandyTabs(categories, [item('i-y', 'c-deleted', 'food')], '12:00')).toEqual([]);
  });

  it('販売時間外の商品に offHours を立てる（一覧からは消さない）', () => {
    const lunchOnly = item('i-lunch', 'c-soup', 'food', {
      sellStartTime: '11:00:00',
      sellEndTime: '15:00:00',
    });
    const at12 = buildHandyTabs(categories, [lunchOnly], '12:00');
    expect(at12[0].pages[0].categories[0].items[0].offHours).toBe(false);
    const at20 = buildHandyTabs(categories, [lunchOnly], '20:00');
    expect(at20[0].pages[0].categories[0].items[0].offHours).toBe(true);
  });
});

describe('initialHandyTab（開いたときのタブ）', () => {
  const categories = [category('c-beer', 'BEER', 'drink', 1), category('c-fsoft', '(F) SOFT DRINK', 'drink', 2)];
  const planCategoryIds = new Set(['c-fsoft']);

  it('飲み放題の卓で中身が出ていれば 2 コース・飲み放題 から開く', () => {
    const tabs = buildHandyTabs(
      categories,
      [item('i-beer', 'c-beer', 'drink'), item('i-ftea', 'c-fsoft', 'drink', { price: 0 })],
      '20:00',
      { planCategoryIds }
    );
    expect(initialHandyTab(tabs, planCategoryIds, true)).toBe('plan');
  });

  it('プランの無い卓・中身が出ていない卓は先頭のタブ', () => {
    const tabs = buildHandyTabs(categories, [item('i-beer', 'c-beer', 'drink')], '20:00', { planCategoryIds });
    expect(initialHandyTab(tabs, planCategoryIds, false)).toBe('alacarte');
    expect(initialHandyTab(tabs, planCategoryIds, true)).toBe('alacarte');
    expect(initialHandyTab([], planCategoryIds, true)).toBeNull();
  });
});

describe('カート', () => {
  const base = {
    menuItemId: 'm1',
    name: 'バターチキン',
    nameEn: null,
    unitPrice: 1180,
    optionItemIds: [] as string[],
    optionLabel: '',
  };

  it('選択肢の並び順が違っても同じ行としてまとめる', () => {
    expect(cartLineKey('m1', ['b', 'a'])).toBe(cartLineKey('m1', ['a', 'b']));
    expect(cartLineKey('m1', ['a'])).not.toBe(cartLineKey('m2', ['a']));
  });

  it('同じ商品・同じ選択肢は数量を足す', () => {
    let lines = addCartLine([], base, 1);
    lines = addCartLine(lines, base, 2);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
  });

  it('選択肢が違えば別の行になる', () => {
    let lines = addCartLine([], base, 1);
    lines = addCartLine(lines, { ...base, optionItemIds: ['o1'], unitPrice: 1330 }, 1);
    expect(lines).toHaveLength(2);
    expect(cartTotal(lines)).toBe(1180 + 1330);
    expect(cartCount(lines)).toBe(2);
  });

  it('数量の上限を超えて増えない', () => {
    const lines = addCartLine([], base, MAX_LINE_QUANTITY + 5);
    expect(lines[0].quantity).toBe(MAX_LINE_QUANTITY);
    const more = addCartLine(lines, base, 3);
    expect(more[0].quantity).toBe(MAX_LINE_QUANTITY);
  });

  it('0になった行は取り除く', () => {
    const lines: HandyCartLine[] = addCartLine([], base, 1);
    const removed = changeCartQuantity(lines, lines[0].key, -1);
    expect(removed).toHaveLength(0);
    expect(cartTotal(removed)).toBe(0);
  });

  it('空のカートの合計は0', () => {
    expect(cartTotal([])).toBe(0);
    expect(cartCount([])).toBe(0);
  });
});

describe('呼び出し', () => {
  const call = (id: string, tableId: string, kind: 'staff' | 'checkout', min: number): HandyServiceCall => ({
    id,
    tableId,
    tableName: tableId,
    kind,
    createdAtMs: Date.parse('2026-09-21T10:00:00Z') + min * 60_000,
    note: null,
  });

  it('古い順（待たせている順）に並べる', () => {
    const sorted = sortServiceCalls([call('c', 'T-2', 'staff', 5), call('a', 'T-1', 'staff', 1)]);
    expect(sorted.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('同じ卓では会計希望を優先して強調する', () => {
    const tone = callToneByTable([call('a', 'T-1', 'staff', 1), call('b', 'T-1', 'checkout', 2)]);
    expect(tone.get('T-1')).toBe('checkout');
  });

  it('呼び出しの無い卓は強調しない', () => {
    const tone = callToneByTable([call('a', 'T-1', 'staff', 1)]);
    expect(tone.get('T-9')).toBeUndefined();
  });
});

describe('elapsedLabel', () => {
  const t0 = Date.parse('2026-09-21T09:00:00Z');

  it('1時間未満は分で出す', () => {
    expect(elapsedLabel(t0, t0)).toBe('0分');
    expect(elapsedLabel(t0, t0 + 45 * 60_000)).toBe('45分');
    expect(elapsedLabel(t0, t0 + 59 * 60_000 + 59_000)).toBe('59分');
  });

  it('1時間以上は時間と分で出す', () => {
    expect(elapsedLabel(t0, t0 + 60 * 60_000)).toBe('1時間00分');
    expect(elapsedLabel(t0, t0 + 125 * 60_000)).toBe('2時間05分');
  });

  it('未来の開始時刻でもマイナス表示にしない', () => {
    expect(elapsedLabel(t0 + 60_000, t0)).toBe('0分');
  });
});

describe('tableState', () => {
  it('未会計伝票があれば利用中', () => {
    expect(tableState('available', true)).toBe('occupied');
    expect(tableState('seated', false)).toBe('occupied');
  });

  it('伝票が無ければテーブルの状態で決まる', () => {
    expect(tableState('available', false)).toBe('available');
    expect(tableState('cleaning', false)).toBe('cleaning');
    expect(tableState('reserved', false)).toBe('reserved');
    // 使用不可（フロア画面の「使用不可にする」）は DB では 'unavailable'
    expect(tableState('unavailable', false)).toBe('blocked');
    expect(tableState('ordering', false)).toBe('occupied');
    expect(tableState('billing', false)).toBe('occupied');
    expect(tableState('waiting', false)).toBe('available');
    expect(tableState(null, false)).toBe('available');
  });
});
