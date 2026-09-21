import { describe, it, expect } from 'vitest';
import {
  buildPlanItems,
  classifyPlanItem,
  DEFAULT_VISIT_DRAFT,
  durationLabel,
  planHasItems,
  remainingMinutes,
  validateVisitDraft,
  visitMemo,
  type PlanItemInput,
  type VisitDraft,
} from '@/lib/handy-visit';
import {
  handyDateLabel,
  NO_CLERK_NAME,
  parseHandyClerk,
  serializeHandyClerk,
} from '@/lib/handy-clerk';

function draft(overrides: Partial<VisitDraft> = {}): VisitDraft {
  return { ...DEFAULT_VISIT_DRAFT, male: 2, female: 1, scene: '記念日・誕生日', ...overrides };
}

describe('お客様情報の検証', () => {
  it('人数と利用シーンがあれば確定できる', () => {
    expect(validateVisitDraft(draft())).toBeNull();
  });

  it('人数が0なら確定できない', () => {
    expect(validateVisitDraft(draft({ male: 0, female: 0 }))).toMatch(/合計人数/);
  });

  it('人数の上限を超えると確定できない', () => {
    expect(validateVisitDraft(draft({ male: 990, female: 10 }))).toMatch(/合計人数/);
    expect(validateVisitDraft(draft({ male: 120, female: 0 }))).toBeNull();
  });

  it('マイナス・小数の人数は受け付けない', () => {
    expect(validateVisitDraft(draft({ male: -1 }))).toMatch(/人数/);
    expect(validateVisitDraft(draft({ female: 1.5 }))).toMatch(/人数/);
  });

  it('利用シーンが無いと確定できない（一覧に無い値も不可）', () => {
    expect(validateVisitDraft(draft({ scene: '' }))).toMatch(/利用シーン/);
    expect(validateVisitDraft(draft({ scene: '飲み会' as VisitDraft['scene'] }))).toMatch(/利用シーン/);
  });

  it('時間制のときだけ席時間を検証する', () => {
    expect(validateVisitDraft(draft({ timed: false, duration: 0 }))).toBeNull();
    expect(validateVisitDraft(draft({ timed: true, duration: 0 }))).toMatch(/席時間/);
    expect(validateVisitDraft(draft({ timed: true, duration: 600 }))).toMatch(/席時間/);
    expect(validateVisitDraft(draft({ timed: true, duration: 120 }))).toBeNull();
  });

  it('プラン商品は必須ではない（メニュー未登録の店でも飲み放題モードで使える）', () => {
    expect(validateVisitDraft(draft({ plan: 'drink', planItemId: null }))).toBeNull();
  });
});

describe('伝票メモ', () => {
  it('モード・人数・シーン・時間制を1行にまとめる（レジのメモ欄で読める形）', () => {
    expect(visitMemo(draft({ plan: 'drink', timed: true, duration: 120, warningEnabled: true, warningMinutes: 30 }))).toBe(
      'ハンディ: 飲み放題 / 男2・女1 / 記念日・誕生日 / 2時間制（30分前に声かけ）'
    );
  });

  it('時間制でなければ時間を書かない', () => {
    expect(visitMemo(draft({ timed: false }))).toBe('ハンディ: アラカルト / 男2・女1 / 記念日・誕生日');
  });

  it('終了前注意を切っていれば声かけを書かない', () => {
    expect(visitMemo(draft({ timed: true, duration: 90, warningEnabled: false }))).toBe(
      'ハンディ: アラカルト / 男2・女1 / 記念日・誕生日 / 1時間30分制'
    );
  });
});

describe('時間の表示', () => {
  it('分を時間と分に直す', () => {
    expect(durationLabel(45)).toBe('45分');
    expect(durationLabel(60)).toBe('1時間');
    expect(durationLabel(150)).toBe('2時間30分');
  });

  it('残り分は切り上げ・0未満は0', () => {
    const now = 1_700_000_000_000;
    expect(remainingMinutes(now + 90_000, now)).toBe(2);
    expect(remainingMinutes(now - 60_000, now)).toBe(0);
    expect(remainingMinutes(null, now)).toBeNull();
  });
});

describe('プラン商品の振り分け', () => {
  function item(overrides: Partial<PlanItemInput> = {}): PlanItemInput {
    return {
      id: 'x',
      name: '商品',
      categoryName: null,
      price: 3000,
      itemType: 'food',
      isSoldOut: false,
      durationMinutes: null,
      courseIncludesDrinks: null,
      courseIncludesAyce: null,
      ...overrides,
    };
  }

  it('DBのフラグを優先する', () => {
    expect(classifyPlanItem(item({ courseIncludesDrinks: true }))).toBe('drink');
    expect(classifyPlanItem(item({ courseIncludesAyce: true }))).toBe('buffet');
    expect(classifyPlanItem(item({ courseIncludesDrinks: true, courseIncludesAyce: true }))).toBe('food');
  });

  it('フラグが無ければ商品名で拾う', () => {
    expect(classifyPlanItem(item({ name: '2時間飲み放題' }))).toBe('drink');
    expect(classifyPlanItem(item({ name: '焼肉食べ放題' }))).toBe('buffet');
    expect(classifyPlanItem(item({ name: '食べ飲み放題コース' }))).toBe('food');
    expect(classifyPlanItem(item({ name: '【食べ放題Party!】2H飲放＋グランドメニュー50種以上食べ放題' }))).toBe('food');
  });

  it('ローマ字の伝票名（Nomihoudai / Nomihodai）も飲み放題として拾う', () => {
    expect(classifyPlanItem(item({ name: 'Nomihoudai AB', itemType: 'course' }))).toBe('drink');
    expect(classifyPlanItem(item({ name: '(A) 2H Course Nomihodai', itemType: 'course', price: 0 }))).toBe('drink');
  });

  it('カテゴリ名はコース商品のときだけ見る（飲み放題カテゴリの0円ドリンクはプランにしない）', () => {
    expect(classifyPlanItem(item({ name: 'スタンダード', categoryName: '飲み放題', itemType: 'course' }))).toBe('drink');
    expect(classifyPlanItem(item({ name: '生ビール', categoryName: '飲み放題', itemType: 'drink', price: 0 }))).toBeNull();
  });

  it('アップグレード（A→AB）・延長はプランにしない', () => {
    expect(classifyPlanItem(item({ name: '飲み放題 (A→AB)' }))).toBeNull();
    expect(classifyPlanItem(item({ name: 'コース飲み放題 (A→B)', itemType: 'course' }))).toBeNull();
    expect(classifyPlanItem(item({ name: '延長 (30min)', itemType: 'course' }))).toBeNull();
  });

  it('コース商品はコース、単品は null', () => {
    expect(classifyPlanItem(item({ itemType: 'course', name: '季節のコース' }))).toBe('course');
    expect(classifyPlanItem(item({ name: '唐揚げ' }))).toBeNull();
  });

  it('売切のプラン商品は出さない', () => {
    expect(classifyPlanItem(item({ itemType: 'course', isSoldOut: true }))).toBeNull();
  });

  it('コースの所要時間を時間制の既定値として持つ（0以下は無し）', () => {
    const out = buildPlanItems([
      item({ id: 'a', itemType: 'course', durationMinutes: 120 }),
      item({ id: 'b', itemType: 'course', durationMinutes: 0 }),
      item({ id: 'c', name: '唐揚げ' }),
    ]);
    expect(out.map((p) => [p.id, p.kind, p.durationMinutes])).toEqual([
      ['a', 'course', 120],
      ['b', 'course', null],
    ]);
  });

  it('アラカルト以外のモードでプラン商品を選べる', () => {
    expect(planHasItems('normal')).toBe(false);
    expect(planHasItems('drink')).toBe(true);
    expect(planHasItems('course')).toBe(true);
  });
});

describe('担当者 Cookie', () => {
  it('選んだ担当者を保存して読み戻せる', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const raw = serializeHandyClerk({ id, name: '田中' });
    expect(parseHandyClerk(raw)).toEqual({ id, name: '田中' });
  });

  it('「担当者なし」は id が null', () => {
    const raw = serializeHandyClerk({ id: null, name: '' });
    expect(parseHandyClerk(raw)).toEqual({ id: null, name: NO_CLERK_NAME });
  });

  it('壊れた値・古い形式・UUIDでない id は未ログイン扱い', () => {
    expect(parseHandyClerk(undefined)).toBeNull();
    expect(parseHandyClerk('')).toBeNull();
    expect(parseHandyClerk('not json')).toBeNull();
    expect(parseHandyClerk('"abc"')).toBeNull();
    expect(parseHandyClerk(JSON.stringify({ id: 'abc', name: '田中' }))).toBeNull();
    expect(parseHandyClerk(JSON.stringify({ id: null, name: '' }))).toBeNull();
  });

  it('長すぎる名前は切り詰める', () => {
    const raw = serializeHandyClerk({ id: null, name: 'あ'.repeat(100) });
    expect(parseHandyClerk(raw)?.name).toHaveLength(40);
  });

  it('日付は日本時間で描く', () => {
    // 2026-09-21 00:30 JST = 2026-09-20 15:30 UTC（UTCのままだと前日になる）
    expect(handyDateLabel(Date.UTC(2026, 8, 20, 15, 30))).toBe('2026/09/21');
  });
});
