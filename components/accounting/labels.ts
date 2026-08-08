/** ネイティブ会計モジュール共通の表示ラベル定義 */
import type { BadgeTone } from '@/components/ui/badge';
import type { AccountCategory } from '@/lib/accounting';

export const ACCOUNT_CATEGORY_LABELS: Record<AccountCategory, string> = {
  asset: '資産',
  liability: '負債',
  equity: '純資産',
  revenue: '収益',
  expense: '費用',
};

/** 財務諸表・マスタ画面での表示順 */
export const ACCOUNT_CATEGORY_ORDER: AccountCategory[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export type SubType = 'cash' | 'bank' | 'receivable' | 'payable' | 'inventory';

export const SUB_TYPE_LABELS: Record<SubType, string> = {
  cash: '現金',
  bank: '預金',
  receivable: '売掛金',
  payable: '買掛金・未払金',
  inventory: '棚卸資産',
};

export type JournalStatus = 'draft' | 'posted' | 'voided';

export const JOURNAL_STATUS_LABELS: Record<JournalStatus, string> = {
  draft: '下書き',
  posted: '確定',
  voided: '取消',
};

export const JOURNAL_STATUS_TONES: Record<JournalStatus, BadgeTone> = {
  draft: 'gray',
  posted: 'success',
  voided: 'danger',
};

export const JOURNAL_STATUS_OPTIONS: JournalStatus[] = ['draft', 'posted', 'voided'];

export type SourceType =
  | 'manual' | 'pos_sales' | 'pos_refund' | 'purchase' | 'expense' | 'petty_cash' | 'payroll' | 'bank' | 'fixed_asset'
  | 'correction' | 'opening';

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  manual: '手入力',
  pos_sales: 'POS売上',
  pos_refund: '売上返金',
  purchase: '仕入',
  expense: '経費',
  petty_cash: '小口現金',
  payroll: '給与',
  bank: '銀行',
  fixed_asset: '固定資産',
  correction: '修正仕訳',
  opening: '期首残高',
};

export const SOURCE_TYPE_OPTIONS: SourceType[] = [
  'manual', 'pos_sales', 'pos_refund', 'purchase', 'expense', 'petty_cash', 'payroll', 'bank', 'fixed_asset', 'correction', 'opening',
];

/** 一覧・自動仕訳カードでの区分バッジのトーン（未指定はBadgeの既定tone=grayを使う） */
export const SOURCE_TYPE_TONES: Partial<Record<SourceType, BadgeTone>> = {
  pos_refund: 'warning',
};

export type PeriodStatus = 'open' | 'closed';

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  open: '未締め',
  closed: '締め済み',
};

export const PERIOD_STATUS_TONES: Record<PeriodStatus, BadgeTone> = {
  open: 'gray',
  closed: 'success',
};

export type AssetStatus = 'in_use' | 'disposed' | 'sold' | 'deleted';

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  in_use: '使用中',
  disposed: '除却',
  sold: '売却',
  deleted: '削除',
};

export const ASSET_STATUS_TONES: Record<AssetStatus, BadgeTone> = {
  in_use: 'success',
  disposed: 'gray',
  sold: 'primary',
  deleted: 'danger',
};

export type DepreciationMethod = 'straight_line' | 'declining_balance' | 'non_depreciable';

export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethod, string> = {
  straight_line: '定額法',
  declining_balance: '定率法',
  non_depreciable: '非減価償却',
};

export const DEPRECIATION_METHOD_OPTIONS: DepreciationMethod[] = ['straight_line', 'declining_balance', 'non_depreciable'];

/** RPC / トリガーが投げる例外メッセージ（先頭一致・部分一致）を日本語に変換する */
export function mapAccountingError(message: string): string {
  if (message.includes('PERIOD_CLOSED')) return 'この月は締め済みです';
  if (message.includes('UNBALANCED')) return `借方と貸方の金額が一致していません（${message}）`;
  if (message.includes('INSUFFICIENT_LINES')) return '明細は2行以上入力してください';
  if (message.includes('ENTRY_NOT_DRAFT')) return 'この仕訳はすでに確定・取消されています';
  if (message.includes('ENTRY_NOT_POSTED')) return 'この仕訳は確定済みではありません';
  if (message.includes('ENTRY_NOT_FOUND')) return '仕訳が見つかりません';
  if (message.includes('POSTED_ENTRY_IMMUTABLE')) return '確定済みの仕訳は変更できません（修正仕訳を作成してください）';
  if (message.includes('DRAFT_ENTRIES_REMAIN')) return '下書きの仕訳が残っています';
  if (message.includes('REASON_REQUIRED')) return '理由を入力してください';
  if (message.includes('FORBIDDEN')) return 'この操作を行う権限がありません';
  return message;
}
