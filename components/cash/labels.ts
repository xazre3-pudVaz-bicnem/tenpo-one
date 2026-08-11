/** レジ締め・小口現金・経費モジュール共通の表示ラベル定義 */

export type CashKind =
  | 'sale'
  | 'refund'
  | 'deposit'
  | 'withdrawal'
  | 'petty_in'
  | 'petty_out'
  | 'petty_advance'
  | 'petty_settlement'
  | 'adjustment';

export const KIND_LABELS: Record<CashKind, string> = {
  sale: '現金売上',
  refund: '現金返金',
  deposit: '入金',
  withdrawal: '出金',
  petty_in: '小口入金',
  petty_out: '小口出金',
  petty_advance: '立替',
  petty_settlement: '精算',
  adjustment: '調整',
};

/**
 * 現金が増える方向のkind。
 * petty_advance（立替）はスタッフが立て替えた支出の記録であり、店舗の現金は動かないため含めない。
 */
export const IN_KINDS: CashKind[] = ['sale', 'deposit', 'petty_in'];
/** 現金が減る方向のkind。petty_settlement（精算）は立替の払い戻しで現金が減る。 */
export const OUT_KINDS: CashKind[] = ['refund', 'withdrawal', 'petty_out', 'petty_settlement'];

/** レジ台帳（register_session_id必須）で使われるkind。POSの現金売上・返金・中間入出金はこちら。 */
export const REGISTER_KINDS: CashKind[] = ['sale', 'refund', 'deposit', 'withdrawal'];
/** 小口現金台帳（register_session_id は常にnull）で使われるkind。レジ現金とは別台帳で二重計上を防ぐ。 */
export const PETTY_KINDS: CashKind[] = ['petty_in', 'petty_out', 'petty_advance', 'petty_settlement'];

export const METHOD_LABELS: Record<string, string> = {
  cash: '現金',
  credit: 'クレジット',
  qr: 'QRコード決済',
  emoney: '電子マネー',
  voucher: '商品券',
  on_account: '掛売',
  points: 'ポイント',
  external: '外部端末(stera等)',
  other: 'その他',
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  pending: '承認待ち',
  approved: '承認済み',
  rejected: '差戻し',
};

export const APPROVAL_TONES: Record<ApprovalStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export type PaidVia = 'petty_cash' | 'register' | 'bank' | 'personal';

export const PAID_VIA_LABELS: Record<PaidVia, string> = {
  petty_cash: '小口現金',
  register: 'レジ',
  bank: '銀行振込',
  personal: '立替（個人）',
};

export type ClosingStatus = 'closed' | 'approved' | 'reopened';

export const CLOSING_STATUS_LABELS: Record<ClosingStatus, string> = {
  closed: '締め済み（承認待ち）',
  approved: '承認済み',
  reopened: '締め後修正（再承認待ち）',
};

export const CLOSING_STATUS_TONES: Record<ClosingStatus, 'primary' | 'success' | 'warning'> = {
  closed: 'primary',
  approved: 'success',
  reopened: 'warning',
};

/** 小口現金の実査（petty_cash_counts）の状態 */
export type PettyCountStatus = 'recorded' | 'approved';

export const PETTY_COUNT_STATUS_LABELS: Record<PettyCountStatus, string> = {
  recorded: '記録済み（承認待ち）',
  approved: '承認済み',
};

export const PETTY_COUNT_STATUS_TONES: Record<PettyCountStatus, 'warning' | 'success'> = {
  recorded: 'warning',
  approved: 'success',
};
