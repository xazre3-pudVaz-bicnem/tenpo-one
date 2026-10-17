import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 2026-10-17 Ronnie「1品の取消は理由を書かなくてよい（担当選択だけ）。伝票ごとの取消は理由が要る。
// テーブルクリアも ¥0 のときは担当選択だけ」
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const pos = read('components/pos/pos-screen.tsx');
const sheet = read('components/floor/table-sheet.tsx');
const actions = read('app/app/pos/actions.ts');

/** title を含む <ConfirmDialog ... /> を切り出す */
function dialogWith(src: string, title: string): string {
  const at = src.indexOf(title);
  expect(at).toBeGreaterThan(-1);
  const start = src.lastIndexOf('<ConfirmDialog', at);
  const end = src.indexOf('/>', at);
  return src.slice(start, end);
}

/** export async function name( ... の本体（次の export まで） */
function fn(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nexport ', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('取消の理由（品目は不要・伝票は必要）', () => {
  it('品目の取消は理由の欄を出さない（レジは担当者を選ぶだけ）', () => {
    const d = dialogWith(pos, '品目を取消しますか / Cancel this item?');
    expect(d).not.toContain('requireReason');
    expect(d).toContain('このあと担当者を選んでください');
    // 担当者（店長以上）の選択は今まで通り
    expect(pos).toContain('const approval = await askCancelApproval();');
  });

  it('伝票ごとの取消は今まで通り理由が必須', () => {
    const d = dialogWith(pos, 'この注文を取消しますか / Cancel this order?');
    expect(d).toContain('requireReason');
    expect(fn(actions, 'cancelEmptyOrder')).toContain("if (!reason.trim()) throw new Error('取消理由を入力してください')");
  });

  it('サーバー：品目取消は理由なしでも通り、担当者名を取消理由に残す', () => {
    const body = fn(actions, 'cancelItem');
    expect(body).not.toContain("throw new Error('取消理由を入力してください')");
    expect(body).toContain('cancel_reason: why || (approver ? `担当: ${approver}` : null)');
    // 担当者（店長以上）の承認は今まで通り
    expect(body).toContain('await requireCancelApproval(');
  });

  it('テーブルクリア（¥0 の卓だけ）は理由の欄を出さない。サーバーも ¥0 のときだけ理由なしを通す', () => {
    const d = dialogWith(sheet, 'テーブルをクリアしますか / Clear this table?');
    expect(d).not.toContain('requireReason');
    expect(sheet).toContain('clearTableAction && table.order && total === 0');
    const body = fn(actions, 'clearTable');
    expect(body).toContain("if (!why && Number(order.total ?? 0) !== 0) throw new Error('理由を入力してください')");
    // 担当者（店長以上）の承認は cancelItem / cancelEmptyOrder の中で今まで通り
    expect(body).toContain('await cancelEmptyOrder(orderId, note, approvedByClerkId)');
  });
});
