/** A successful send owns the rows it marked sent; an empty/repeated send must not queue another slip. */
export async function autoOrderSlipAfterSend(
  sent: number,
  eligible: () => Promise<boolean>,
  enqueue: () => Promise<{ ok: boolean; error?: string }>
): Promise<string | null> {
  if (sent <= 0) return null;
  try {
    if (!await eligible()) return null;
    const result = await enqueue();
    return result.ok ? null : `会計伝票を印刷できませんでした: ${result.error ?? 'プリンターを確認してください'}`;
  } catch {
    return '会計伝票の自動印刷を確認できませんでした。必要なら手動で発行してください';
  }
}
