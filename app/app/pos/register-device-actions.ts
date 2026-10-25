'use server';

import { headers } from 'next/headers';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { checkRegisterDevice, setRegisterDeviceCookie } from '@/lib/store-access-server';
import { registerBlockMessage } from '@/lib/store-access';

export interface ClaimResult {
  ok?: boolean;
  error?: string;
}

/**
 * この端末（iPad）をこの店舗のレジとして登録する（契約で決めた台数まで）。
 * 台数がいっぱいなら登録しない。登録したトークンは httpOnly の Cookie に入れる。
 * コントロールセンターの承認制を運営が ON にした店舗（移行期間のあと）では「承認待ち」で登録する（画面は承認待ちの案内に変わる）。
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

  if (result.error) return { error: result.error };
  if (result.newToken) await setRegisterDeviceCookie(result.newToken);
  // 承認待ちで登録できたら、画面を読み直して「承認待ち」の案内を出す
  if (result.decision.kind === 'pending' && result.newToken) return { ok: true };
  const message = registerBlockMessage(result.decision, result.approval);
  if (message) return { error: message };
  return { ok: true };
}
