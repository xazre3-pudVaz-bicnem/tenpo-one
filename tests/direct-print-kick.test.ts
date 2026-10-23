import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * アプリ（iPad）の印刷を速く（2026-10-20 Ronnie「アプリは印刷も速く」）。
 * 注文・会計が入ったら、いつもの1秒ごとを待たずに何回か早めに印刷を取りに行く。
 */
describe('この端末の印刷：注文・会計が入ったらすぐ取りに行く', () => {
  const agent = readFileSync(new URL('../components/printing/direct-print-agent.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../app/app/layout.tsx', import.meta.url), 'utf8');
  it('店の注文の品・伝票の変化（Realtime）で早めに見る。数回だけ（いつもは1秒ごとのまま）', () => {
    expect(agent).toContain('const KICK_DELAYS_MS = [0, 150, 600, 1200, 2000];');
    expect(agent).toContain("table: 'order_items', filter: `store_id=eq.${storeId}` }, kick)");
    expect(agent).toContain("table: 'orders', filter: `store_id=eq.${storeId}` }, kick)");
  });
  it('この端末で印刷していないとき（パソコンなど）は Realtime につながない', () => {
    expect(agent).toContain('const want = !!supabase && !!storeId && usesDevicePrinting();');
    expect(agent).toContain('void supabase.removeChannel(channel);');
  });
  it('店の ID を渡す', () => {
    expect(layout).toContain('<DirectPrintAgent storeId={ctx.currentStore.id} />');
  });
});
