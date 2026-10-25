import type { ScanAction, ScanCandidate } from '@/app/app/scan/actions';
import { BILL_CATEGORY_LABELS, PAYMENT_LABELS, isCashPayment, type ScanReading } from '@/lib/receipt-read';

/**
 * まとめて取り込み（ScanSnap）の「登録先」の選択肢（純関数）。
 * Web の components/scan/scan-bulk-import.tsx（ConfirmCard）と iPad のネイティブ（lib/native-modules/scan-bulk.ts が返す）で同じ。
 *   レシート（現金・わからない）で出金に紐付けられる → 同じ金額の出金ごとに「M/D の出金 ¥… に紐付け」
 *   レシート → レシートとして保存／請求書 → 月払い（費目ごと）／いつでも「あとで（保存ボックスに残す）」
 */
export interface ScanChoice {
  key: string;
  action: ScanAction;
  /** action が attach のときの出金 */
  txId?: string;
  label: string;
  sub?: string;
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function scanFilingChoices(
  r: ScanReading,
  plan: { canAttach: boolean; candidates: ScanCandidate[] } | null | undefined
): ScanChoice[] {
  const isReceipt = r.kind === 'receipt';
  const cash = isReceipt && isCashPayment(r.payment);
  const choices: ScanChoice[] = [];
  if (isReceipt && cash && plan?.canAttach) {
    for (const c of plan.candidates) {
      choices.push({ key: c.id, action: 'attach', txId: c.id, label: `${md(c.businessDate)} の出金 ${yen(c.amount)} に紐付け`, sub: c.label });
    }
  }
  if (isReceipt) {
    choices.push({
      key: 'receipt',
      action: 'receipt',
      label: cash ? 'レシートとして保存（出金に紐付けない）' : `レシートとして保存（${r.payment ? PAYMENT_LABELS[r.payment] : ''}払い）`,
    });
  } else {
    const cat = r.category ?? 'vendor';
    choices.push({ key: 'bill', action: 'bill', label: cat === 'vendor' ? '月払いに登録（仕入先の請求書）' : `月払い：${BILL_CATEGORY_LABELS[cat]}（月次清算で反映）` });
  }
  choices.push({ key: 'keep', action: 'keep', label: 'あとで（保存ボックスに残す）' });
  return choices;
}
