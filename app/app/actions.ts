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

/**
 * ログアウト。scope:'local' で「この端末のセッションだけ」を終了する。
 * 既定の scope:'global' は同じアカウントの全セッション（＝全店・全端末の iPad）を一斉に
 * ログアウトさせてしまう。現状は全店が同じアカウントでログインしているため、1台で
 * ログアウトすると営業中の他店のレジまで落ちる事故になっていた。
 * （停止ユーザーの強制ログアウトは lib/auth.ts 側で従来どおり全セッションを切る）
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
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
