import { describe, expect, it } from 'vitest';
import { budgetMotivation } from '@/lib/budget-motivation';

/** ホームの応援メッセージ（2026-09-30 Ronnie「もうちょい頑張ろう・あと何組で達成」） */
describe('予算の応援メッセージ', () => {
  const base = { budget: 500_000, perGroup: 12_000, hour: 19, seed: '2026/09/30' };

  it('目標に届いていなければ、あと¥X とあと何組を出す', () => {
    const m = budgetMotivation({ ...base, actual: 440_000 });
    expect(m).not.toBeNull();
    expect(m!.remaining).toBe(60_000);
    expect(m!.groupsNeeded).toBe(5); // 60,000 ÷ 12,000
    expect(m!.headline.length).toBeGreaterThan(0);
    expect(m!.tip.length).toBeGreaterThan(0);
  });

  it('端数の組は切り上げ（少しでも足りなければ1組）', () => {
    expect(budgetMotivation({ ...base, actual: 470_000 })!.groupsNeeded).toBe(3); // 30,000 ÷ 12,000 = 2.5
    expect(budgetMotivation({ ...base, actual: 499_500 })!.groupsNeeded).toBe(1);
  });

  it('達成していれば出さない・予算が無ければ出さない', () => {
    expect(budgetMotivation({ ...base, actual: 500_000 })).toBeNull();
    expect(budgetMotivation({ ...base, actual: 620_000 })).toBeNull();
    expect(budgetMotivation({ ...base, budget: 0, actual: 0 })).toBeNull();
  });

  it('1組あたりが分からなければ組数は出さない', () => {
    expect(budgetMotivation({ ...base, perGroup: null, actual: 100_000 })!.groupsNeeded).toBeNull();
  });

  it('夜遅くて半分未満なら「もうちょい頑張ろう」系、9割以上は「もうひと押し」系', () => {
    const late = ['もうちょい頑張ろう！最後まで諦めない 💪', 'まだ間に合う！ひと声で流れは変わります', 'ラストの1組まで全力で！'];
    expect(late).toContain(budgetMotivation({ ...base, hour: 21, actual: 100_000 })!.headline);
    const near = ['ゴールは目の前！もうひと押し 🔥', 'あと少し！ラストスパートいきましょう 🏃', 'ここまで来たら決めましょう！'];
    expect(near).toContain(budgetMotivation({ ...base, actual: 460_000 })!.headline);
  });

  it('同じ日・同じ時間なら同じ文（再読込で変わらない）', () => {
    const a = budgetMotivation({ ...base, actual: 200_000 });
    const b = budgetMotivation({ ...base, actual: 210_000 });
    expect(a!.headline).toBe(b!.headline);
    expect(a!.tip).toBe(b!.tip);
  });
});
