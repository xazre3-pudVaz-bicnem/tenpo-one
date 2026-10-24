import { describe, expect, it } from 'vitest';
import {
  choicesChanged,
  COURSE_DISH_CATEGORY_NAME,
  courseMainGroupsFrom,
  defaultCategoryFor,
  isHiddenCourseDishCategory,
  MAX_MAIN_CHOICES,
  parseCourseBuilderInput,
  pickCourseMainGroup,
  planKindFlags,
  planKindOf,
  reuseDishesByName,
} from '@/lib/course-builder';
import { MAX_COURSE_STEPS } from '@/lib/course-steps';
import { isNativeSettingsPageActionType, parseNativeSettingsPageAction } from '@/lib/native-settings-pages';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const course = (over: Record<string, unknown> = {}) => ({
  kind: 'course',
  course: { id: null, name: '  おまかせ  コース ', price: 5500, durationMinutes: 120, taxRateId: null, categoryId: null, ...over },
  steps: [],
  main: { enabled: false, choices: [] },
});

describe('course builder (コース／放題プランの作成)', () => {
  it('コース：名前は前後の空白を取り、空の料理の行は捨てる', () => {
    const r = parseCourseBuilderInput({
      ...course(),
      steps: [{ name: ' 前菜 ' }, { name: '' }, { name: '   ' }, { dishId: A, name: 'シーザーサラダ' }, { name: 'デザート' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.course.name).toBe('おまかせ コース');
    expect(r.input.course.durationMinutes).toBe(120);
    expect(r.input.steps).toEqual([
      { dishId: null, name: '前菜' },
      { dishId: A, name: 'シーザーサラダ' },
      { dishId: null, name: 'デザート' },
    ]);
    expect(r.input.main).toEqual({ enabled: false, choices: [] });
    // planCategoryIds を送らなければ変えない
    expect(r.input.planCategoryIds).toBeUndefined();
  });

  it('コース：名前・値段・時間・id を確かめる', () => {
    expect(parseCourseBuilderInput(course({ name: '   ' })).ok).toBe(false);
    expect(parseCourseBuilderInput(course({ price: -1 })).ok).toBe(false);
    expect(parseCourseBuilderInput(course({ price: '4400' })).ok).toBe(true);
    expect(parseCourseBuilderInput(course({ durationMinutes: 10 })).ok).toBe(false);
    expect(parseCourseBuilderInput(course({ durationMinutes: 600 })).ok).toBe(false);
    const noTime = parseCourseBuilderInput(course({ durationMinutes: '' }));
    expect(noTime.ok && noTime.input.course.durationMinutes).toBeNull();
    expect(parseCourseBuilderInput(course({ id: 'x' })).ok).toBe(false);
    expect(parseCourseBuilderInput(course({ categoryId: 'x' })).ok).toBe(false);
    expect(parseCourseBuilderInput({ ...course(), kind: 'other' }).ok).toBe(false);
    expect(parseCourseBuilderInput(course({ name: 'あ'.repeat(121) })).ok).toBe(false);
  });

  it('料理：同じ料理が2回・多すぎる・長すぎる・壊れた id は断る', () => {
    expect(parseCourseBuilderInput({ ...course(), steps: [{ name: 'サラダ' }, { name: ' サラダ ' }] }).ok).toBe(false);
    expect(parseCourseBuilderInput({ ...course(), steps: [{ dishId: A, name: 'x' }, { dishId: A, name: 'x' }] }).ok).toBe(false);
    expect(parseCourseBuilderInput({ ...course(), steps: [{ dishId: 'nope', name: 'x' }] }).ok).toBe(false);
    expect(parseCourseBuilderInput({ ...course(), steps: [{ name: 'あ'.repeat(81) }] }).ok).toBe(false);
    const many = Array.from({ length: MAX_COURSE_STEPS + 1 }, (_, i) => ({ name: `料理${i}` }));
    expect(parseCourseBuilderInput({ ...course(), steps: many }).ok).toBe(false);
    expect(parseCourseBuilderInput({ ...course(), steps: many.slice(0, MAX_COURSE_STEPS) }).ok).toBe(true);
    // メニューから選んだ料理と同じ名前を打った
    expect(parseCourseBuilderInput({ ...course(), steps: [{ dishId: A, name: '前菜' }, { name: '前菜' }] }).ok).toBe(false);
    // Upper/lower case is the same dish
    expect(parseCourseBuilderInput({ ...course(), steps: [{ name: 'Salad' }, { name: 'salad' }] }).ok).toBe(false);
  });

  it('選べるメイン：オンなら1つ以上、追加料金は0円以上、空の行は捨てる', () => {
    const ok = parseCourseBuilderInput({
      ...course(),
      main: { enabled: true, choices: [{ name: ' 牛ステーキ ', price: 500 }, { name: '', price: 0 }, { name: '真鯛のポワレ' }] },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.input.main?.choices).toEqual([
        { name: '牛ステーキ', price: 500 },
        { name: '真鯛のポワレ', price: 0 },
      ]);
    }
    expect(parseCourseBuilderInput({ ...course(), main: { enabled: true, choices: [{ name: '  ' }] } }).ok).toBe(false);
    expect(parseCourseBuilderInput({ ...course(), main: { enabled: true, choices: [{ name: 'A', price: -100 }] } }).ok).toBe(false);
    expect(parseCourseBuilderInput({ ...course(), main: { enabled: true, choices: [{ name: 'A' }, { name: 'a' }] } }).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_MAIN_CHOICES + 1 }, (_, i) => ({ name: `M${i}` }));
    expect(parseCourseBuilderInput({ ...course(), main: { enabled: true, choices: tooMany } }).ok).toBe(false);
    // 非表示のコースには付けられない（オプションは表示の商品だけに付く）
    expect(parseCourseBuilderInput({ ...course({ hidden: true }), main: { enabled: true, choices: [{ name: 'A' }] } }).ok).toBe(false);
    // オフなら中身は見ない
    const off = parseCourseBuilderInput({ ...course(), main: { enabled: false, choices: [{ name: 'A', price: -1 }] } });
    expect(off.ok && off.input.main).toEqual({ enabled: false, choices: [] });
    // 送らなければ変えない（オプションの権限が無い iPad）
    const { main: _m, steps: _s, ...noMain } = course();
    void _m;
    void _s;
    const keep = parseCourseBuilderInput(noMain);
    expect(keep.ok && keep.input.main).toBeNull();
    expect(keep.ok && keep.input.steps).toBeNull();
    expect(parseCourseBuilderInput({ ...course(), main: 'on' }).ok).toBe(false);
  });

  it('放題プラン：種類は必須で印になる。料理・選べるメインは付けない', () => {
    const r = parseCourseBuilderInput({
      kind: 'plan',
      planKind: 'both',
      course: { name: '食べ飲み放題 120分', price: 3980, durationMinutes: 120 },
      steps: [{ name: '前菜' }],
      main: { enabled: true, choices: [{ name: 'A' }] },
      planCategoryIds: [A, B, A],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.course.includesDrinks).toBe(true);
    expect(r.input.course.includesAyce).toBe(true);
    // 放題プランは料理・選べるメインを変えない
    expect(r.input.steps).toBeNull();
    expect(r.input.main).toBeNull();
    expect(r.input.planCategoryIds).toEqual([A, B]);
    expect(parseCourseBuilderInput({ kind: 'plan', course: { name: '飲み放題', price: 1500 } }).ok).toBe(false);
    const none = parseCourseBuilderInput({ kind: 'plan', planKind: 'drink', course: { name: '飲み放題', price: 1500 }, planCategoryIds: null });
    expect(none.ok && none.input.planCategoryIds).toBeNull();
    expect(parseCourseBuilderInput({ kind: 'plan', planKind: 'drink', course: { name: '飲み放題', price: 1500 }, planCategoryIds: ['x'] }).ok).toBe(false);
  });

  it('放題の種類と印・既定のカテゴリ', () => {
    expect(planKindFlags('drink')).toEqual({ includesDrinks: true, includesAyce: false });
    expect(planKindFlags('food')).toEqual({ includesDrinks: false, includesAyce: true });
    expect(planKindOf(null, null, '飲み放題 90分')).toBe('drink');
    expect(planKindOf(null, null, '(AB) 2H Course Nomihodai')).toBe('drink');
    expect(planKindOf(null, null, '食べ放題')).toBe('food');
    expect(planKindOf(true, true, 'プランA')).toBe('both');
    expect(planKindOf(null, null, 'おまかせコース')).toBeNull();
    expect(defaultCategoryFor('course', null)).toMatchObject({ name: 'コース', pageKey: 'course' });
    expect(defaultCategoryFor('plan', 'drink')).toMatchObject({ pageKey: 'nomihodai' });
    expect(defaultCategoryFor('plan', 'food')).toMatchObject({ pageKey: 'tabehodai' });
  });

  it('選べるメインのグループ：保存した印 → 無ければ「メイン選択」の名前。ほかのグループは使わない', () => {
    const groups = [
      { id: A, name: 'Choice Curry' },
      { id: B, name: 'メイン選択' },
      { id: C, name: 'メイン（特選）' },
    ];
    expect(pickCourseMainGroup('course1', { course1: C }, groups)?.id).toBe(C);
    expect(pickCourseMainGroup('course1', {}, groups)?.id).toBe(B);
    // 印のグループが消えていたら名前で
    expect(pickCourseMainGroup('course1', { course1: '99999999-9999-4999-8999-999999999999' }, groups)?.id).toBe(B);
    expect(pickCourseMainGroup('course1', {}, [{ id: A, name: 'Choice Curry' }])).toBeNull();
    expect(courseMainGroupsFrom({ courseMainGroups: { [A]: B, bad: B, [C]: 'x' } })).toEqual({ [A]: B });
    expect(courseMainGroupsFrom(null)).toEqual({});
  });

  it('選択肢が変わったか・同じ名前の料理を使う・空の「コースの料理」カテゴリ', () => {
    expect(choicesChanged([{ name: 'A', price: 0 }], [{ name: 'A', price: 0 }])).toBe(false);
    expect(choicesChanged([{ name: 'A', price: 0 }], [{ name: 'A', price: 100 }])).toBe(true);
    expect(choicesChanged([{ name: 'A', price: 0 }, { name: 'B', price: 0 }], [{ name: 'B', price: 0 }, { name: 'A', price: 0 }])).toBe(true);
    expect(choicesChanged([], [{ name: 'A', price: 0 }])).toBe(true);
    const reuse = reuseDishesByName(['前菜', 'Soup', '新しい料理'], [
      { id: A, name: '前菜' },
      { id: B, name: 'soup' },
    ]);
    expect(reuse.get('前菜')).toBe(A);
    expect(reuse.get('Soup')).toBe(B);
    expect(reuse.has('新しい料理')).toBe(false);
    expect(isHiddenCourseDishCategory({ name: COURSE_DISH_CATEGORY_NAME }, 0)).toBe(true);
    expect(isHiddenCourseDishCategory({ name: COURSE_DISH_CATEGORY_NAME }, 2)).toBe(false);
    expect(isHiddenCourseDishCategory({ name: 'コース' }, 0)).toBe(false);
  });

  it('設定の操作として受け付ける（courseBuilderSave）', () => {
    expect(isNativeSettingsPageActionType('courseBuilderSave')).toBe(true);
    const r = parseNativeSettingsPageAction({ type: 'courseBuilderSave', ...course(), steps: [{ name: '前菜' }] });
    expect(r.ok).toBe(true);
    if (r.ok && r.action.type === 'courseBuilderSave') {
      expect(r.action.input.kind).toBe('course');
      expect(r.action.input.steps).toEqual([{ dishId: null, name: '前菜' }]);
    }
    const bad = parseNativeSettingsPageAction({ type: 'courseBuilderSave', ...course({ name: '' }) });
    expect(bad).toEqual({ ok: false, error: 'コース名を入力してください' });
  });
});
