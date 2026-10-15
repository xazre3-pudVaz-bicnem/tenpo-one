import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcChange, cashPaidAmount, isCashCovered } from '@/lib/money';
import { mergeEposDocs, ryoshushoToEposXml } from '@/lib/epos-print';
import { ryoshushoIssuedFrom } from '@/lib/ryoshusho-issue';
import { ryoshushoSlips } from '@/lib/ryoshusho-split';
import { parseEposForRaster } from '@/lib/sii-url-print';
import { baseReceipt } from './fixtures/receipt';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** 2026-10-14 宮崎さん（FULL MOoN 御茶ノ水）「お会計のときに金額が足りなくても会計ができてしまいます」 */
describe('現金のお預かりが足りない会計はできない', () => {
  it('現金で払う額はお預かりまで（¥5,280 に ¥1,080 なら ¥1,080 だけ。残り ¥4,200 は残額）', () => {
    expect(cashPaidAmount(1080, 5280)).toBe(1080);
    expect(cashPaidAmount(10000, 5280)).toBe(5280);
    expect(calcChange(cashPaidAmount(10000, 5280), 10000)).toBe(4720);
    expect(cashPaidAmount(-5, 5280)).toBe(0);
  });

  it('お預かりが足りない現金の行は「足りていない」。現金以外・お預かりなしは今まで通り', () => {
    expect(isCashCovered({ method: 'cash', amount: 5280, tendered: 1080 })).toBe(false);
    expect(isCashCovered({ method: 'cash', amount: 5280, tendered: 5280 })).toBe(true);
    expect(isCashCovered({ method: 'cash', amount: 5280 })).toBe(true);
    expect(isCashCovered({ method: 'credit', amount: 5280 })).toBe(true);
  });

  it('画面：会計完了はお預かりが足りているときだけ。サーバーでも止める', () => {
    const dlg = read('components/pos/checkout-dialog.tsx');
    expect(dlg).toContain('payments.every(isCashCovered) &&');
    expect(dlg).toContain("updatePayment(activeRow.key, { tendered, amount: cashPaidAmount(tendered, dueFor(activeRow)) });");
    const actions = read('app/app/pos/actions.ts');
    expect(actions).toContain('if (!payments.every(isCashCovered)) {');
  });
});

/** 2026-10-14 宮崎さん「領収書を分けた時に1枚目はすぐに出てきますが、2枚目以降がでてくるまでかなり時間がかかります」 */
describe('分割した領収書は1回の印刷で続けて出す', () => {
  it('ePOS-Print の文書を1つにまとめる（紙ごとのカットは残る）', () => {
    const slips = ryoshushoSlips([10000, 24800], 3164);
    const docs = slips.map((split) => ryoshushoToEposXml(baseReceipt, { paperWidth: 80, split }));
    const merged = mergeEposDocs(docs);
    expect(merged.match(/<epos-print\b/g)).toHaveLength(1);
    expect(merged.match(/<\/epos-print>/g)).toHaveLength(1);
    expect(merged.match(/<cut\b/g)?.length).toBe(docs.reduce((n, d) => n + (d.match(/<cut\b/g)?.length ?? 0), 0));
    expect(merged).toContain('(1/2)');
    expect(merged).toContain('(2/2)');
    expect(mergeEposDocs([docs[0]])).toBe(docs[0]);
    // SII URL Print Agent（Safari）でも2枚の紙になる
    expect(parseEposForRaster(merged).pages).toHaveLength(2);
  });

  it('印刷は1件にまとめ、発行した枚数を残す（「発行済み・2枚」）', () => {
    const src = read('app/app/pos/print-actions.ts');
    expect(src).toContain('epos: mergeEposDocs(renders.map((r) => r.epos)),');
    expect(src).toContain('...(renders.length > 1 ? { sheets: renders.length } : {}),');
    expect(ryoshushoIssuedFrom([{ job_type: 'ryoshusho', status: 'queued', sheets: 2, created_at: '2026-10-14T10:41:00Z' }]).count).toBe(2);
    expect(ryoshushoIssuedFrom([{ job_type: 'ryoshusho', status: 'printed' }]).count).toBe(1);
    // 前の形（1枚ずつ別の印刷）も数えられる
    expect(ryoshushoIssuedFrom([{ job_type: 'ryoshusho', status: 'printed' }, { job_type: 'ryoshusho', status: 'printed' }]).count).toBe(2);
  });
});

/** 2026-10-14 宮崎さん「仕入先の画面から入出金の画面に進めるようにしてほしいです」 */
describe('仕入先の画面に「← 入出金」', () => {
  it('「仕入先を登録」の左に入出金へのボタン', () => {
    const page = read('app/app/vendors/page.tsx');
    expect(page).toContain('<Link href="/app/cash" className={buttonVariants({ variant: \'secondary\' })}>');
    expect(page.indexOf('入出金')).toBeLessThan(page.indexOf('<VendorForm />'));
  });
});
