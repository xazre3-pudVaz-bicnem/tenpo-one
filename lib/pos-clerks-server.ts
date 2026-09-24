/**
 * 店舗の POS担当者を役職つきで読む。
 *
 * 本番 DB への SQL 適用と Vercel のデプロイは別タイミングなので、role 列がまだ無い期間がありうる。
 * その間はレジが止まらないよう、全員「スタッフ」として返す（＝取消の承認は求めない）。
 * lib/schema-compat.ts の方針と同じ。
 */

import type { createClient } from './supabase/server';
import { isMissingColumnError } from './schema-compat';
import { parseClerkRole, type ClerkRole } from './clerk-roles';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface StoreClerk {
  id: string;
  name: string;
  role: ClerkRole;
  status: 'active' | 'hidden';
}

export async function loadStoreClerks(
  supabase: Supabase,
  storeId: string,
  options: { includeHidden?: boolean } = {}
): Promise<StoreClerk[]> {
  const query = (columns: string) => {
    const q = supabase.from('pos_clerks').select(columns).eq('store_id', storeId);
    return (options.includeHidden ? q : q.eq('status', 'active')).order('sort_order').order('name');
  };

  const withRole = await query('id, name, status, role');
  if (!withRole.error) {
    return (withRole.data as unknown as { id: string; name: string; status: string; role: unknown }[]).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status === 'hidden' ? 'hidden' : 'active',
      role: parseClerkRole(c.role),
    }));
  }
  if (!isMissingColumnError(withRole.error.message, 'role')) return [];

  const legacy = await query('id, name, status');
  if (legacy.error) return [];
  return (legacy.data as unknown as { id: string; name: string; status: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status === 'hidden' ? 'hidden' : 'active',
    role: 'staff' as const,
  }));
}
