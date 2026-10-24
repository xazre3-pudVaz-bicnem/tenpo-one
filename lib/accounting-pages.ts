/**
 * 会計の画面（Web の /app/accounting/* と iPad ネイティブ lib/native-modules/accounting.ts）で共通の純関数。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で各 page.tsx から移した（中身は同じ）。
 */
import type { OperatingStatement } from '@/lib/accounting';
import type { SubType } from '@/components/accounting/labels';
import type { AutoSourceType } from '@/app/app/accounting/auto/engine';

/** 'YYYY-MM-DD' の月初 */
export function firstDayOfMonth(dateJst: string): string {
  return `${dateJst.slice(0, 7)}-01`;
}

/** 'YYYY-MM-DD' の delta 日後（UTCカレンダー演算・TZ非依存） */
export function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM' を delta ヶ月ずらす */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' の月初〜月末 */
export function monthRange(ym: string): { from: string; to: string } {
  return { from: `${ym}-01`, to: addDays(`${shiftMonth(ym, 1)}-01`, -1) };
}

/** from〜to に含まれる暦月の一覧（'YYYY-MM'）。最大12ヶ月まで */
export function monthsInRange(from: string, to: string): string[] {
  const startYm = from.slice(0, 7);
  const endYm = to.slice(0, 7);
  const result: string[] = [];
  let cur = startYm;
  let guard = 0;
  while (cur <= endYm && guard < 13) {
    result.push(cur);
    cur = shiftMonth(cur, 1);
    guard += 1;
  }
  return result;
}

/** 'YYYY-MM' → 'YYYY年M月' */
export function monthLabelJa(month: string): string {
  const [y, m] = month.split('-');
  return `${y}年${Number(m)}月`;
}

/** 損益の段階（財務レポートの期間比較・月別推移の行） */
export const STATEMENT_STAGE_ROWS: { label: string; get: (s: OperatingStatement) => number; emphasize?: boolean }[] = [
  { label: '売上高', get: (s) => s.revenueTotal },
  { label: '売上原価', get: (s) => s.cogsTotal },
  { label: '売上総利益', get: (s) => s.grossProfit, emphasize: true },
  { label: '人件費', get: (s) => s.laborTotal },
  { label: '経費', get: (s) => s.opexTotal },
  { label: '営業利益', get: (s) => s.operatingIncome, emphasize: true },
];

/** 自動仕訳ページの期間未指定時の既定値（先月）。'YYYY-MM-DD' */
export function defaultAutoPeriod(now: Date = new Date()): { from: string; to: string } {
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y = jst.getFullYear();
  const m = jst.getMonth() + 1; // 1-12（今月）
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const from = `${py}-${String(pm).padStart(2, '0')}-01`;
  const lastDay = new Date(py, pm, 0).getDate();
  const to = `${py}-${String(pm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/** 帳簿ページのタブ */
export type LedgerTab = 'journal' | 'general' | 'cash' | 'bank' | 'receivable' | 'payable';
export const LEDGER_TABS: { key: LedgerTab; label: string }[] = [
  { key: 'journal', label: '仕訳帳' },
  { key: 'general', label: '総勘定元帳' },
  { key: 'cash', label: '現金出納帳' },
  { key: 'bank', label: '預金出納帳' },
  { key: 'receivable', label: '売掛帳' },
  { key: 'payable', label: '買掛帳' },
];
export const LEDGER_TAB_SUBTYPE: Partial<Record<LedgerTab, SubType>> = { cash: 'cash', bank: 'bank', receivable: 'receivable', payable: 'payable' };

/** 銀行口座の種別 */
export const BANK_ACCOUNT_TYPE_LABELS: Record<string, string> = { ordinary: '普通', checking: '当座', savings: '貯蓄' };

/** 銀行取引に登録順の残高を付ける（入金 − 出金の累計） */
export function withRunningBalance<T extends { deposit: number; withdrawal: number }>(txs: T[]): (T & { runningBalance: number })[] {
  return txs.reduce<(T & { runningBalance: number })[]>((acc, t) => {
    const prevBalance = acc.length > 0 ? acc[acc.length - 1].runningBalance : 0;
    acc.push({ ...t, runningBalance: prevBalance + t.deposit - t.withdrawal });
    return acc;
  }, []);
}

/** 自動仕訳ページの区分カード（タイトル・説明）。from〜to は売上・返金だけが使う */
export function autoSourceDefs(from: string, to: string): { sourceType: AutoSourceType; title: string; hint: string }[] {
  return [
    {
      sourceType: 'pos_sales',
      title: '売上（POS）',
      hint: `${from} 〜 ${to} の営業日ごとに、現金/キャッシュレス×標準/軽減税率で1日1仕訳を作成します`,
    },
    {
      sourceType: 'pos_refund',
      title: '返金（POS）',
      hint: `${from} 〜 ${to} の返金の営業日ごとに、借方に売上高、貸方に現金/売掛金（キャッシュレス）で1日1仕訳を作成します。取引取消（VOID）も金額として含みます。計上日は返金の営業日で、元売上の日ではありません`,
    },
    {
      sourceType: 'purchase',
      title: '仕入（請求書）',
      hint: '承認済み・支払予定・支払済みで未仕訳の請求書から仕入高/買掛金の仕訳を作成します',
    },
    {
      sourceType: 'expense',
      title: '経費',
      hint: '承認済みで未仕訳の経費から、費目に対応する勘定科目の仕訳を作成します',
    },
    {
      sourceType: 'petty_cash',
      title: '小口現金',
      hint: '承認済みで未仕訳の小口現金の入出金から仕訳を作成します',
    },
    {
      sourceType: 'payroll',
      title: '給与',
      hint: '確定（承認済み）で未仕訳の給与から、給与手当/未払費用の仕訳を作成します',
    },
  ];
}
