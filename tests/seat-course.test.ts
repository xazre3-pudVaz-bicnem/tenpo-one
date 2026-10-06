import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSeatCourseItem } from '@/lib/menu-book';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/**
 * お客様情報（着席画面）で選んだプランのコースが、注文画面の「お客様情報」のコース欄にも入る
 * （2026-10-06 FULL MOoN 御茶ノ水 宮崎さん「この画面でモードやプランを設定しても、次の画面で なし(アラカルト) になる」）。
 */
describe('isSeatCourseItem（席のコースに選べる商品）', () => {
  it('種別コースの商品', () => {
    expect(isSeatCourseItem('course', '季節のコース')).toBe(true);
  });

  it('dinii 取込で種別がフードのままのコース（名前に コース／course）', () => {
    expect(isSeatCourseItem('food', '(AB) 2H Course Nomihodai')).toBe(true);
    expect(isSeatCourseItem('food', '宴会コース 4000')).toBe(true);
  });

  it('飲み放題だけ・単品・選択肢・アップグレード・延長は入れない', () => {
    expect(isSeatCourseItem('drink', '飲み放題B 2H')).toBe(false);
    expect(isSeatCourseItem('food', 'チキンカレー')).toBe(false);
    expect(isSeatCourseItem('option', 'コース（選択肢）')).toBe(false);
    expect(isSeatCourseItem('course', 'コース A→AB')).toBe(false);
    expect(isSeatCourseItem('course', 'コース 延長 30分')).toBe(false);
  });
});

describe('着席画面のプラン → 席のコース（reservations.course_id）', () => {
  it('startHandyVisit は選んだプランのコースを startWalkIn の courseId に渡す', () => {
    const src = read('app/app/handy/actions.ts');
    expect(src).toContain('const seatCourseId = await firstCoursePlanItem(draft.planItemIds);');
    expect(src).toContain('courseId: seatCourseId ?? undefined,');
    expect(src).toContain("import { isSeatCourseItem } from '@/lib/menu-book'");
  });

  it('startWalkIn / setSeatTime は全店共通（store_id なし）のコースも受け付け、種別はコースに限らない', () => {
    for (const p of ['app/app/floor/actions.ts', 'app/app/pos/actions.ts']) {
      const src = read(p);
      expect(src).toContain('isSeatCourseItem(course.item_type as string | null, course.name as string)');
      expect(src).not.toMatch(/\.eq\('item_type', 'course'\)/);
    }
  });

  it('コース欄の選択肢（注文画面・テーブル一覧）も同じ判定', () => {
    expect(read('app/app/pos/page.tsx')).toContain('isSeatCourseItem(m.item_type as string | null, m.name as string)');
    expect(read('app/app/floor/page.tsx')).toContain('isSeatCourseItem(m.item_type, m.name)');
  });
});
