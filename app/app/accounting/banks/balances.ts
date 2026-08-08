/**
 * 銀行口座詳細ページ（[id]/page.tsx）向けの参考表示: 売掛金・買掛金の現在残高。
 * journal_entry_lines（posted分のみ）を単純集計する。金額は正規残高（資産:借方-貸方 / 負債:貸方-借方）。
 * サーバーコンポーネントから直接呼び出すだけの薄いヘルパーのため 'use server' は付けない。
 */

import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface SubTypeAccountBalance {
  accountId: string;
  code: string;
  name: string;
  /** 正規残高（マイナスは通常発生しないが、貸借が崩れているデータの可視化のためそのまま表示する） */
  balance: number;
}

export interface ReceivablePayableBalances {
  receivables: SubTypeAccountBalance[];
  payables: SubTypeAccountBalance[];
  receivableTotal: number;
  payableTotal: number;
}

/** 組織全体の売掛金(receivable)・買掛金(payable)科目の現在残高を集計する（消込＝仕訳計上で減る参考値） */
export async function loadReceivablePayableBalances(supabase: Supabase, organizationId: string): Promise<ReceivablePayableBalances> {
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code, name, sub_type')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .in('sub_type', ['receivable', 'payable']);
  const targets = accounts ?? [];
  if (targets.length === 0) {
    return { receivables: [], payables: [], receivableTotal: 0, payableTotal: 0 };
  }

  const accountIds = targets.map((a) => a.id as string);
  const { data: lines } = await supabase
    .from('journal_entry_lines')
    .select('account_id, side, amount, journal_entries!inner(status)')
    .eq('organization_id', organizationId)
    .in('account_id', accountIds)
    .eq('journal_entries.status', 'posted');

  const netDebitByAccount = new Map<string, number>();
  for (const l of lines ?? []) {
    const accountId = l.account_id as string;
    const delta = l.side === 'debit' ? (l.amount as number) : -(l.amount as number);
    netDebitByAccount.set(accountId, (netDebitByAccount.get(accountId) ?? 0) + delta);
  }

  const receivables: SubTypeAccountBalance[] = [];
  const payables: SubTypeAccountBalance[] = [];
  for (const a of targets) {
    const netDebit = netDebitByAccount.get(a.id as string) ?? 0; // 借方-貸方
    const row: SubTypeAccountBalance = {
      accountId: a.id as string,
      code: a.code as string,
      name: a.name as string,
      balance: a.sub_type === 'receivable' ? netDebit : -netDebit, // 買掛金は負債なので貸方-借方
    };
    if (a.sub_type === 'receivable') receivables.push(row);
    else payables.push(row);
  }

  return {
    receivables,
    payables,
    receivableTotal: receivables.reduce((s, r) => s + r.balance, 0),
    payableTotal: payables.reduce((s, r) => s + r.balance, 0),
  };
}
