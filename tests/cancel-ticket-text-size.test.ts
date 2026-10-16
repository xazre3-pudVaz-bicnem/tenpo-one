import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** 取消伝票・再印刷の厨房伝票は店舗の「文字の大きさ」に従う（2026-10-16 SHUNKA 新宿「取消伝票が大きすぎる」） */
describe('取消伝票の文字の大きさ', () => {
  const src = readFileSync(join(__dirname, '..', 'app/app/pos/print-actions.ts'), 'utf8');

  it('取消伝票・再印刷に large 固定が残っていない', () => {
    const cancel = src.slice(src.indexOf('export async function enqueueCancelSlipPrint('), src.indexOf('async function enqueueOrderItemsTicket('));
    const items = src.slice(src.indexOf('async function enqueueOrderItemsTicket('), src.indexOf('export async function enqueueExpoSlipPrint('));
    expect(cancel).not.toContain("textSize: 'large'");
    expect(items).not.toContain("textSize: 'large'");
    expect(cancel).toContain('kitchenTicketStyleForStore(supabase, order.store_id)');
    expect(items).toContain('kitchenTicketStyleForStore(supabase, order.store_id)');
  });

  it('店舗設定（store_settings.settings.kitchenTicket）から読む', () => {
    expect(src).toContain("kitchenTicketSettingsFrom(data?.settings ?? null)");
  });
});
