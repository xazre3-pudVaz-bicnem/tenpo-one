import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** パソコンの管理画面でもレジクローズの担当者を選べる（2026-10-17 Ronnie：PC で「担当者を選ぶ」が開かず締められなかった） */
describe('レジクローズ 担当者（PC）', () => {
  const card = readFileSync(join(__dirname, '..', 'components/cash/register-count-card.tsx'), 'utf8');
  const page = readFileSync(join(__dirname, '..', 'app/app/cash/close/page.tsx'), 'utf8');

  it('ClerkGate が無いときはカード内のセレクトで担当者を選ぶ', () => {
    expect(card).toContain('const localClerkPicker = !clerkGate && (clerks?.length ?? 0) > 0;');
    expect(card).toContain("clerkGate?.clerk?.name ?? (localClerkPicker && pickedClerk ? pickedClerk : null)");
    expect(card).toContain('レジクローズの担当者');
    expect(card).toMatch(/<select[\s\S]*id=\{`close-clerk-\$\{session\.id\}`\}/);
  });

  it('「担当者を選ぶ」はレジならポップアップ、PCならセレクトへ', () => {
    expect(card).toContain('if (clerkGate) clerkGate.change();');
    expect(card).toContain('else clerkSelectRef.current?.focus();');
    expect(card).not.toContain('onClick={() => clerkGate?.change()}');
  });

  it('管理画面だけ担当者一覧を渡す（レジの iPad は ClerkGate のまま）', () => {
    expect(page).toContain("from('pos_clerks')");
    expect(page).toContain('clerks={isRegi ? undefined : (clerkRows ?? [])');
  });
});
