import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 会計のあとなどに「POSレジ（注文を選ぶ一覧）」を出さず、ホーム（左メニューあり）へ（2026-09-30 Ronnie） */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('POS の注文一覧（/app/pos）', () => {
  it('卓のない未会計が無ければホームへ', () => {
    const page = read('app/app/pos/page.tsx');
    expect(page).toContain("if (!(openOrders ?? []).some((o) => o.table_id == null)) redirect('/app/dashboard');");
  });

  it('会計完了の「続けて会計」・空の伝票の取消はホームへ', () => {
    expect(read('components/pos/checkout-dialog.tsx')).toContain("router.push('/app/dashboard')");
    expect(read('components/pos/pos-screen.tsx')).not.toContain("router.push('/app/pos')");
  });
});
