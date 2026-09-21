import { describe, it, expect } from 'vitest';
import {
  buildPlanItems,
  classifyPlanItem,
  CUSTOM_MAX_HOURS,
  DEFAULT_VISIT_DRAFT,
  DURATION_MAX_MINUTES,
  DURATION_MIN_MINUTES,
  durationLabel,
  durationProblem,
  HOUR_CHOICES,
  isButtonMinutes,
  MINUTE_CHOICES,
  nearestButtonParts,
  parseCustomMinutes,
  planHasItems,
  remainingMinutes,
  splitMinutes,
  validateVisitDraft,
  visitMemo,
  warningProblem,
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
    // カスタムで入れた15分単位でない長さ・ボタンに無い4時間も使える
    expect(validateVisitDraft(draft({ timed: true, duration: 100 }))).toBeNull();
    expect(validateVisitDraft(draft({ timed: true, duration: 240 }))).toBeNull();
  });

  it('終了前注意は席時間より短くないと確定できない（切っていれば見ない）', () => {
    expect(validateVisitDraft(draft({ timed: true, duration: 30, warningMinutes: 30 }))).toMatch(
      /終了前注意は席時間（30分）より短く/
    );
    expect(validateVisitDraft(draft({ timed: true, duration: 30, warningMinutes: 10 }))).toBeNull();
    expect(
      validateVisitDraft(draft({ timed: true, duration: 30, warningMinutes: 30, warningEnabled: false }))
    ).toBeNull();
    expect(validateVisitDraft(draft({ timed: false, duration: 30, warningMinutes: 60 }))).toBeNull();
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

  it('終了前注意が1時間以上なら「1時間15分前」と書く', () => {
    expect(visitMemo(draft({ timed: true, duration: 180, warningEnabled: true, warningMinutes: 75 }))).toBe(
      'ハンディ: アラカルト / 男2・女1 / 記念日・誕生日 / 3時間制（1時間15分前に声かけ）'
    );
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

  it('15分単位の表示', () => {
    expect(durationLabel(75)).toBe('1時間15分');
    expect(durationLabel(105)).toBe('1時間45分');
    expect(durationLabel(0)).toBe('0分');
  });

  it('残り分は切り上げ・0未満は0', () => {
    const now = 1_700_000_000_000;
    expect(remainingMinutes(now + 90_000, now)).toBe(2);
    expect(remainingMinutes(now - 60_000, now)).toBe(0);
    expect(remainingMinutes(null, now)).toBeNull();
  });
});

describe('時間ピッカー（時間制・終了前注意）', () => {
  it('ボタンは 0〜3時間 と 0/15/30/45分', () => {
    expect(HOUR_CHOICES).toEqual([0, 1, 2, 3]);
    expect(MINUTE_CHOICES).toEqual([0, 15, 30, 45]);
  });

  it('分を時間と分に分ける（読めない値・マイナスは0）', () => {
    expect(splitMinutes(135)).toEqual({ hours: 2, minutes: 15 });
    expect(splitMinutes(30)).toEqual({ hours: 0, minutes: 30 });
    expect(splitMinutes(-5)).toEqual({ hours: 0, minutes: 0 });
    expect(splitMinutes(Number.NaN)).toEqual({ hours: 0, minutes: 0 });
  });

  it('ボタンだけで選べる長さか（選べなければカスタムで開く）', () => {
    expect(isButtonMinutes(120)).toBe(true);
    expect(isButtonMinutes(30)).toBe(true);
    expect(isButtonMinutes(225)).toBe(true); // 3時間45分
    expect(isButtonMinutes(0)).toBe(true); // 0時間0分（設定はできないが、ボタンの組み合わせとしてはある）
    expect(isButtonMinutes(240)).toBe(false); // 4時間
    expect(isButtonMinutes(100)).toBe(false); // 1時間40分
    expect(isButtonMinutes(10)).toBe(false);
    expect(isButtonMinutes(1.5)).toBe(false);
  });

  it('カスタムからボタンに戻したときは、近い下のボタンに寄せる', () => {
    expect(nearestButtonParts(100)).toEqual({ hours: 1, minutes: 30 });
    expect(nearestButtonParts(250)).toEqual({ hours: 3, minutes: 0 });
    expect(nearestButtonParts(10)).toEqual({ hours: 0, minutes: 0 });
    expect(nearestButtonParts(59)).toEqual({ hours: 0, minutes: 45 });
  });

  it('カスタム入力を分に直す（空欄は0・全角数字も読む）', () => {
    expect(parseCustomMinutes('4', '0')).toBe(240);
    expect(parseCustomMinutes('0', '10')).toBe(10);
    expect(parseCustomMinutes('', '5')).toBe(5);
    expect(parseCustomMinutes('1', '')).toBe(60);
    expect(parseCustomMinutes('１', '４０')).toBe(100);
    expect(parseCustomMinutes(' 2 ', ' 15 ')).toBe(135);
  });

  it('カスタム入力の読めない値は null（分は59まで・時間は上限まで）', () => {
    expect(CUSTOM_MAX_HOURS).toBe(8);
    expect(parseCustomMinutes('0', '60')).toBeNull();
    expect(parseCustomMinutes('9', '0')).toBeNull();
    expect(parseCustomMinutes('-1', '0')).toBeNull();
    expect(parseCustomMinutes('1.5', '0')).toBeNull();
    expect(parseCustomMinutes('a', '0')).toBeNull();
    expect(parseCustomMinutes('8', '0')).toBe(480);
  });

  it('席時間は15分〜8時間（レジのウォークインと同じ範囲）', () => {
    expect(DURATION_MIN_MINUTES).toBe(15);
    expect(DURATION_MAX_MINUTES).toBe(480);
    expect(durationProblem(15)).toBeNull();
    expect(durationProblem(480)).toBeNull();
    expect(durationProblem(100)).toBeNull();
    expect(durationProblem(0)).toMatch(/15分〜8時間/);
    expect(durationProblem(10)).toMatch(/席時間/);
    expect(durationProblem(481)).toMatch(/席時間/);
    expect(durationProblem(90.5)).toMatch(/席時間/);
  });

  it('終了前注意は1分以上・席時間より短く', () => {
    expect(warningProblem(30, 120)).toBeNull();
    expect(warningProblem(10, 120)).toBeNull();
    expect(warningProblem(0, 120)).toMatch(/設定してください/);
    expect(warningProblem(120, 120)).toMatch(/席時間（2時間）より短く/);
    expect(warningProblem(180, 120)).toMatch(/より短く/);
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
