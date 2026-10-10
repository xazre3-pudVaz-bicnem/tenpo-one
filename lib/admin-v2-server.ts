import { cookies, headers } from 'next/headers';
import type { Role } from '@/lib/permissions';
import { ADMIN_V2_COOKIE, adminV2On } from '@/lib/admin-v2';

/** このリクエストで新しい管理画面を出すか（会社のオーナーのパソコンで ON のときだけ。lib/admin-v2.ts） */
export async function isAdminV2Request(ctx: { role: Role | null; isRegisterDevice?: boolean; isHandyDevice?: boolean }): Promise<boolean> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return adminV2On(ctx, jar.get(ADMIN_V2_COOKIE)?.value ?? null, h.get('user-agent'));
}
