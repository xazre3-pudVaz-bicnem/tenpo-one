'use server';

import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { splitCheckoutReturn } from '@/lib/split-checkout-return';

/** 会計完了時に残りを読み直す。伝票・品目の更新はしない。 */
export async function readSplitCheckoutReturn(currentId: string, from: string) {
  if (!/^[0-9a-f-]{36}$/i.test(from) || currentId === from) return null;
  const ctx = await requirePermission('pos.checkout');
  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase.from('orders')
    .select('store_id, source_order_id').eq('id', currentId).single();
  if (currentError || !current || current.source_order_id !== from) return null;
  await assertStoreAccess(ctx, current.store_id);
  const [parent, items] = await Promise.all([
    supabase.from('orders').select('id, status, total').eq('id', from).eq('store_id', current.store_id).maybeSingle(),
    supabase.from('order_items').select('id').eq('order_id', from).eq('status', 'active').gt('quantity', 0).limit(1),
  ]);
  if (parent.error || items.error) return null;
  return splitCheckoutReturn(from, parent.data, !!items.data?.length);
}
