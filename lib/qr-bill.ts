/**
 * お客様が QR 画面で「お会計」を押したときの「お会計伝票」を、今このタイミングで出すべきか（純関数・テスト対象）。
 * 実際の取得と印刷ジョブ登録は lib/print-queue.ts の generateCheckoutBillJobs が行う。
 *
 * 2026-09-28 FULLMOoN 新宿「オーダーのたびに会計伝票が出る」→ Ronnie「お客様がお会計を押したら卓に通知、
 * スタッフが伝票を持って行く」。品が追加されるたびに出す方式（dinii 風の履歴伝票）はやめた。
 */

/** これより古い「お会計」は伝票にしない（プリンタ復帰時に昔の呼び出しが大量に出るのを防ぐ） */
export const CHECKOUT_BILL_WINDOW_MS = 30 * 60_000;

export interface CheckoutBillCandidate {
  orderId: string;
  /** お客様が「お会計」を押した時刻（ミリ秒）。同じ注文に複数あれば一番新しいもの */
  requestedAt: number;
  /** 有効な明細があるか（無ければ出すものが無い） */
  hasItems: boolean;
  /** 前回この注文のお会計伝票を積んだ時刻（ミリ秒）。無ければ undefined */
  lastSlipAt?: number;
}

/**
 * 印字対象の注文IDを返す。
 * - 明細が無い注文は出さない
 * - 「お会計」のあとに一度でも伝票を出していれば出さない（1回の呼び出しに1枚。ポーリングのたびに重複しない）
 * - 「お会計」が WINDOW より古ければ出さない
 */
export function selectCheckoutBillsToPrint(candidates: CheckoutBillCandidate[], now: number): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (!c.hasItems) continue;
    if (now - c.requestedAt > CHECKOUT_BILL_WINDOW_MS) continue;
    if ((c.lastSlipAt ?? 0) >= c.requestedAt) continue;
    out.push(c.orderId);
  }
  return out;
}
