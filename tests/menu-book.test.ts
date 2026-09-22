import { describe, it, expect } from 'vitest';
import {
  autoCategoryShow,
  categoryShow,
  effectiveShow,
  emptyMenuBook,
  filterMenuBook,
  filterNestedMenu,
  groupMenuPages,
  isPlanAddOn,
  isPlanItem,
  isPlanOnlyItem,
  isWithinHm,
  menuBookFrom,
  menuBookToJson,
  menuPageLabel,
  moveInList,
  nestedMenuPages,
  normalizePageName,
  orderPlanState,
  PAGE_NAME_MAX,
  planCategoryIds,
  planPagesFirst,
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

  it('アップグレード（A→AB）にも出すカテゴリを決められる：A＋アップグレードの卓は AB のカテゴリだけ（2026-09-22 御茶ノ水）', () => {
    const planA = id(60);
    const upAtoAB = id(62);
    const book: MenuBookSettings = {
      ...emptyMenuBook(),
      plans: { [planA]: [C.fSoft.id], [upAtoAB]: [C.fSoft.id, C.fBeer.id] },
    };
    const r = filterMenuBook(categories, items, book, ctx({ plan: { hasPlan: true, planItemIds: [planA, upAtoAB] } }));
    expect(names(r.categories)).toEqual(expect.arrayContaining(['(F) SOFT DRINK', '(F) BEER']));
    // ABC だけのカテゴリ・コースの中身は出さない（決めていないと全部出ていた）
    expect(names(r.categories)).not.toContain('(F/C) WHISKEY&SPARKLING');
    expect(names(r.categories)).not.toContain('Course food');
  });

  it('プランとして数える商品（メニューブックの「プランで出すカテゴリ」に並べる）とアップグレード・延長の見分け', () => {
    expect(isPlanItem('course', '(AB) 2H Course Nomihodai')).toBe(true);
    expect(isPlanItem('course', 'Nomihoudai ABC')).toBe(true);
    expect(isPlanItem('drink', '飲み放題 (A→AB)')).toBe(true);
    expect(isPlanItem('drink', 'コース飲み放題 (A→B)')).toBe(true);
    // 名前に飲み放題が無い延長・席料はプランとして数えない（並べない）
    expect(isPlanItem('drink', '延長 (30min)')).toBe(false);
    expect(isPlanItem('food', '席料')).toBe(false);
    expect(isPlanAddOn('飲み放題 (A→AB)')).toBe(true);
    expect(isPlanAddOn('飲み放題延長 30分')).toBe(true);
    expect(isPlanAddOn('(AB) 2H Course Nomihodai')).toBe(false);
    // 伝票のプラン判定と同じ
    expect(orderPlanState([{ menuItemId: id(62), name: '飲み放題 (A→AB)', itemType: 'drink', status: 'active' }])).toEqual({
      hasPlan: true,
      planItemIds: [id(62)],
    });
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

describe('メニューブック画面の並び替え', () => {
  it('上へ・下へ・先頭へ・最後へ（範囲外は端に寄せる）', () => {
    const list = ['A', 'B', 'C', 'D'];
    expect(moveInList(list, 2, 1)).toEqual(['A', 'C', 'B', 'D']);
    expect(moveInList(list, 1, 2)).toEqual(['A', 'C', 'B', 'D']);
    expect(moveInList(list, 3, 0)).toEqual(['D', 'A', 'B', 'C']);
    expect(moveInList(list, 0, 3)).toEqual(['B', 'C', 'D', 'A']);
    expect(moveInList(list, 0, -1)).toEqual(list);
    expect(moveInList(list, 3, 99)).toEqual(list);
    expect(moveInList(list, 9, 0)).toEqual(list);
    // 元の配列は変えない
    expect(list).toEqual(['A', 'B', 'C', 'D']);
  });

  it('「自動」は自動判定の結果を使う', () => {
    expect(effectiveShow('auto', 'plan')).toBe('plan');
    expect(effectiveShow('always', 'plan')).toBe('always');
  });
});

describe('メニューブック：ページ（ハンディ・お客様QRのタブのまとめ方）', () => {
  const P = {
    soup: { id: id(21), name: 'SOUP' },
    appetizer: { id: id(22), name: 'APPETIZER' },
    salad: { id: id(23), name: 'SALAD' },
    alacarte: { id: id(24), name: 'ALACARTE' },
    beer: { id: id(25), name: 'BEER' },
  };
  const ordered = Object.values(P);
  const book = (joinPrev: string[], pageNames: Record<string, string> = {}) => ({ joinPrev, pageNames });

  it('前のカテゴリと同じページのカテゴリを1ページにまとめる（SOUP・APPETIZER・SALAD）', () => {
    const pages = groupMenuPages(ordered, book([P.appetizer.id, P.salad.id]));
    expect(pages.map((p) => names(p.categories))).toEqual([['SOUP', 'APPETIZER', 'SALAD'], ['ALACARTE'], ['BEER']]);
    expect(pages[0].key).toBe(P.soup.id);
    expect(menuPageLabel(pages[0], (c) => c.name)).toBe('SOUP・APPETIZER・SALAD');
  });

  it('何も設定していなければ1カテゴリ1ページ（これまでと同じ）', () => {
    expect(groupMenuPages(ordered, book([])).map((p) => p.categories.length)).toEqual([1, 1, 1, 1, 1]);
  });

  it('先頭のカテゴリは前が無いのでつなげない', () => {
    const pages = groupMenuPages(ordered, book([P.soup.id]));
    expect(pages).toHaveLength(5);
  });

  it('名前はページの先頭カテゴリに付く。出さないカテゴリがあっても区切り・名前は変わらない', () => {
    const b = book([P.appetizer.id, P.salad.id], { [P.soup.id]: '前菜' });
    const pages = groupMenuPages(ordered, b, (c) => c.id !== P.soup.id);
    expect(pages[0].name).toBe('前菜');
    expect(names(pages[0].categories)).toEqual(['APPETIZER', 'SALAD']);
    expect(menuPageLabel(pages[0], (c) => c.name)).toBe('前菜');
    // 1つも残らないページは返さない
    expect(groupMenuPages(ordered, b, (c) => c.id === P.beer.id).map((p) => p.key)).toEqual([P.beer.id]);
  });

  it('プランのある卓：プランのカテゴリのページを先に（混ざったページはプランの分だけ前へ）', () => {
    const cats = [P.soup, C.fSoft, C.fBeer, P.beer];
    const pages = groupMenuPages(cats, book([C.fSoft.id, C.fBeer.id], { [P.soup.id]: '混ぜたページ' }));
    expect(pages.map((p) => names(p.categories))).toEqual([['SOUP', '(F) SOFT DRINK', '(F) BEER'], ['BEER']]);
    const planIds = new Set([C.fSoft.id, C.fBeer.id]);
    const ordered2 = planPagesFirst(pages, (c) => planIds.has(c.id));
    expect(ordered2.map((p) => names(p.categories))).toEqual([['(F) SOFT DRINK', '(F) BEER'], ['SOUP'], ['BEER']]);
    // 分けたページは名前を付けない（カテゴリ名をつなげて出す）
    expect(ordered2[0].name).toBeNull();
    expect(ordered2[1].name).toBeNull();
    expect(ordered2[0].key).toBe(`${P.soup.id}:plan`);
  });

  it('「プランのときだけ」のカテゴリ（設定・自動）', () => {
    const ids = planCategoryIds(categories, items, emptyMenuBook());
    expect(ids.has(C.fSoft.id)).toBe(true);
    expect(ids.has(C.courseFood.id)).toBe(true);
    expect(ids.has(C.meat.id)).toBe(false);
    const custom: MenuBookSettings = { ...emptyMenuBook(), categories: { [C.meat.id]: 'plan', [C.fSoft.id]: 'always' } };
    const customIds = planCategoryIds(categories, items, custom);
    expect(customIds.has(C.meat.id)).toBe(true);
    expect(customIds.has(C.fSoft.id)).toBe(false);
  });

  it('お客様QR：飲み放題の卓は飲み放題のページが先頭、アラカルトの卓はプランのページを出さない', () => {
    const nested = [
      { id: P.soup.id, name: 'SOUP', items: [{ name: 'スープ', price: 880 }] },
      { id: P.appetizer.id, name: 'APPETIZER', items: [{ name: 'ナチョス', price: 1080 }] },
      { id: C.soft.id, name: 'SOFT DRINK', items: [{ name: 'ウーロン茶', price: 480 }] },
      { id: C.fSoft.id, name: '(F) SOFT DRINK', items: [{ name: 'F. ウーロン茶', price: 0 }] },
      { id: C.fBeer.id, name: '(F) BEER', items: [{ name: 'F. 生ビール', price: 0 }] },
    ];
    const b: MenuBookSettings = { ...emptyMenuBook(), joinPrev: [P.appetizer.id, C.fBeer.id] };
    const planState = { hasPlan: true, planItemIds: [] };
    const visiblePlan = filterNestedMenu(nested, b, ctx({ plan: planState }));
    const planPages = nestedMenuPages(nested, visiblePlan, b, planState);
    expect(planPages.map((p) => p.categoryIds)).toEqual([[C.fSoft.id, C.fBeer.id], [P.soup.id, P.appetizer.id], [C.soft.id]]);
    expect(planPages.map((p) => p.plan)).toEqual([true, false, false]);

    const visibleAlaCarte = filterNestedMenu(nested, b, ctx());
    const alaCartePages = nestedMenuPages(nested, visibleAlaCarte, b, ALA_CARTE);
    expect(alaCartePages.map((p) => p.categoryIds)).toEqual([[P.soup.id, P.appetizer.id], [C.soft.id]]);
  });

  it('設定の読み込み・保存の形（壊れた値は捨てる・名前は整える）', () => {
    const b = menuBookFrom({
      menuBook: {
        joinPrev: [P.appetizer.id, P.appetizer.id, 'bad', 3],
        pageNames: { [P.soup.id]: '  前菜   メニュー ', [P.beer.id]: '   ', bad: 'x', [P.salad.id]: 5 },
      },
    });
    expect(b.joinPrev).toEqual([P.appetizer.id]);
    expect(b.pageNames).toEqual({ [P.soup.id]: '前菜 メニュー' });
    expect(menuBookToJson(b)).toEqual({
      categories: {},
      plans: {},
      lunch: { start: '10:00', end: '16:00' },
      joinPrev: [P.appetizer.id],
      pageNames: { [P.soup.id]: '前菜 メニュー' },
    });
    expect(normalizePageName('あ'.repeat(PAGE_NAME_MAX + 5))).toHaveLength(PAGE_NAME_MAX);
    expect(normalizePageName('')).toBeNull();
    expect(normalizePageName(null)).toBeNull();
  });
});
