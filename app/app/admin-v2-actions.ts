'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { ADMIN_V2_COOKIE, canTryAdminV2 } from '@/lib/admin-v2';

/**
 * 新しい管理画面（パソコン）の ON / OFF（このブラウザだけ。lib/admin-v2.ts）。
 * 会社のオーナーのパソコンだけ。レジ（iPad）・ハンディ・スマホは ON にできない。
 * touchPoints：画面の navigator.maxTouchPoints（Mac を名乗る iPad の Safari を止める）。
 * 「元に戻す」（OFF）はいつでもできる。
 */
export async function setAdminV2(
  on: boolean,
  touchPoints?: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireSession();
  const jar = await cookies();
  if (!on) {
    jar.delete(ADMIN_V2_COOKIE);
    revalidatePath('/app', 'layout');
    return { ok: true };
  }
  // タッチの数が分からない（古い画面のまま）ときは ON にしない（iPad かもしれない）
  if (typeof touchPoints !== 'number' || !Number.isFinite(touchPoints)) {
    return { ok: false, error: '画面を読み込み直してから、もう一度押してください' };
  }
  const userAgent = (await headers()).get('user-agent');
  if (!canTryAdminV2(ctx, userAgent, touchPoints)) {
    return { ok: false, error: '新しい管理画面は、会社のオーナーがパソコンで試せます' };
  }
  jar.set(ADMIN_V2_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/app', 'layout');
  return { ok: true };
}
