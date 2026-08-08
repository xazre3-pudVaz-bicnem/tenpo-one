/**
 * ネイティブ会計の純関数（テスト対象）。
 * 仕訳の貸借検証・業務データからの自動仕訳生成・試算表/損益/貸借の集計。
 * 記帳方式: 税込経理（金額は税込・tax_treatmentタグで税区分を保持）。
 * 消費税率は consumption_tax_rates（DB・バージョン管理）を参照し、ここでは定数を持たない。
 */

export type TaxTreatment =
  | 'taxable_standard'
  | 'taxable_reduced'
  | 'non_taxable'
  | 'tax_exempt'
  | 'out_of_scope';

export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface JournalLineDraft {
  accountCode: string;
  side: 'debit' | 'credit';
  amount: number; // 円・正の整数
  taxTreatment: TaxTreatment;
  memo?: string;
}

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  taxable_standard: '課税（標準）',
  taxable_reduced: '課税（軽減）',
  non_taxable: '非課税',
  tax_exempt: '免税',
  out_of_scope: '対象外',
};

/** 借方合計=貸方合計の検証（確定はDB側 post_journal_entry でも再検証される） */
export function validateJournalBalance(lines: { side: 'debit' | 'credit'; amount: number }[]): {
  balanced: boolean;
  debit: number;
  credit: number;
} {
  const debit = lines.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0);
  const credit = lines.filter((l) => l.side === 'credit').reduce((a, l) => a + l.amount, 0);
  return {
    balanced:
      debit === credit &&
      debit > 0 &&
      lines.every((l) => Number.isInteger(l.amount) && l.amount > 0),
    debit,
    credit,
  };
}

// -------------------------------------------------------------
// 自動仕訳ビルダー（業務データ → 仕訳候補。再入力ゼロ連動の中核）
// 勘定科目コードは install_standard_accounts の標準テンプレートに対応
// -------------------------------------------------------------

export const STD = {
  cash: '100',
  pettyCash: '101',
  bank: '110',
  receivable: '130',
  payable: '200',
  accruedPayable: '211',
  sales: '400',
  salesReduced: '401',
  purchases: '500',
  salaries: '510',
  misc: '599',
} as const;

/**
 * 日次売上仕訳: 現金売上→現金 / キャッシュレス（クレジット・QR・電子マネー・商品券・掛け）→売掛金
 * 貸方は税率区分別の売上高。
 */
export function buildSalesJournal(input: {
  cashSalesStandard: number;
  cashSalesReduced: number;
  cashlessSalesStandard: number;
  cashlessSalesReduced: number;
}): JournalLineDraft[] {
  const lines: JournalLineDraft[] = [];
  const cash = input.cashSalesStandard + input.cashSalesReduced;
  const cashless = input.cashlessSalesStandard + input.cashlessSalesReduced;
  if (cash > 0) {
    lines.push({ accountCode: STD.cash, side: 'debit', amount: cash, taxTreatment: 'out_of_scope', memo: '現金売上' });
  }
  if (cashless > 0) {
    lines.push({ accountCode: STD.receivable, side: 'debit', amount: cashless, taxTreatment: 'out_of_scope', memo: 'キャッシュレス売上（売掛）' });
  }
  const std = input.cashSalesStandard + input.cashlessSalesStandard;
  const reduced = input.cashSalesReduced + input.cashlessSalesReduced;
  if (std > 0) {
    lines.push({ accountCode: STD.sales, side: 'credit', amount: std, taxTreatment: 'taxable_standard', memo: '売上高（標準税率）' });
  }
  if (reduced > 0) {
    lines.push({ accountCode: STD.salesReduced, side: 'credit', amount: reduced, taxTreatment: 'taxable_reduced', memo: '売上高（軽減税率）' });
  }
  return lines;
}

/**
 * 返金仕訳: 売上のマイナス（借方 売上高）/ 貸方 現金 or 売掛金。
 * 日次・店舗別に集計して source_type='pos_refund'（source_id=`{storeId}:{date}`）で冪等生成する。
 * 税区分別の按分は元注文の8%/10%比率から呼び出し側で算出して渡す。
 */
export function buildRefundJournal(input: {
  cashRefundsStandard: number;
  cashRefundsReduced: number;
  cashlessRefundsStandard: number;
  cashlessRefundsReduced: number;
}): JournalLineDraft[] {
  const lines: JournalLineDraft[] = [];
  const std = input.cashRefundsStandard + input.cashlessRefundsStandard;
  const reduced = input.cashRefundsReduced + input.cashlessRefundsReduced;
  if (std > 0) {
    lines.push({ accountCode: STD.sales, side: 'debit', amount: std, taxTreatment: 'taxable_standard', memo: '売上返金（標準税率）' });
  }
  if (reduced > 0) {
    lines.push({ accountCode: STD.salesReduced, side: 'debit', amount: reduced, taxTreatment: 'taxable_reduced', memo: '売上返金（軽減税率）' });
  }
  const cash = input.cashRefundsStandard + input.cashRefundsReduced;
  const cashless = input.cashlessRefundsStandard + input.cashlessRefundsReduced;
  if (cash > 0) {
    lines.push({ accountCode: STD.cash, side: 'credit', amount: cash, taxTreatment: 'out_of_scope', memo: '現金返金' });
  }
  if (cashless > 0) {
    lines.push({ accountCode: STD.receivable, side: 'credit', amount: cashless, taxTreatment: 'out_of_scope', memo: 'キャッシュレス返金（売掛減）' });
  }
  return lines;
}

/** 仕入請求書仕訳: 仕入高 / 買掛金 */
export function buildPurchaseJournal(input: {
  amount: number;
  taxTreatment?: TaxTreatment;
  vendorName?: string;
}): JournalLineDraft[] {
  return [
    { accountCode: STD.purchases, side: 'debit', amount: input.amount, taxTreatment: input.taxTreatment ?? 'taxable_reduced', memo: input.vendorName ? `仕入（${input.vendorName}）` : '仕入' },
    { accountCode: STD.payable, side: 'credit', amount: input.amount, taxTreatment: 'out_of_scope', memo: '買掛金' },
  ];
}

/** 経費仕訳: 費目科目 / 現金or小口現金or未払金 */
export function buildExpenseJournal(input: {
  amount: number;
  expenseAccountCode: string;
  paidVia: 'petty_cash' | 'register' | 'bank' | 'personal';
  taxTreatment?: TaxTreatment;
  memo?: string;
}): JournalLineDraft[] {
  const creditAccount =
    input.paidVia === 'petty_cash' ? STD.pettyCash
    : input.paidVia === 'register' ? STD.cash
    : input.paidVia === 'bank' ? STD.bank
    : STD.accruedPayable; // 立替（personal）は未払費用
  return [
    { accountCode: input.expenseAccountCode, side: 'debit', amount: input.amount, taxTreatment: input.taxTreatment ?? 'taxable_standard', memo: input.memo },
    { accountCode: creditAccount, side: 'credit', amount: input.amount, taxTreatment: 'out_of_scope' },
  ];
}

/** 給与確定仕訳: 給与手当 / 未払費用（支払時に未払費用/預金で消し込み） */
export function buildPayrollJournal(input: { grossTotal: number; periodLabel: string }): JournalLineDraft[] {
  return [
    { accountCode: STD.salaries, side: 'debit', amount: input.grossTotal, taxTreatment: 'out_of_scope', memo: `給与（${input.periodLabel}）` },
    { accountCode: STD.accruedPayable, side: 'credit', amount: input.grossTotal, taxTreatment: 'out_of_scope', memo: '未払費用' },
  ];
}

// -------------------------------------------------------------
// 帳簿・財務諸表の集計
// -------------------------------------------------------------

export interface PostedLine {
  accountId: string;
  side: 'debit' | 'credit';
  amount: number;
}

export interface AccountInfo {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
}

export interface TrialBalanceRow {
  account: AccountInfo;
  debitTotal: number;
  creditTotal: number;
  /** 正規残高（資産・費用=借方残 / 負債・純資産・収益=貸方残） */
  balance: number;
}

/** 借方残が正規の科目か */
export function isDebitNormal(category: AccountCategory): boolean {
  return category === 'asset' || category === 'expense';
}

/** 試算表の集計 */
export function aggregateTrialBalance(lines: PostedLine[], accounts: AccountInfo[]): TrialBalanceRow[] {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const entry = byAccount.get(line.accountId) ?? { debit: 0, credit: 0 };
    if (line.side === 'debit') entry.debit += line.amount;
    else entry.credit += line.amount;
    byAccount.set(line.accountId, entry);
  }
  return accounts
    .filter((a) => byAccount.has(a.id))
    .map((a) => {
      const { debit, credit } = byAccount.get(a.id)!;
      return {
        account: a,
        debitTotal: debit,
        creditTotal: credit,
        balance: isDebitNormal(a.category) ? debit - credit : credit - debit,
      };
    })
    .sort((a, b) => a.account.code.localeCompare(b.account.code));
}

export interface TrialBalanceRowWithOpening extends TrialBalanceRow {
  /** 期首残高（期間開始前の全確定仕訳から算出した正規残高） */
  openingBalance: number;
  /** 期末残高 = 期首 + 期中の正規残高増減 */
  closingBalance: number;
}

/**
 * 期首残高付き試算表。
 * openingLines = 期間開始日より前の全確定仕訳行、periodLines = 期間内の確定仕訳行。
 * 期中に動きがなくても期首残高がある科目は行として出力する。
 */
export function aggregateTrialBalanceWithOpening(
  openingLines: PostedLine[],
  periodLines: PostedLine[],
  accounts: AccountInfo[]
): TrialBalanceRowWithOpening[] {
  const opening = new Map(aggregateTrialBalance(openingLines, accounts).map((r) => [r.account.id, r.balance]));
  const period = new Map(aggregateTrialBalance(periodLines, accounts).map((r) => [r.account.id, r]));
  return accounts
    .filter((a) => opening.has(a.id) || period.has(a.id))
    .map((a) => {
      const openingBalance = opening.get(a.id) ?? 0;
      const p = period.get(a.id);
      const debitTotal = p?.debitTotal ?? 0;
      const creditTotal = p?.creditTotal ?? 0;
      const balance = p?.balance ?? 0;
      return {
        account: a,
        openingBalance,
        debitTotal,
        creditTotal,
        balance,
        closingBalance: openingBalance + balance,
      };
    })
    .sort((a, b) => a.account.code.localeCompare(b.account.code));
}

// -------------------------------------------------------------
// 段階損益（売上高 − 売上原価 = 売上総利益 − 人件費 − 経費 = 営業利益）
// -------------------------------------------------------------

export type ExpenseClass = 'cogs' | 'labor' | 'opex';

/**
 * 費用科目の区分。標準テンプレートのコード体系に基づく既定分類:
 * 500-509=売上原価（仕入高）、510-519=人件費（給与手当・法定福利費等）、それ以外=経費。
 * カスタム科目体系の企業は分類関数を差し替え可能。
 */
export function classifyExpense(code: string): ExpenseClass {
  const n = Number.parseInt(code, 10);
  if (Number.isInteger(n)) {
    if (n >= 500 && n <= 509) return 'cogs';
    if (n >= 510 && n <= 519) return 'labor';
  }
  return 'opex';
}

export interface OperatingStatement {
  revenues: TrialBalanceRow[];
  cogs: TrialBalanceRow[];
  labor: TrialBalanceRow[];
  opex: TrialBalanceRow[];
  revenueTotal: number;
  cogsTotal: number;
  /** 売上総利益 */
  grossProfit: number;
  laborTotal: number;
  opexTotal: number;
  /** 営業利益 */
  operatingIncome: number;
}

export function buildOperatingStatement(
  tb: TrialBalanceRow[],
  classify: (code: string) => ExpenseClass = classifyExpense
): OperatingStatement {
  const revenues = tb.filter((r) => r.account.category === 'revenue');
  const expenses = tb.filter((r) => r.account.category === 'expense');
  const cogs = expenses.filter((r) => classify(r.account.code) === 'cogs');
  const labor = expenses.filter((r) => classify(r.account.code) === 'labor');
  const opex = expenses.filter((r) => classify(r.account.code) === 'opex');
  const revenueTotal = revenues.reduce((a, r) => a + r.balance, 0);
  const cogsTotal = cogs.reduce((a, r) => a + r.balance, 0);
  const laborTotal = labor.reduce((a, r) => a + r.balance, 0);
  const opexTotal = opex.reduce((a, r) => a + r.balance, 0);
  const grossProfit = revenueTotal - cogsTotal;
  return {
    revenues, cogs, labor, opex,
    revenueTotal, cogsTotal, grossProfit, laborTotal, opexTotal,
    operatingIncome: grossProfit - laborTotal - opexTotal,
  };
}

export interface ProfitAndLoss {
  revenues: TrialBalanceRow[];
  expenses: TrialBalanceRow[];
  revenueTotal: number;
  expenseTotal: number;
  netIncome: number;
}

export function buildProfitAndLoss(tb: TrialBalanceRow[]): ProfitAndLoss {
  const revenues = tb.filter((r) => r.account.category === 'revenue');
  const expenses = tb.filter((r) => r.account.category === 'expense');
  const revenueTotal = revenues.reduce((a, r) => a + r.balance, 0);
  const expenseTotal = expenses.reduce((a, r) => a + r.balance, 0);
  return { revenues, expenses, revenueTotal, expenseTotal, netIncome: revenueTotal - expenseTotal };
}

export interface BalanceSheet {
  assets: TrialBalanceRow[];
  liabilities: TrialBalanceRow[];
  equity: TrialBalanceRow[];
  assetTotal: number;
  liabilityTotal: number;
  equityTotal: number;
  /** 当期純利益（純資産へ加算して貸借が一致する） */
  netIncome: number;
  balanced: boolean;
}

export function buildBalanceSheet(tb: TrialBalanceRow[]): BalanceSheet {
  const assets = tb.filter((r) => r.account.category === 'asset');
  const liabilities = tb.filter((r) => r.account.category === 'liability');
  const equity = tb.filter((r) => r.account.category === 'equity');
  const pl = buildProfitAndLoss(tb);
  const assetTotal = assets.reduce((a, r) => a + r.balance, 0);
  const liabilityTotal = liabilities.reduce((a, r) => a + r.balance, 0);
  const equityTotal = equity.reduce((a, r) => a + r.balance, 0);
  return {
    assets, liabilities, equity,
    assetTotal, liabilityTotal, equityTotal,
    netIncome: pl.netIncome,
    balanced: assetTotal === liabilityTotal + equityTotal + pl.netIncome,
  };
}
