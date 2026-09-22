'use server';

import { cookies, headers } from 'next/headers';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { checkRegisterDevice } from '@/lib/store-access-server';
import { REGISTER_COOKIE, ACCESS_MESSAGE } from '@/lib/store-access';

export interface ClaimResult {
  ok?: boolean;
  error?: string;
}

/**
 * この端末（iPad）をこの店舗のレジとして登録する（契約で決めた台数まで）。
 * 台数がいっぱいなら登録しない。登録したトークンは httpOnly の Cookie に入れる。
 */
export async function claimRegisterDevice(storeId: string): Promise<ClaimResult> {
  const ctx = await requirePermission('pos.order');
  assertStoreAccess(ctx, storeId);
  const ua = (await headers()).get('user-agent')?.slice(0, 200) ?? null;

  const result = await checkRegisterDevice({
    organizationId: ctx.organizationId!,
    storeId,
    userAgent: ua,
    createdBy: ctx.userId,
  });

  if (result.decision.kind === 'limit') return { error: ACCESS_MESSAGE.limit };
  if (result.decision.kind === 'revoked') return { error: ACCESS_MESSAGE.revoked };
  if (result.newToken) {
    (await cookies()).set(REGISTER_COOKIE, result.newToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return { ok: true };
}
