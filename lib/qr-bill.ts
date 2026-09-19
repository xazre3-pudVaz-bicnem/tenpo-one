/**
 * QR注文の「お会計伝票」を今このタイミングで出すべきか、の判定（純関数・テスト対象）。
 * 実際の取得と印刷ジョブ登録は lib/print-queue.ts の generateQrBillJobs が行う。
 */

/** 同じ注文に続けて品が入ったら1枚にまとめる待ち（ミリ秒） */
export const QR_BILL_BATCH_DELAY_MS = 3_000;
/** これより古い追加は伝票にしない（プリンタ復帰時に昔の注文が大量に出るのを防ぐ） */
export const QR_BILL_WINDOW_MS = 30 * 60_000;

export interface QrBillCandidate {
  orderId: string;
  /** その注文の有効な明細の追加時刻（ミリ秒） */
  itemAddedAt: number[];
  /** 前回この注文のお会計伝票を積んだ時刻（ミリ秒）。無ければ undefined */
  lastSlipAt?: number;
}

/**
 * 印字対象の注文IDを返す。
 * - 明細が無い注文は出さない
 * - 前回の伝票以降に追加が無ければ出さない（重複防止）
 * - 最後の追加から BATCH_DELAY 経つまでは待つ（1回の注文を1枚にまとめる）
 * - 最後の追加が WINDOW より古ければ出さない
 */
export function selectQrOrdersToPrint(candidates: QrBillCandidate[], now: number): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (c.itemAddedAt.length === 0) continue;
    const latestAdd = Math.max(...c.itemAddedAt);
    if (latestAdd <= (c.lastSlipAt ?? 0)) continue;
    if (now - latestAdd < QR_BILL_BATCH_DELAY_MS) continue;
    if (now - latestAdd > QR_BILL_WINDOW_MS) continue;
    out.push(c.orderId);
  }
  return out;
}
