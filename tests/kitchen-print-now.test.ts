import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 2026-10-17 Ronnie「ブラウザからの印刷が遅い。0秒で出るように」
// MEAT CROWN 新横浜：送ってから伝票ができるまで平均 11 秒（問い合わせ間隔＋まとめる待ち 3 秒）→ 送った瞬間に作る
describe('厨房伝票は送った瞬間に作る', () => {
  const queue = readFileSync('lib/print-queue.ts', 'utf8');
  const pos = readFileSync('app/app/pos/actions.ts', 'utf8');
  const qr = readFileSync('components/qr-order/qr-order-app.tsx', 'utf8');
  const route = readFileSync('app/api/qr/kitchen-now/route.ts', 'utf8');

  it('店のキッチン機すべてに、まとめる待ち 0 秒で伝票を作る（2枚にしないのは claim_kitchen_items）', () => {
    expect(queue).toContain('export async function generateKitchenJobsForStore');
    expect(queue).toContain('generateKitchenJobs(admin, printer, { batchDelaySeconds: 0 })');
    expect(queue).toContain("p_batch_delay_seconds: opts.batchDelaySeconds ?? KITCHEN_BATCH_DELAY_SECONDS");
  });

  it('レジの Order・ハンディの送信のあとに作る（返事は待たない after）', () => {
    expect(pos).toContain('if (sent > 0) kickKitchenPrint(order.store_id);');
    expect(pos).toContain('if ((data ?? []).length > 0) kickKitchenPrint(order.store_id);');
    expect(pos).toMatch(/function kickKitchenPrint[\s\S]*?after\(async/);
  });

  it('お客様QRの注文のあとにも作る（卓の QR と今の注文を確かめてから）', () => {
    expect(qr).toContain("fetch('/api/qr/kitchen-now'");
    expect(route).toContain(".eq('qr_token', token)");
    expect(route).toContain('store.slug !== slug');
    expect(route).toContain(".eq('status', 'open')");
    expect(route).toContain('generateKitchenJobsForStore(admin');
  });
});
