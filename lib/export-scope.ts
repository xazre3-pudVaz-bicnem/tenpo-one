import type { SessionContext } from '@/lib/auth';

/**
 * CSVエクスポート等でクライアントが指定した store パラメータを検証する。
 * RLSが最終防御だが、多層防御として「アクセス可能店舗（ctx.stores）に含まれる店舗のみ」を
 * アプリ層でも明示的に許可する。指定が無ければ null（＝アクセス可能な全店舗スコープ）。
 *
 * 戻り値:
 *   { ok: true, storeId }        … 検証済みのstoreId（未指定時はfallback）
 *   { ok: false }                … 指定storeが権限外 → 呼び出し側で403を返す
 */
export function resolveExportStore(
  ctx: SessionContext,
  requested: string | null | undefined,
  fallback: string | null = null
): { ok: true; storeId: string | null } | { ok: false } {
  if (!requested) return { ok: true, storeId: fallback };
  if (ctx.stores.some((s) => s.id === requested)) return { ok: true, storeId: requested };
  return { ok: false };
}
