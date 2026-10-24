/**
 * 照合（売上・現金・在庫。/app/reconciliation）の決まりごと（純関数・tests/native-reconciliation.test.ts）。
 * 読み込みは lib/reconciliation-server.ts（Web のページと iPad ネイティブで同じ。2026-10-24 Ronnie「全部ネイティブ」）
 */

export type ReconStatus = 'ok' | 'mismatch' | 'no_data';

export const RECON_STATUS_LABEL: Record<ReconStatus, string> = { ok: '一致', mismatch: '不一致', no_data: 'データなし' };

/** 'storeId:YYYY-MM-DD' 形式の source_id から日付部分を取り出す */
export function dateOfKey(key: string): string {
  const sep = key.indexOf(':');
  return sep >= 0 ? key.slice(sep + 1) : key;
}

export interface ReconScope {
  from: string;
  to: string;
  /** '' は全社（全店舗） */
  storeId: string;
  storeName: string | null;
  storeIds: string[];
}

/** 期間・店舗（Web と同じ：既定は 直近7日・本部は全社／店舗のアカウントは今の店。開始＞終了なら入れ替える） */
export function reconciliationScope(
  ctx: { isHq: boolean; currentStore: { id: string } | null; stores: { id: string; name: string }[] },
  sp: { from?: string; to?: string; store?: string },
  today: string,
  sixDaysAgo: string
): ReconScope {
  let from = sp.from || sixDaysAgo;
  let to = sp.to || today;
  if (from > to) [from, to] = [to, from];
  const storeId = sp.store || (ctx.isHq ? '' : (ctx.currentStore?.id ?? ''));
  const storeName = storeId ? (ctx.stores.find((s) => s.id === storeId)?.name ?? null) : null;
  const storeIds = storeId ? [storeId] : ctx.stores.map((s) => s.id);
  return { from, to, storeId, storeName, storeIds };
}

/** 売上照合：データ無し／差額 0 なら一致 */
export function salesReconStatus(hasData: boolean, diffPayments: number, diffJournal: number): ReconStatus {
  if (!hasData) return 'no_data';
  return diffPayments === 0 && diffJournal === 0 ? 'ok' : 'mismatch';
}

/** 全体：どれか不一致なら不一致、全部一致なら一致、ほかはデータ不足 */
export function overallReconStatus(statuses: ReconStatus[]): ReconStatus {
  if (statuses.some((s) => s === 'mismatch')) return 'mismatch';
  if (statuses.every((s) => s === 'ok')) return 'ok';
  return 'no_data';
}

/** 差額の表示（±0・+¥1,000・-¥500。Web と同じ） */
export function signedDiff(v: number, yen: (n: number) => string): string {
  if (v === 0) return '±0';
  return `${v > 0 ? '+' : ''}${yen(v)}`;
}
