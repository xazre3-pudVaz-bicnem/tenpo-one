import 'server-only';
import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 予約のキーワード（reservations.tags。migration 00099）を予約ごとに読む。
 * 一覧の select には入れず別に読む：列がまだ無いデータベースでも一覧が出るように（そのときは空）。
 */
export async function loadReservationTags(supabase: Supabase, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return map;
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase.from('reservations').select('id, tags').in('id', unique.slice(i, i + 200));
    if (error) return map;
    for (const r of (data ?? []) as unknown as { id: string; tags: string[] | null }[]) {
      if (Array.isArray(r.tags) && r.tags.length > 0) map.set(r.id, r.tags);
    }
  }
  return map;
}

/**
 * 人数を範囲で受けた予約の最小人数（reservations.party_size_min。migration 00102）。列がまだ無いときは空（範囲なしとして出す）
 */
export async function loadReservationPartyMins(supabase: Supabase, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return map;
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase.from('reservations').select('id, party_size_min').in('id', unique.slice(i, i + 200));
    if (error) return map;
    for (const r of (data ?? []) as unknown as { id: string; party_size_min: number | null }[]) {
      if (typeof r.party_size_min === 'number' && r.party_size_min > 0) map.set(r.id, r.party_size_min);
    }
  }
  return map;
}
