import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  addDays,
  autoSourceDefs,
  defaultAutoPeriod,
  firstDayOfMonth,
  monthLabelJa,
  monthRange,
  monthsInRange,
  shiftMonth,
  withRunningBalance,
  LEDGER_TABS,
  LEDGER_TAB_SUBTYPE,
  STATEMENT_STAGE_ROWS,
} from '@/lib/accounting-pages';
import { guessBankCsvMapping, isBankCsvMappingComplete, normalizeAmount, normalizeDate, parseBankCsvRow } from '@/lib/bank-csv';
import type { OperatingStatement } from '@/lib/accounting';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** 2026-10-24 22:05 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」→ 会計（/app/accounting/*）をネイティブに */
describe('会計の画面の共通の純関数（lib/accounting-pages.ts）', () => {
  it('日付・月の計算（財務レポートの期間比較・月別推移）', () => {
    expect(firstDayOfMonth('2026-10-24')).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', -12)).toBe('2025-10');
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthsInRange('2026-01-15', '2026-03-02')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthsInRange('2026-10-01', '2026-10-24')).toEqual(['2026-10']);
    // 13ヶ月で打ち切り（>12 なら月別推移は出さない）
    expect(monthsInRange('2024-01-01', '2026-12-31')).toHaveLength(13);
    expect(monthLabelJa('2026-04')).toBe('2026年4月');
  });

  it('自動仕訳の既定の期間は先月（JST）', () => {
    expect(defaultAutoPeriod(new Date('2026-10-24T03:00:00Z'))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(defaultAutoPeriod(new Date('2026-01-10T03:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    // UTC ではまだ 2月末でも JST では 3月 → 先月は 2月
    expect(defaultAutoPeriod(new Date('2026-02-28T20:00:00Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('銀行取引の残高は登録順の 入金 − 出金 の累計', () => {
    const rows = withRunningBalance([
      { id: 'a', deposit: 10000, withdrawal: 0 },
      { id: 'b', deposit: 0, withdrawal: 3000 },
      { id: 'c', deposit: 500, withdrawal: 0 },
    ]);
    expect(rows.map((r) => r.runningBalance)).toEqual([10000, 7000, 7500]);
    expect(rows[1].id).toBe('b');
    expect(withRunningBalance([])).toEqual([]);
  });

  it('帳簿のタブ・自動仕訳の区分・損益の段階', () => {
    expect(LEDGER_TABS.map((t) => t.key)).toEqual(['journal', 'general', 'cash', 'bank', 'receivable', 'payable']);
    expect(LEDGER_TAB_SUBTYPE.general).toBeUndefined();
    expect(LEDGER_TAB_SUBTYPE.payable).toBe('payable');
    const defs = autoSourceDefs('2026-09-01', '2026-09-30');
    expect(defs.map((d) => d.sourceType)).toEqual(['pos_sales', 'pos_refund', 'purchase', 'expense', 'petty_cash', 'payroll']);
    expect(defs[0].hint).toContain('2026-09-01 〜 2026-09-30');
    const s = { revenueTotal: 100, cogsTotal: 30, grossProfit: 70, laborTotal: 20, opexTotal: 10, operatingIncome: 40 } as OperatingStatement;
    expect(STATEMENT_STAGE_ROWS.map((r) => r.get(s))).toEqual([100, 30, 70, 20, 10, 40]);
    expect(STATEMENT_STAGE_ROWS.filter((r) => r.emphasize).map((r) => r.label)).toEqual(['売上総利益', '営業利益']);
  });
});

describe('銀行明細CSVの読み取り（lib/bank-csv.ts。Web と iPad で同じ）', () => {
  it('日付・金額のゆらぎ', () => {
    expect(normalizeDate('2026/1/5')).toBe('2026-01-05');
    expect(normalizeDate('2026.10.24')).toBe('2026-10-24');
    expect(normalizeDate('２０２６年')).toBeNull();
    expect(normalizeDate('10/24')).toBeNull();
    expect(normalizeAmount('¥1,200')).toBe(1200);
    expect(normalizeAmount('3,000円')).toBe(3000);
    expect(normalizeAmount('-500')).toBe(500);
    expect(normalizeAmount('')).toBe(0);
    expect(normalizeAmount('abc')).toBeNaN();
  });

  it('列名から対応付けを推定し、揃ったかを判定', () => {
    const m = guessBankCsvMapping(['取引日付', '摘要', 'お預け入れ', 'お引き出し', '残高']);
    expect(m).toEqual({ date: 0, description: 1, deposit: 2, withdrawal: 3 });
    expect(isBankCsvMappingComplete(m)).toBe(true);
    const partial = guessBankCsvMapping(['date', 'memo', 'amount']);
    expect(partial).toEqual({ date: 0, description: null, deposit: null, withdrawal: null });
    expect(isBankCsvMappingComplete(partial)).toBe(false);
    expect(isBankCsvMappingComplete({ date: 0, description: 1, deposit: null, withdrawal: 2 })).toBe(true);
  });

  it('1行の読み取り（Web と同じエラー文）', () => {
    const m = { date: 0, description: 1, deposit: 2, withdrawal: 3 };
    expect(parseBankCsvRow(['2026/10/1', ' 家賃 ', '', '120,000'], m)).toEqual({
      parsed: { date: '2026-10-01', description: '家賃', deposit: 0, withdrawal: 120000 },
      error: null,
    });
    expect(parseBankCsvRow(['x', '家賃', '', '1'], m).error).toBe('日付を解釈できません（x）');
    expect(parseBankCsvRow(['2026/10/1', ' ', '1', ''], m).error).toBe('摘要が空です');
    expect(parseBankCsvRow(['2026/10/1', 'a', 'x', ''], m).error).toBe('金額を解釈できません');
    expect(parseBankCsvRow(['2026/10/1', 'a', '0', ''], m).error).toBe('入金・出金がいずれも0円です');
    expect(parseBankCsvRow(['2026/10/1', 'a', '1', '1'], m).error).toBe('入金・出金が両方入力されています');
  });
});

describe('会計のネイティブの配線', () => {
  it('サーバー：part=accounting と acc* の操作を registry に登録', () => {
    const registry = read('lib/native-modules/registry.ts');
    expect(registry).toContain('accounting: accountingGet,');
    expect(registry).toContain('...ACCOUNTING_POST,');
    const mod = read('lib/native-modules/accounting.ts');
    for (const t of ['accJournalSave', 'accJournalPost', 'accJournalVoid', 'accPeriodClose', 'accPeriodReopen', 'accBankCsvPreview', 'accBankCsvImport', 'accBankJournal', 'accAutoCreate', 'accAssetSave']) {
      expect(mod).toContain(`  ${t},`);
    }
    // 入口は Web の会計の画面と同じ（機能 accounting・csv.export）
    expect(mod).toContain("ctx.disabledFeatures?.has('accounting')");
    expect(mod).toContain("can(ctx.role, 'csv.export')");
  });

  it('Web の page.tsx は同じ読み込み（lib/accounting-pages-server.ts）を呼ぶ', () => {
    expect(read('app/app/accounting/page.tsx')).toContain('loadJournalPage(supabase, ctx, sp)');
    expect(read('app/app/accounting/ledger/page.tsx')).toContain('loadLedgerPage(supabase, ctx, sp)');
    expect(read('app/app/accounting/statements/page.tsx')).toContain('loadStatementsPage(supabase, ctx, sp)');
    expect(read('app/app/accounting/banks/page.tsx')).toContain('loadBankAccountsPage(supabase, ctx)');
    expect(read('app/app/accounting/banks/[id]/page.tsx')).toContain('loadBankAccountDetail(supabase, ctx, id)');
    expect(read('app/app/accounting/auto/page.tsx')).toContain('loadAutoJournalPage(supabase, ctx, sp)');
    expect(read('app/app/accounting/assets/page.tsx')).toContain('loadFixedAssetsPage(supabase, ctx)');
    expect(read('components/accounting/bank-csv-import.tsx')).toContain("from '@/lib/bank-csv'");
  });

  it('iPad：/app/accounting をネイティブで開く（下の道は route.rest）', () => {
    const modules = read('ios/Shared/NativeModules.swift');
    expect(modules).toContain('("/app/accounting", "accounting"),');
    expect(modules).toContain('case "accounting": NativeAccountingView(route: route)');
    const view = read('ios/Shared/NativeAccountingView.swift');
    expect(view).toContain('part: "accounting"');
    expect(view).toContain('state.goNativeHome()');
    // iOS 16 でも動く（2 引数の onChange は使わない）
    for (const f of ['NativeAccountingView.swift', 'NativeAccountingJournal.swift', 'NativeAccountingBooks.swift', 'NativeAccountingBanks.swift', 'NativeAccountingAuto.swift']) {
      const src = read(`ios/Shared/${f}`);
      expect(src).not.toMatch(/onChange\(of: [^)]*\) \{ _?[a-zA-Z]*, [a-zA-Z_]* in/);
      expect(src).not.toContain('UnevenRoundedRectangle');
    }
  });
});
