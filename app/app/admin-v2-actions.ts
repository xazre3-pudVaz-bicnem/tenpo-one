'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { ADMIN_V2_COOKIE, canTryAdminV2 } from '@/lib/admin-v2';

/**
 * 新しい管理画面（パソコン）の ON / OFF（このブラウザだけ。lib/admin-v2.ts）。
 * 会社のオーナーのパソコンだけ。レジ（iPad）・ハンディ・スマホは変えられない。
 */
export async function setAdminV2(on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireSession();
  const userAgent = (await headers()).get('user-agent');
  if (!canTryAdminV2(ctx, userAgent)) {
    return { ok: false, error: '新しい管理画面は、会社のオーナーがパソコンで試せます' };
  }
  const jar = await cookies();
  if (on) {
    jar.set(ADMIN_V2_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  } else {
    jar.delete(ADMIN_V2_COOKIE);
  }
  revalidatePath('/app', 'layout');
  return { ok: true };
}
