import { describe, it, expect } from 'vitest';
import {
  addCartLine,
  buildMenuGroups,
  callToneByTable,
  cartCount,
  cartLineKey,
  cartTotal,
  changeCartQuantity,
  classifyMenuItem,
  elapsedLabel,
  isOnSaleAt,
  MAX_LINE_QUANTITY,
  sortServiceCalls,
  tableState,
  UNCATEGORIZED_ID,
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
    expect(isOnSaleAt(lunch, '15:00')).toBe(false);
    expect(isOnSaleAt(lunch, '10:59')).toBe(false);
  });

  it('日をまたぐ時間帯を判定する', () => {
    const late = { sellStartTime: '22:00:00', sellEndTime: '02:00:00' };
    expect(isOnSaleAt(late, '23:30')).toBe(true);
    expect(isOnSaleAt(late, '01:59')).toBe(true);
    expect(isOnSaleAt(late, '02:00')).toBe(false);
    expect(isOnSaleAt(late, '12:00')).toBe(false);
  });

  it('読めない値は終日販売として扱う（商品を隠さない）', () => {
    expect(isOnSaleAt({ sellStartTime: 'abc', sellEndTime: '15:00' }, '12:00')).toBe(true);
    expect(isOnSaleAt({ sellStartTime: '11:00', sellEndTime: '15:00' }, '？？')).toBe(true);
  });
});

describe('buildMenuGroups', () => {
  const categories = [
    category('c-curry', 'カレー', 'kitchen', 1),
    category('c-dessert', 'デザート', 'dessert', 2),
    category('c-drink', 'ドリンク', 'drink', 3),
    category('c-course', 'コース', 'kitchen', 4),
    category('c-opt', '追加オプション', 'kitchen', 5),
  ];
  const items = [
    item('i-curry', 'c-curry', 'food', { sortOrder: 2 }),
    item('i-curry2', 'c-curry', 'food', { sortOrder: 1 }),
    item('i-ice', 'c-dessert', 'food'),
    item('i-beer', 'c-drink', 'drink'),
    item('i-course', 'c-course', 'course'),
    item('i-opt', 'c-opt', 'option'),
  ];

  it('分類 → カテゴリ → 商品 の3階層を作る', () => {
    const groups = buildMenuGroups(categories, items, '12:00');
    expect(groups.map((g) => g.id)).toEqual(['food', 'drink', 'course', 'service']);
    const food = groups[0];
    expect(food.itemCount).toBe(3);
    expect(food.categories.map((c) => c.name)).toEqual(['カレー', 'デザート']);
    // カテゴリ内は sort_order 順
    expect(food.categories[0].items.map((i) => i.id)).toEqual(['i-curry2', 'i-curry']);
  });

  it('商品が無い分類のタブは出さない', () => {
    const groups = buildMenuGroups(categories, [item('i-beer', 'c-drink', 'drink')], '12:00');
    expect(groups.map((g) => g.id)).toEqual(['drink']);
  });

  it('分類できない商品は「その他」にまとめる', () => {
    const groups = buildMenuGroups(categories, [item('i-x', null, 'mystery')], '12:00');
    expect(groups.map((g) => g.id)).toEqual(['other']);
    expect(groups[0].categories[0].id).toBe(UNCATEGORIZED_ID);
    expect(groups[0].categories[0].name).toBe('未分類');
  });

  it('販売時間外の商品に offHours を立てる（一覧からは消さない）', () => {
    const lunchOnly = item('i-lunch', 'c-curry', 'food', {
      sellStartTime: '11:00:00',
      sellEndTime: '15:00:00',
    });
    const at12 = buildMenuGroups(categories, [lunchOnly], '12:00');
    expect(at12[0].categories[0].items[0].offHours).toBe(false);
    const at20 = buildMenuGroups(categories, [lunchOnly], '20:00');
    expect(at20[0].categories[0].items[0].offHours).toBe(true);
  });

  it('コースとサービスを混ぜない', () => {
    const groups = buildMenuGroups(categories, items, '12:00');
    const course = groups.find((g) => g.id === 'course');
    const service = groups.find((g) => g.id === 'service');
    expect(course?.categories.flatMap((c) => c.items).map((i) => i.id)).toEqual(['i-course']);
    expect(service?.categories.flatMap((c) => c.items).map((i) => i.id)).toEqual(['i-opt']);
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
    expect(tableState('reserved', false)).toBe('blocked');
    expect(tableState(null, false)).toBe('available');
  });
});
