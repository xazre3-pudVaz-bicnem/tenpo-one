import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 2026-10-16 Ronnie「Order をスライドしていないのに注文が行った」（SHUNKA 新宿 T401：お客様情報で選んだ
// 飲み放題 B プラン・3h コースが、確定と同時に厨房へ送られていた）
describe('レジの「お客様情報」のプラン商品は Order のスライドで送る', () => {
  const actions = readFileSync('app/app/handy/actions.ts', 'utf8');
  const setup = readFileSync('app/app/floor/[tableId]/setup/page.tsx', 'utf8');

  it('レジの着席画面はプランを送らない確定（startRegisterVisit）を使う', () => {
    expect(setup).toContain('confirmAction={startRegisterVisit}');
    expect(setup).not.toContain('confirmAction={startHandyVisit}');
  });

  it('レジはプランを未送信のまま、ハンディは今まで通りすぐ送る', () => {
    expect(actions).toMatch(/export async function startRegisterVisit[\s\S]*?sendPlanNow: false/);
    expect(actions).toMatch(/export async function startHandyVisit[\s\S]*?sendPlanNow: true/);
    expect(actions).toContain('if (sendPlanNow && addedIds.length > 0)');
  });

  it('レジの注文画面の Order は未送信の品も数えて送る（プランが Order（2品）になる）', () => {
    const pos = readFileSync('components/pos/pos-screen.tsx', 'utf8');
    expect(pos).toContain('const unsentItems = items.filter((it) => it.kitchen_sent_at === null);');
    expect(pos).toContain('cartCount + unsentItems.length > 0');
    expect(pos).toContain('if (cart.length === 0 && unsentItems.length === 0) return;');
  });
});
