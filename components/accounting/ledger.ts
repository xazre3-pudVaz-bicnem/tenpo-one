/**
 * 帳簿（総勘定元帳・現金出納帳・預金出納帳・売掛帳・買掛帳）共通の残高計算。
 * 借方=増加/貸方=減少（資産・費用）か、貸方=増加/借方=減少（負債・純資産・収益）かは
 * lib/accounting の isDebitNormal に従う。ページ（表示）とCSV出力の双方から使う純関数。
 */
import { isDebitNormal, type AccountCategory } from '@/lib/accounting';
import type { SourceType } from './labels';

export interface LedgerSourceLine {
  side: 'debit' | 'credit';
  amount: number;
}

/**
 * 相手科目名の一覧から表示ラベルを求める。
 * 1科目のみなら科目名、複数科目にまたがる場合は簿記の慣例に従い「諸口」と表示する。
 */
export function resolveCounterLabel(names: string[]): string {
  const unique = [...new Set(names.filter((n) => n.length > 0))];
  if (unique.length === 0) return '—';
  if (unique.length === 1) return unique[0];
  return '諸口';
}

/** 期首（表示期間より前）の累計から繰越残高を求める */
export function computeOpeningBalance(beforeLines: LedgerSourceLine[], category: AccountCategory): number {
  const normal = isDebitNormal(category);
  let balance = 0;
  for (const l of beforeLines) {
    const signed = l.side === 'debit' ? l.amount : -l.amount;
    balance += normal ? signed : -signed;
  }
  return balance;
}

export interface LedgerEntryLine extends LedgerSourceLine {
  entryId: string;
  entryDate: string;
  description: string;
  memo: string | null;
  storeName?: string | null;
  sourceType?: SourceType;
  sourceId?: string | null;
}

export interface LedgerRow {
  entryId: string;
  date: string;
  description: string;
  counter: string;
  memo: string | null;
  debit: number;
  credit: number;
  balance: number;
  storeName?: string | null;
  sourceType?: SourceType;
  sourceId?: string | null;
}

/** 期間内の明細を日付順に並べ、繰越残高から累計残高を計算する */
export function buildLedgerRows(
  periodLines: LedgerEntryLine[],
  category: AccountCategory,
  openingBalance: number,
  counterOf: (entryId: string) => string
): LedgerRow[] {
  const normal = isDebitNormal(category);
  let balance = openingBalance;
  return periodLines.map((l) => {
    const signed = l.side === 'debit' ? l.amount : -l.amount;
    balance += normal ? signed : -signed;
    return {
      entryId: l.entryId,
      date: l.entryDate,
      description: l.description,
      counter: counterOf(l.entryId),
      memo: l.memo,
      debit: l.side === 'debit' ? l.amount : 0,
      credit: l.side === 'credit' ? l.amount : 0,
      balance,
      storeName: l.storeName,
      sourceType: l.sourceType,
      sourceId: l.sourceId,
    };
  });
}
