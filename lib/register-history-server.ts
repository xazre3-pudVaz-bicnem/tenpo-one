import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { cleanRegisterName } from '@/lib/register-name';
import { sortHistory, type RegisterHistoryRow } from '@/lib/register-history';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * レジの履歴（lib/register-history.ts）を読む：since（YYYY-MM-DD）からの営業日のセッションと、日付に関係なく開いたままのセッション。
 * RLS のまま（ログインしている人の店舗だけ）。
 */
export async function loadRegisterHistory(
  supabase: Supabase,
  storeIds: readonly string[],
  since: string,
  until?: string | null
): Promise<RegisterHistoryRow[]> {
  if (storeIds.length === 0) return [];
  let q = supabase
    .from('register_sessions')
    .select(
      'id, store_id, business_date, status, opened_at, closed_at, opened_by, closed_by, opening_float, expected_cash, counted_cash, difference, registers(name), stores(name)'
    )
    .in('store_id', [...storeIds]);
  q = until
    ? q.or(`and(business_date.gte.${since},business_date.lte.${until}),status.eq.open`)
    : q.or(`business_date.gte.${since},status.eq.open`);
  const { data, error } = await q.order('business_date', { ascending: false }).order('opened_at', { ascending: false }).limit(120);
  if (error || !data) return [];

  const rows = data as unknown as {
    id: string;
    store_id: string;
    business_date: string;
    status: string;
    opened_at: string;
    closed_at: string | null;
    opened_by: string | null;
    closed_by: string | null;
    opening_float: number | null;
    expected_cash: number | null;
    counted_cash: number | null;
    difference: number | null;
    registers: { name: string } | null;
    stores: { name: string } | null;
  }[];

  const ids = new Set<string>();
  for (const r of rows) {
    if (r.opened_by) ids.add(r.opened_by);
    if (r.closed_by) ids.add(r.closed_by);
  }
  const { data: profiles } = ids.size
    ? await supabase.from('profiles').select('id, display_name').in('id', [...ids])
    : { data: [] as { id: string; display_name: string }[] };
  const nameOf = new Map(((profiles ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));

  return sortHistory(
    rows.map((r) => ({
      id: r.id,
      storeId: r.store_id,
      storeName: r.stores?.name ?? null,
      registerName: cleanRegisterName(r.registers?.name ?? 'レジ'),
      businessDate: r.business_date,
      status: r.status,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      openedByName: (r.opened_by && nameOf.get(r.opened_by)) || '—',
      closedByName: (r.closed_by && nameOf.get(r.closed_by)) || '—',
      openingFloat: Number(r.opening_float ?? 0),
      expectedCash: r.expected_cash == null ? null : Number(r.expected_cash),
      countedCash: r.counted_cash == null ? null : Number(r.counted_cash),
      difference: r.difference == null ? null : Number(r.difference),
    }))
  );
}
