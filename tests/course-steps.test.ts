import { describe, it, expect } from 'vitest';
import {
  MAX_COURSE_STEPS,
  courseStepsFrom,
  expandCourseRows,
  normalizeStepIds,
  type CourseDish,
} from '@/lib/course-steps';
import { groupKitchenTickets, layoutKitchenTicket, ordinalEn, ticketSlips, type ClaimedKitchenItem } from '@/lib/kitchen-ticket';

const row = (over: Partial<ClaimedKitchenItem>): ClaimedKitchenItem => ({
  order_item_id: 'oi-course',
  order_id: 'o1',
  order_no: 6700,
  table_name: 'T3',
  guest_count: 4,
  clerk_name: 'Ronnie',
  item_name: '(4800/2H) Girls party 12 (adult)',
  item_name_en: '(4800/2H) Girls party 12 (adult)',
  modifiers: [],
  memo: null,
  station: 'kitchen',
  delta: 4,
  ...over,
});

const dish = (id: string, name: string, nameEn: string | null = null): CourseDish => ({ id, name, nameEn, nameKana: null });

// 宮崎さんの手書きの順番: 1 前菜 / 2 サラダ / 3 ポテト / 4 チキン / 5 ステーキ / 6 メイン / 7 デザート
const DISHES = new Map<string, CourseDish>([
  ['d-zensai', dish('d-zensai', '前菜', 'Appetizer')],
  ['d-salad', dish('d-salad', 'サラダ', 'Salad')],
  ['d-potato', dish('d-potato', 'ポテト', 'Potato')],
  ['d-chicken', dish('d-chicken', 'チキン', 'Chicken')],
  ['d-steak', dish('d-steak', 'ステーキ', 'Steak')],
  ['d-main', dish('d-main', 'メイン', 'Main')],
  ['d-dessert', dish('d-dessert', 'デザート', 'Dessert')],
]);
const ORDER = ['d-zensai', 'd-salad', 'd-potato', 'd-chicken', 'd-steak', 'd-main', 'd-dessert'];
const STEPS = { 'course-a': ORDER };
const MENU_IDS = new Map<string, string | null>([
  ['oi-course', 'course-a'],
  ['oi-curry', 'm-curry'],
]);

describe('ordinalEn', () => {
  it('1st 2nd 3rd 4th … 11th 12th 13th 21st 22nd', () => {
    expect([1, 2, 3, 4, 7, 10, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinalEn)).toEqual([
      '1st', '2nd', '3rd', '4th', '7th', '10th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th',
    ]);
  });
});

describe('courseStepsFrom / normalizeStepIds', () => {
  it('未設定・壊れた値は空（これまでどおり）', () => {
    expect(courseStepsFrom(null)).toEqual({});
    expect(courseStepsFrom({})).toEqual({});
    expect(courseStepsFrom({ courseSteps: 'x' })).toEqual({});
    expect(courseStepsFrom({ courseSteps: [1, 2] })).toEqual({});
    expect(courseStepsFrom({ courseSteps: { a: 'x', b: [], c: [1, null] } })).toEqual({});
  });

  it('順番どおり読み、重複・空・文字列以外は外す', () => {
    expect(courseStepsFrom({ courseSteps: { a: ['x', ' y ', 'x', '', 5, 'z'] } })).toEqual({ a: ['x', 'y', 'z'] });
  });

  it('料理の数には上限がある', () => {
    const many = Array.from({ length: MAX_COURSE_STEPS + 10 }, (_, i) => `d${i}`);
    expect(normalizeStepIds(many)).toHaveLength(MAX_COURSE_STEPS);
    expect(normalizeStepIds('nope')).toEqual([]);
  });
});

describe('expandCourseRows', () => {
  it('コースの行を、決めた順の料理の行に置き換える（数は人数ぶん）', () => {
    const out = expandCourseRows([row({})], MENU_IDS, STEPS, DISHES);
    expect(out.map((r) => r.item_name)).toEqual(['前菜', 'サラダ', 'ポテト', 'チキン', 'ステーキ', 'メイン', 'デザート']);
    expect(out.map((r) => r.course_step?.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(out.every((r) => r.delta === 4 && r.course_step?.total === 7)).toBe(true);
    expect(out[0].course_step?.course).toBe('(4800/2H) Girls party 12 (adult)');
    expect(out[0].item_name_en).toBe('Appetizer');
  });

  it('コースでない商品・料理を決めていないコースはそのまま', () => {
    const curry = row({ order_item_id: 'oi-curry', item_name: 'チキンカレー', item_name_en: null, delta: 1 });
    expect(expandCourseRows([curry], MENU_IDS, STEPS, DISHES)).toEqual([curry]);
    const other = row({ order_item_id: 'oi-course' });
    expect(expandCourseRows([other], MENU_IDS, {}, DISHES)).toEqual([other]);
    // order_item_id が無い行（古い呼び出し）もそのまま
    const noId = row({ order_item_id: undefined });
    expect(expandCourseRows([noId], MENU_IDS, STEPS, DISHES)).toEqual([noId]);
  });

  it('メニューから無くなった料理は飛ばして、残りを順に出す（番号は詰める）', () => {
    const partial = new Map(DISHES);
    partial.delete('d-salad');
    partial.delete('d-potato');
    const out = expandCourseRows([row({})], MENU_IDS, STEPS, partial);
    expect(out.map((r) => r.item_name)).toEqual(['前菜', 'チキン', 'ステーキ', 'メイン', 'デザート']);
    expect(out.map((r) => r.course_step?.index)).toEqual([1, 2, 3, 4, 5]);
    expect(out[0].course_step?.total).toBe(5);
  });

  it('料理が1つも見つからないコースは、コースの行のまま出す（伝票を落とさない）', () => {
    const r = row({});
    expect(expandCourseRows([r], MENU_IDS, STEPS, new Map())).toEqual([r]);
  });

  it('取消は各料理の取消になり、選択肢とメモは全部の料理に付く', () => {
    const out = expandCourseRows(
      [row({ delta: -2, modifiers: [{ name: 'ピザ', name_en: 'Pizza' }], memo: 'えび抜き' })],
      MENU_IDS,
      STEPS,
      DISHES
    );
    expect(out).toHaveLength(7);
    expect(out.every((r) => r.delta === -2 && r.memo === 'えび抜き' && r.modifiers?.[0].name === 'ピザ')).toBe(true);
  });
});

describe('コースの厨房伝票', () => {
  const opts = { title: 'キッチン', titleEn: 'KITCHEN', printedAt: '18:21', paperWidth: 80 as const, language: 'en' as const };

  it('1枚に 1st … 7th の順に出て、コース名は見出しに1回だけ（宮崎さんの手書きの形）', () => {
    const rows = expandCourseRows([row({})], MENU_IDS, STEPS, DISHES);
    const [t] = groupKitchenTickets(rows);
    const texts = layoutKitchenTicket(t, opts).map((l) => l.text);
    const heads = texts.filter((x) => /^\d+(st|nd|rd|th) /.test(x));
    expect(heads).toEqual([
      '1st Appetizer  x4',
      '2nd Salad  x4',
      '3rd Potato  x4',
      '4th Chicken  x4',
      '5th Steak  x4',
      '6th Main  x4',
      '7th Dessert  x4',
    ]);
    // コース名は卓名・伝票番号の下に1回。行ごとには出さない
    expect(texts.filter((x) => x === '[(4800/2H) Girls party 12 (adult)]')).toHaveLength(1);
    expect(texts.some((x) => x === '   [(4800/2H) Girls party 12 (adult)]')).toBe(false);
    expect(texts.indexOf('[(4800/2H) Girls party 12 (adult)]')).toBeLessThan(texts.indexOf('1st Appetizer  x4'));
  });

  it('商品の種類ごとに1枚（既定）でも、コースの料理は1枚にまとめて 1st→7th の順。単品は1商品1枚', () => {
    const single = row({ order_item_id: 'oi-curry', item_name: 'ナン', item_name_en: 'Naan', delta: 2 });
    const rows = [...expandCourseRows([row({})], MENU_IDS, STEPS, DISHES), single];
    const [t] = groupKitchenTickets(rows);
    const slips = ticketSlips(t, 'item');
    expect(slips).toHaveLength(2);
    expect(slips[0].lines.map((l) => l.step?.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(slips[0].part).toEqual({ index: 1, total: 2 });
    expect(slips[1].lines.map((l) => l.name)).toEqual(['ナン']);
    // 2つの違うコースは別の紙。追加と取消も別の紙
    const b = row({ order_item_id: 'oi-course-b', item_name: 'Course B', item_name_en: 'Course B' });
    const ids = new Map(MENU_IDS).set('oi-course-b', 'course-b');
    const steps = { ...STEPS, 'course-b': ['d-salad', 'd-main'] };
    const cancel = row({ delta: -1 });
    const [t2] = groupKitchenTickets(expandCourseRows([row({}), b, cancel], ids, steps, DISHES));
    const slips2 = ticketSlips(t2, 'item');
    expect(slips2.map((s) => s.lines.map((l) => `${l.delta > 0 ? '+' : '-'}${l.step?.course}`).join(','))).toEqual([
      '-(4800/2H) Girls party 12 (adult),-(4800/2H) Girls party 12 (adult),-(4800/2H) Girls party 12 (adult),-(4800/2H) Girls party 12 (adult),-(4800/2H) Girls party 12 (adult),-(4800/2H) Girls party 12 (adult),-(4800/2H) Girls party 12 (adult)',
      '+(4800/2H) Girls party 12 (adult),+(4800/2H) Girls party 12 (adult),+(4800/2H) Girls party 12 (adult),+(4800/2H) Girls party 12 (adult),+(4800/2H) Girls party 12 (adult),+(4800/2H) Girls party 12 (adult),+(4800/2H) Girls party 12 (adult)',
      '+Course B,+Course B',
    ]);
    expect(slips2[2].lines.map((l) => l.name)).toEqual(['サラダ', 'メイン']);
  });

  it('コースを2回注文したら、同じ番号の料理は数をまとめる（順番は崩れない）', () => {
    const a = row({ order_item_id: 'oi-course', delta: 2 });
    const b = row({ order_item_id: 'oi-course-2', delta: 3 });
    const ids = new Map(MENU_IDS).set('oi-course-2', 'course-a');
    const [t] = groupKitchenTickets(expandCourseRows([a, b], ids, STEPS, DISHES));
    expect(t.lines.map((l) => `${l.step?.index}:${l.delta}`)).toEqual(['1:5', '2:5', '3:5', '4:5', '5:5', '6:5', '7:5']);
  });

  it('単品の同じ名前の商品とは、コースの料理を混ぜない', () => {
    const single = row({ order_item_id: 'oi-curry', item_name: '前菜', item_name_en: 'Appetizer', delta: 1 });
    const [t] = groupKitchenTickets([...expandCourseRows([row({})], MENU_IDS, STEPS, DISHES), single]);
    const zensai = t.lines.filter((l) => l.name === '前菜');
    expect(zensai).toHaveLength(2);
    expect(zensai.map((l) => l.delta).sort()).toEqual([1, 4]);
  });

  it('取消のコースは各料理が CANCEL で、番号付きで出る', () => {
    const rows = expandCourseRows([row({ delta: -1 })], MENU_IDS, STEPS, DISHES);
    const [t] = groupKitchenTickets(rows);
    const texts = layoutKitchenTicket(t, opts).map((l) => l.text);
    expect(texts).toContain('*** CANCEL ***');
    expect(texts.filter((x) => x === '[CANCEL]')).toHaveLength(7);
    expect(texts).toContain('1st Appetizer  x1');
  });

  it('コースの料理を決めていない店は、これまでと同じ（コース名だけ）', () => {
    const [t] = groupKitchenTickets(expandCourseRows([row({})], MENU_IDS, {}, DISHES));
    expect(t.lines).toHaveLength(1);
    expect(layoutKitchenTicket(t, opts).map((l) => l.text).some((x) => /^\d+(st|nd|rd|th) /.test(x))).toBe(false);
  });
});
