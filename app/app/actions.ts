'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { STORE_COOKIE, requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** 店舗切替（アクセス可能店舗か検証してCookieへ保存） */
export async function switchStore(storeId: string) {
  const ctx = await requireSession();
  const valid =
    (storeId === 'all' && ctx.isHq) || ctx.stores.some((s) => s.id === storeId);
  if (!valid) throw new Error('この店舗へのアクセス権限がありません');

  const cookieStore = await cookies();
  cookieStore.set(STORE_COOKIE, storeId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/app', 'layout');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

/** 通知を既読にする */
export async function markNotificationRead(notificationId: string) {
  const ctx = await requireSession();
  const supabase = await createClient();
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('recipient_id', ctx.userId);
  revalidatePath('/app', 'layout');
}
