import 'server-only';
import { can, type PermissionAction } from '@/lib/permissions';
import { featureForRoute } from '@/lib/features';
import type { SessionContext } from '@/lib/auth';
import type { NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * Web の画面と同じ入口の確かめ（機能フラグ・ページの権限）。日報・タスク・マニュアルのネイティブで共通
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）。NG なら返す中身、OK なら null
 */
export function nativePageGuard(ctx: SessionContext, path: string, action: PermissionAction = 'dashboard.view'): NativeModuleResult | null {
  const feature = featureForRoute(path);
  if (feature && ctx.disabledFeatures?.has(feature)) return { status: 403, body: { ok: false, error: 'この機能は使えません' } };
  if (!can(ctx.role, action)) return { status: 403, body: { ok: false, error: '権限がありません' } };
  return null;
}

/** Server Action の投げたことばをそのまま iPad に出す（Next の中のことば・リダイレクトは出さない） */
export function nativeErrorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : '';
  if (!raw || /Minified React error|Server Components render|digest|NEXT_REDIRECT/i.test(raw)) return fallback;
  return raw;
}

export function nativeBad(error: string, status = 400): NativeModuleResult {
  return { status, body: { ok: false, error } };
}

/** Server Action を呼んで、投げたら 400 とそのことば（「承認済みの日報は再生成できません」など）で返す */
export async function nativeRun(run: () => Promise<unknown>, fallback = '保存できませんでした'): Promise<NativeModuleResult> {
  try {
    await run();
    return { body: { ok: true } };
  } catch (e) {
    return nativeBad(nativeErrorText(e, fallback));
  }
}
