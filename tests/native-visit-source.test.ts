import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VISIT_DRAFT, validateVisitDraft } from '@/lib/handy-visit';
import { sortSourcesByUsage } from '@/lib/native-pos';

describe('来店経路は来店登録では選ばない・会計で選ぶ（2026-10-24 Ronnie）', () => {
  const draft = { ...DEFAULT_VISIT_DRAFT, male: 2, female: 0, source: '' };

  it('Web のハンディ・レジは今まで通り来店経路が要る。iPad アプリ（requireSource: false）は要らない', () => {
    expect(validateVisitDraft(draft)).toBe('来店経路を選択してください');
    expect(validateVisitDraft(draft, { requireSource: false })).toBeNull();
    // 渡すときは決まった名前だけ
    expect(validateVisitDraft({ ...draft, source: 'なぞ' }, { requireSource: false })).toBe('来店経路を選択してください');
    expect(validateVisitDraft({ ...draft, source: '食べログ' }, { requireSource: false })).toBeNull();
  });

  it('この店でよく使う順（同じ数なら設定の並び）', () => {
    const list = [{ id: 'free' }, { id: 'phone' }, { id: 'tabelog' }, { id: 'hotpepper' }];
    const counts = new Map([['tabelog', 5], ['hotpepper', 5], ['phone', 1]]);
    expect(sortSourcesByUsage(list, counts).map((s) => s.id)).toEqual(['tabelog', 'hotpepper', 'phone', 'free']);
    expect(sortSourcesByUsage(list, new Map()).map((s) => s.id)).toEqual(['free', 'phone', 'tabelog', 'hotpepper']);
  });

  it('アプリの来店登録は経路なしで始められ、お客様情報の直しは空の経路で今の経路を消さない', () => {
    const route = readFileSync('app/api/app/v1/pos/route.ts', 'utf8');
    expect(route).toContain('startRegisterVisit(action.tableId, action.draft, { sourceOptional: true })');
    const edit = readFileSync('lib/native-visit-edit-server.ts', 'utf8');
    expect(edit).toMatch(/if \(src\) \{\s+const visit = await setOrderVisitSource/);
  });
});
