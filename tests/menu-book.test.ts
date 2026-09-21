import { describe, it, expect } from 'vitest';
import {
  autoCategoryShow,
  categoryShow,
  emptyMenuBook,
  filterMenuBook,
  filterNestedMenu,
  isPlanOnlyItem,
  isWithinHm,
  menuBookFrom,
  orderPlanState,
  type MenuBookContext,
  type MenuBookItemInput,
  type MenuBookSettings,
} from '@/lib/menu-book';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// FULL MOoN 御茶ノ水のカテゴリ（dinii から来た名前）
const C = {
  meat: { id: id(1), name: 'MEAT STAGE' },
  soft: { id: id(2), name: 'SOFT DRINK' },
  fSoft: { id: id(3), name: '(F) SOFT DRINK' },
  fBeer: { id: id(4), name: '(F) BEER' },
  fcWhisky: { id: id(5), name: '(F/C) WHISKEY&SPARKLING' },
  fNikuSushi: { id: id(6), name: '(F) Niku sushi' },
  free: { id: id(7), name: 'フリー' },
  choiceMain: { id: id(8), name: 'Choice Main' },
  lunchL: { id: id(9), name: '(L) Ahijo or Niku' },
  todaysLunch: { id: id(10), name: "TODAY'S LUNCH" },
  courseFood: { id: id(11), name: 'Course food' },
  others: { id: id(12), name: 'Others' },
  options: { id: id(13), name: 'オプション' },
};

const items: MenuBookItemInput[] = [
  { categoryId: C.meat.id, name: '国産牛タン 厚切りロースト', price: 1780, itemType: 'food' },
  { categoryId: C.soft.id, name: 'ウーロン茶', price: 480, itemType: 'drink' },
  { categoryId: C.soft.id, name: '水', price: 0, itemType: 'drink' },
  { categoryId: C.soft.id, name: 'F. 緑茶', price: 0, itemType: 'drink' },
  { categoryId: C.fSoft.id, name: 'F. ウーロン茶', price: 0, itemType: 'drink' },
  { categoryId: C.fBeer.id, name: 'F. 生ビール', price: 0, itemType: 'drink' },
  { categoryId: C.fcWhisky.id, name: "F. Maker'sMark ハイボール", price: 0, itemType: 'drink' },
  { categoryId: C.fNikuSushi.id, name: 'F. 和牛肉寿司', price: 0, itemType: 'food' },
  { categoryId: C.free.id, name: 'ドリンクフリー', price: 0, itemType: 'drink' },
  { categoryId: C.choiceMain.id, name: 'Choice Main', price: 0, itemType: 'food' },
  { categoryId: C.lunchL.id, name: '(L) Ahijo or Niku ryori', price: 0, itemType: 'food' },
  { categoryId: C.todaysLunch.id, name: 'Meat Lunch Plate', price: 1450, itemType: 'food' },
  { categoryId: C.courseFood.id, name: '生ハムとチーズの盛り合わせ', price: 0, itemType: 'food' },
  { categoryId: C.others.id, name: '席料', price: 300, itemType: 'food' },
  { categoryId: C.others.id, name: 'キャンセル料', price: 0, itemType: 'food' },
  { categoryId: C.options.id, name: '【Choice Main】Margerita', price: 0, itemType: 'option' },
];
const categories = Object.values(C);

const ALA_CARTE = { hasPlan: false, planItemIds: [] };
const ctx = (over: Partial<MenuBookContext> = {}): MenuBookContext => ({
  channel: 'qr',
  plan: ALA_CARTE,
  nowHm: '19:00',
  ...over,
});
const names = (cs: { name: string }[]) => cs.map((c) => c.name);

describe('メニューブック：カテゴリの自動判定', () => {
  it('飲み放題・食べ放題の中身（(F) / (F/C) / (C/F) / F.）はプランのときだけ', () => {
    for (const c of [C.fSoft, C.fBeer, C.fcWhisky, C.fNikuSushi]) expect(autoCategoryShow(c, items)).toBe('plan');
    expect(autoCategoryShow({ id: id(90), name: '(C/F) WHISKEY&HIGHBALL L' }, [])).toBe('plan');
    expect(autoCategoryShow({ id: id(91), name: '(4400) F. Order system' }, [])).toBe('plan');
    expect(autoCategoryShow({ id: id(92), name: '(3980) F. FOOD' }, [])).toBe('plan');
  });

  it('フード・ドリンクが全部0円のカテゴリ（コースの中身）もプランのときだけ', () => {
    expect(autoCategoryShow(C.courseFood, items)).toBe('plan');
    expect(autoCategoryShow(C.choiceMain, items)).toBe('plan');
  });

  it('「フリー」「FREE」（金額をレジで入れる商品）はハンディ・QRに出さない', () => {
    expect(autoCategoryShow(C.free, items)).toBe('hidden');
    expect(autoCategoryShow({ id: id(93), name: 'FREE' }, [])).toBe('hidden');
  });

  it('ランチのカテゴリはランチの時間だけ（0円のランチセットの中身も）', () => {
    expect(autoCategoryShow(C.todaysLunch, items)).toBe('lunch');
    expect(autoCategoryShow(C.lunchL, items)).toBe('lunch');
    expect(autoCategoryShow({ id: id(94), name: 'Spice Lunch Drink' }, [])).toBe('lunch');
    expect(autoCategoryShow({ id: id(95), name: 'ランチメニュー' }, [])).toBe('lunch');
  });

  it('普通のカテゴリはいつも出す（0円の水が混ざっていても・オプションだけのカテゴリも）', () => {
    expect(autoCategoryShow(C.meat, items)).toBe('always');
    expect(autoCategoryShow(C.soft, items)).toBe('always');
    expect(autoCategoryShow(C.others, items)).toBe('always');
    expect(autoCategoryShow(C.options, items)).toBe('always');
    expect(autoCategoryShow({ id: id(96), name: '空のカテゴリ' }, items)).toBe('always');
  });

  it('店長が決めた出し方は自動判定より優先', () => {
    const book: MenuBookSettings = { ...emptyMenuBook(), categories: { [C.fBeer.id]: 'always', [C.meat.id]: 'hidden' } };
    expect(categoryShow(C.fBeer, items, book)).toEqual({ show: 'always', auto: false });
    expect(categoryShow(C.meat, items, book)).toEqual({ show: 'hidden', auto: false });
    expect(categoryShow(C.soft, items, book)).toEqual({ show: 'always', auto: true });
  });
});

describe('メニューブック：F の商品', () => {
  it('「F. 」で始まる0円の商品はプランのときだけ', () => {
    expect(isPlanOnlyItem({ name: 'F. 生ビール', price: 0 })).toBe(true);
    expect(isPlanOnlyItem({ name: 'F.緑茶', price: 0 })).toBe(true);
    expect(isPlanOnlyItem({ name: '水', price: 0 })).toBe(false);
    expect(isPlanOnlyItem({ name: 'F. 生ビール', price: 500 })).toBe(false);
    expect(isPlanOnlyItem({ name: 'Fish & Chips', price: 0 })).toBe(false);
  });
});

describe('メニューブック：伝票のプラン', () => {
  it('コース・飲み放題（アップグレード含む）が入っていればプランあり', () => {
    expect(
      orderPlanState([{ menuItemId: id(50), name: '(AB) 2H Course Nomihodai', itemType: 'course', status: 'active' }])
    ).toEqual({ hasPlan: true, planItemIds: [id(50)] });
    expect(
      orderPlanState([{ menuItemId: id(51), name: '飲み放題 (A→AB)', itemType: 'drink', status: 'active' }]).hasPlan
    ).toBe(true);
    expect(
      orderPlanState([{ menuItemId: id(52), name: '2時間飲み放題 BASIC飲み放題『A』プラン', itemType: null }]).hasPlan
    ).toBe(true);
  });

  it('アラカルトの商品だけ・取消したプランはプランなし', () => {
    expect(orderPlanState([{ menuItemId: id(53), name: '水', itemType: 'drink', status: 'active' }])).toEqual(ALA_CARTE);
    expect(
      orderPlanState([{ menuItemId: id(50), name: '(AB) 2H Course Nomihodai', itemType: 'course', status: 'cancelled' }])
        .hasPlan
    ).toBe(false);
    expect(orderPlanState([]).hasPlan).toBe(false);
  });
});

describe('メニューブック：絞り込み', () => {
  it('アラカルトの卓（お客様QR）には F・コースの中身・フリーを出さない（店舗報告 2026-09-21）', () => {
    const r = filterMenuBook(categories, items, emptyMenuBook(), ctx());
    expect(names(r.categories)).toEqual(['MEAT STAGE', 'SOFT DRINK', 'Others', 'オプション']);
    // 通常カテゴリに混ざった「F. 緑茶」も外す。0円の水は残す
    expect(names(r.items)).not.toContain('F. 緑茶');
    expect(names(r.items)).toContain('水');
    expect(names(r.items)).not.toContain('F. 生ビール');
  });

  it('飲み放題の卓には F の中身を出す', () => {
    const plan = { hasPlan: true, planItemIds: [id(50)] };
    const r = filterMenuBook(categories, items, emptyMenuBook(), ctx({ plan }));
    expect(names(r.categories)).toEqual(
      expect.arrayContaining(['(F) SOFT DRINK', '(F) BEER', '(F/C) WHISKEY&SPARKLING', 'Course food', 'Choice Main'])
    );
    expect(names(r.items)).toContain('F. 緑茶');
    expect(names(r.categories)).not.toContain('フリー');
  });

  it('プランごとに出すカテゴリを決めていれば、そのカテゴリだけ（A プランに BEER は出さない）', () => {
    const planA = id(60);
    const book: MenuBookSettings = { ...emptyMenuBook(), plans: { [planA]: [C.fSoft.id] } };
    const r = filterMenuBook(categories, items, book, ctx({ plan: { hasPlan: true, planItemIds: [planA] } }));
    expect(names(r.categories)).toContain('(F) SOFT DRINK');
    expect(names(r.categories)).not.toContain('(F) BEER');
    // 指定の無いプランが一緒に入っていれば全部出す
    const r2 = filterMenuBook(categories, items, book, ctx({ plan: { hasPlan: true, planItemIds: [planA, id(61)] } }));
    expect(names(r2.categories)).toContain('(F) BEER');
  });

  it('ランチのカテゴリはランチの時間帯だけ', () => {
    const lunch = filterMenuBook(categories, items, emptyMenuBook(), ctx({ nowHm: '12:30' }));
    expect(names(lunch.categories)).toEqual(expect.arrayContaining(["TODAY'S LUNCH", '(L) Ahijo or Niku']));
    const dinner = filterMenuBook(categories, items, emptyMenuBook(), ctx({ nowHm: '19:00' }));
    expect(names(dinner.categories)).not.toContain("TODAY'S LUNCH");
    const book: MenuBookSettings = { ...emptyMenuBook(), lunch: { start: '11:30', end: '14:00' } };
    expect(names(filterMenuBook(categories, items, book, ctx({ nowHm: '14:30' })).categories)).not.toContain(
      "TODAY'S LUNCH"
    );
  });

  it('「ハンディだけ」はハンディに出してお客様QRには出さない。「出さない」はどちらにも出さない', () => {
    const book: MenuBookSettings = { ...emptyMenuBook(), categories: { [C.others.id]: 'staff', [C.meat.id]: 'hidden' } };
    expect(names(filterMenuBook(categories, items, book, ctx({ channel: 'handy' })).categories)).toContain('Others');
    expect(names(filterMenuBook(categories, items, book, ctx({ channel: 'qr' })).categories)).not.toContain('Others');
    expect(names(filterMenuBook(categories, items, book, ctx({ channel: 'handy' })).categories)).not.toContain(
      'MEAT STAGE'
    );
  });

  it('お客様QRの入れ子メニューを絞り、空になったカテゴリは外す', () => {
    const qr = [
      { ...C.soft, items: [{ name: 'ウーロン茶', price: 480 }, { name: 'F. 緑茶', price: 0 }] },
      { ...C.fBeer, items: [{ name: 'F. 生ビール', price: 0 }] },
      { id: id(97), name: 'EMPTY', items: [{ name: 'F. 水', price: 0 }] },
    ];
    const r = filterNestedMenu(qr, emptyMenuBook(), ctx());
    expect(r.map((c) => c.name)).toEqual(['SOFT DRINK']);
    expect(r[0].items.map((i) => i.name)).toEqual(['ウーロン茶']);
  });
});

describe('メニューブック：設定の読み込み・時間帯', () => {
  it('壊れた値は捨てる', () => {
    const book = menuBookFrom({
      menuBook: {
        categories: { [id(1)]: 'plan', 'not-a-uuid': 'plan', [id(2)]: 'weird' },
        plans: { [id(3)]: [id(1), id(1), 'x'], [id(4)]: 'no' },
        lunch: { start: '11:00', end: '25:00' },
      },
    });
    expect(book.categories).toEqual({ [id(1)]: 'plan' });
    expect(book.plans).toEqual({ [id(3)]: [id(1)] });
    expect(book.lunch).toEqual({ start: '10:00', end: '16:00' });
    expect(menuBookFrom(null)).toEqual(emptyMenuBook());
    expect(menuBookFrom({ menuBook: { lunch: { start: '11:30', end: '14:30' } } }).lunch).toEqual({
      start: '11:30',
      end: '14:30',
    });
  });

  it('時間帯の判定（終わりの時刻は含まない・日をまたぐ時間帯）', () => {
    expect(isWithinHm('10:00', '10:00', '16:00')).toBe(true);
    expect(isWithinHm('16:00', '10:00', '16:00')).toBe(false);
    expect(isWithinHm('23:30', '22:00', '02:00')).toBe(true);
    expect(isWithinHm('01:00', '22:00', '02:00')).toBe(true);
    expect(isWithinHm('03:00', '22:00', '02:00')).toBe(false);
  });
});
