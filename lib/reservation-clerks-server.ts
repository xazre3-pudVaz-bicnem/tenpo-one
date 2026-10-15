/**
 * 予約の担当者の選択肢＝レジの担当名（pos_clerks）。2026-10-15 Ronnie「台帳の担当者は端末ではなくレジの担当名。レジと台帳は同じ」。
 * 店舗ごとに、表示中（active）の担当者を並び順どおりに返す。読めなければ空（担当者の選択が「未設定」だけになる）。
 */
import type { createClient } from './supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ReservationClerkOption = { id: string; name: string };

export async function reservationClerkOptions(
  supabase: Supabase,
  storeIds: readonly string[]
): Promise<Record<string, ReservationClerkOption[]>> {
  const out: Record<string, ReservationClerkOption[]> = {};
  if (storeIds.length === 0) return out;
  const { data, error } = await supabase
    .from('pos_clerks')
    .select('id, name, store_id')
    .in('store_id', [...storeIds])
    .eq('status', 'active')
    .order('sort_order')
    .order('name');
  if (error) return out;
  for (const c of (data ?? []) as { id: string; name: string; store_id: string }[]) {
    (out[c.store_id] ??= []).push({ id: c.id, name: c.name });
  }
  return out;
}
