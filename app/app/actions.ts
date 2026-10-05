'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { STORE_COOKIE, getSessionContext, requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { canSignOutRegister } from '@/lib/register-day';
import { shouldBlockRegisterSignOut } from '@/lib/device-kind';
import { loadStoreDay } from '@/lib/register-day-server';

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
 * （停止ユーザー・契約停止の強制ログアウトも lib/auth.ts 側で端末単位に直した）
 */
export async function signOut(formData?: FormData) {
  const supabase = await createClient();
  // レジ（iPad）は、開いているレジがあればログアウトさせない。レジ精算（レジクローズ）をすると自動でログアウトする
  // （2026-09-28 Ronnie「レジ精算をしないとログアウトできない」）。
  // 同じレジのアカウントでも、パソコンから入った管理画面はログアウトできる（2026-10-05 Ronnie）。
  // iPad かどうかは User-Agent と、画面から送る touch（maxTouchPoints）で見る（lib/device-kind.ts）
  const ctx = await getSessionContext();
  const touchRaw = formData?.get('touch');
  const touchPoints = typeof touchRaw === 'string' && touchRaw !== '' ? Number(touchRaw) : null;
  const userAgent = (await headers()).get('user-agent');
  if (ctx?.currentStore && shouldBlockRegisterSignOut({ isRegisterDevice: ctx.isRegisterDevice === true, userAgent, touchPoints })) {
    const day = await loadStoreDay(supabase, ctx.currentStore.id);
    if (!canSignOutRegister({ isRegisterDevice: true, openSessionCount: day.openCount, today: day.clock })) {
      redirect('/app/cash/close?logout=blocked');
    }
  }
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}

/**
 * レジ締めのあとのログアウト（レジ端末）。
 * 締めたら閉店なので、そのままログイン画面（レジ用）へ戻す（2026-09-24 店舗要望）。
 * ここも scope:'local'。ほかの店舗・ほかの端末は落とさない。
 */
export async function signOutRegister() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/register-login');
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
