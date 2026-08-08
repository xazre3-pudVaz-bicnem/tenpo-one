import { describe, expect, it } from 'vitest';
import {
  aggregateTrialBalance,
  buildBalanceSheet,
  buildExpenseJournal,
  buildPayrollJournal,
  buildProfitAndLoss,
  buildPurchaseJournal,
  buildSalesJournal,
  validateJournalBalance,
  STD,
  type AccountInfo,
  type PostedLine,
} from '@/lib/accounting';

describe('validateJournalBalance（借方=貸方）', () => {
  it('一致すればbalanced', () => {
    const r = validateJournalBalance([
      { side: 'debit', amount: 1000 },
      { side: 'credit', amount: 1000 },
    ]);
    expect(r).toEqual({ balanced: true, debit: 1000, credit: 1000 });
  });
  it('不一致・0円・負値・非整数は不可', () => {
    expect(validateJournalBalance([{ side: 'debit', amount: 1000 }, { side: 'credit', amount: 999 }]).balanced).toBe(false);
    expect(validateJournalBalance([]).balanced).toBe(false);
    expect(validateJournalBalance([{ side: 'debit', amount: 0 }, { side: 'credit', amount: 0 }]).balanced).toBe(false);
    expect(validateJournalBalance([{ side: 'debit', amount: 100.5 }, { side: 'credit', amount: 100.5 }]).balanced).toBe(false);
  });
  it('複数明細（1仕訳に複数行）で一致判定', () => {
    const r = validateJournalBalance([
      { side: 'debit', amount: 800 },
      { side: 'debit', amount: 200 },
      { side: 'credit', amount: 1000 },
    ]);
    expect(r.balanced).toBe(true);
  });
});

describe('自動仕訳ビルダー（すべて貸借一致すること）', () => {
  it('現金売上: 借方現金/貸方売上高', () => {
    const lines = buildSalesJournal({
      cashSalesStandard: 50000, cashSalesReduced: 0,
      cashlessSalesStandard: 0, cashlessSalesReduced: 0,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: STD.cash, side: 'debit', amount: 50000 });
    expect(lines[1]).toMatchObject({ accountCode: STD.sales, side: 'credit', amount: 50000, taxTreatment: 'taxable_standard' });
    expect(validateJournalBalance(lines).balanced).toBe(true);
  });
  it('カード売上: 借方売掛金/貸方売上高', () => {
    const lines = buildSalesJournal({
      cashSalesStandard: 0, cashSalesReduced: 0,
      cashlessSalesStandard: 30000, cashlessSalesReduced: 0,
    });
    expect(lines[0]).toMatchObject({ accountCode: STD.receivable, side: 'debit', amount: 30000 });
    expect(validateJournalBalance(lines).balanced).toBe(true);
  });
  it('現金+カード+軽減税率混在でも貸借一致', () => {
    const lines = buildSalesJournal({
      cashSalesStandard: 40000, cashSalesReduced: 8000,
      cashlessSalesStandard: 30000, cashlessSalesReduced: 2000,
    });
    const v = validateJournalBalance(lines);
    expect(v.balanced).toBe(true);
    expect(v.debit).toBe(80000);
    // 軽減税率分は売上高（軽減）へ
    expect(lines.find((l) => l.accountCode === STD.salesReduced)?.amount).toBe(10000);
  });
  it('仕入請求書: 仕入高/買掛金', () => {
    const lines = buildPurchaseJournal({ amount: 120000, vendorName: '築地フーズ' });
    expect(lines[0]).toMatchObject({ accountCode: STD.purchases, side: 'debit', taxTreatment: 'taxable_reduced' });
    expect(lines[1]).toMatchObject({ accountCode: STD.payable, side: 'credit' });
    expect(validateJournalBalance(lines).balanced).toBe(true);
  });
  it('現金経費: 費目/現金。立替はの貸方は未払費用', () => {
    const cash = buildExpenseJournal({ amount: 3300, expenseAccountCode: '520', paidVia: 'register' });
    expect(cash[1].accountCode).toBe(STD.cash);
    const personal = buildExpenseJournal({ amount: 5000, expenseAccountCode: '599', paidVia: 'personal' });
    expect(personal[1].accountCode).toBe(STD.accruedPayable);
    expect(validateJournalBalance(cash).balanced).toBe(true);
  });
  it('給与確定: 給与手当/未払費用', () => {
    const lines = buildPayrollJournal({ grossTotal: 1_200_000, periodLabel: '2026年7月' });
    expect(lines[0]).toMatchObject({ accountCode: STD.salaries, side: 'debit', amount: 1_200_000 });
    expect(validateJournalBalance(lines).balanced).toBe(true);
  });
});

describe('試算表・損益計算書・貸借対照表', () => {
  const accounts: AccountInfo[] = [
    { id: 'a1', code: '100', name: '現金', category: 'asset' },
    { id: 'a2', code: '130', name: '売掛金', category: 'asset' },
    { id: 'l1', code: '200', name: '買掛金', category: 'liability' },
    { id: 'r1', code: '400', name: '売上高', category: 'revenue' },
    { id: 'e1', code: '500', name: '仕入高', category: 'expense' },
  ];
  // 現金売上10万 / 掛売上5万 / 掛仕入6万
  const lines: PostedLine[] = [
    { accountId: 'a1', side: 'debit', amount: 100000 },
    { accountId: 'r1', side: 'credit', amount: 100000 },
    { accountId: 'a2', side: 'debit', amount: 50000 },
    { accountId: 'r1', side: 'credit', amount: 50000 },
    { accountId: 'e1', side: 'debit', amount: 60000 },
    { accountId: 'l1', side: 'credit', amount: 60000 },
  ];

  it('試算表: 科目別の正規残高', () => {
    const tb = aggregateTrialBalance(lines, accounts);
    expect(tb.find((r) => r.account.code === '100')?.balance).toBe(100000);
    expect(tb.find((r) => r.account.code === '400')?.balance).toBe(150000);
    expect(tb.find((r) => r.account.code === '200')?.balance).toBe(60000);
  });
  it('P/L: 売上150,000 − 仕入60,000 = 利益90,000', () => {
    const pl = buildProfitAndLoss(aggregateTrialBalance(lines, accounts));
    expect(pl.revenueTotal).toBe(150000);
    expect(pl.expenseTotal).toBe(60000);
    expect(pl.netIncome).toBe(90000);
  });
  it('B/S: 資産 = 負債 + 純資産 + 当期純利益 で一致', () => {
    const bs = buildBalanceSheet(aggregateTrialBalance(lines, accounts));
    expect(bs.assetTotal).toBe(150000);
    expect(bs.liabilityTotal).toBe(60000);
    expect(bs.netIncome).toBe(90000);
    expect(bs.balanced).toBe(true);
  });
});
