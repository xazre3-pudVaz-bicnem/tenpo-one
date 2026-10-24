import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { GOURMET_SITE_BY_KEY, gourmetMailSettingsFrom, type GourmetMailSettings, type GourmetSiteKey } from '@/lib/gourmet-mail';

/**
 * グルメサイト連携（メール取り込み）の設定の読み書き — 店舗の設定画面（app/app/settings/reservation-book/actions.ts）、
 * 運営の管理画面（app/admin/tenants/actions.ts）、iPad アプリ（/api/app/v1/pos）が同じものを使う（2026-10-24 Ronnie「管理画面からも」）。
 * 権限の確認は呼ぶ側（requirePermission / requireCypressAdmin）。ここは DB の読み書きだけ。
 */

export interface GourmetSettingsResult {
  error?: string;
}

export async function loadGourmetMailSettings(storeId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  const settings = ((data?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  return { settings, gm: gourmetMailSettingsFrom(settings) };
}

export async function saveGourmetMailSettings(
  storeId: string,
  organizationId: string,
  userId: string,
  settings: Record<string, unknown>,
  gm: GourmetMailSettings
): Promise<GourmetSettingsResult> {
  const admin = createAdminClient();
  const { error } = await admin.from('store_settings').upsert(
    { organization_id: organizationId, store_id: storeId, settings: { ...settings, gourmetMail: gm }, updated_by: userId },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `保存に失敗しました: ${error.message}` };
  return {};
}

export function newGourmetMailToken(): string {
  return randomBytes(8).toString('hex'); // 16 文字
}

/** メール取り込みのオン・オフ。オンにしたとき取り込み用アドレス（token）が無ければ作る */
export async function setGourmetMailEnabledFor(storeId: string, organizationId: string, userId: string, enabled: boolean): Promise<GourmetSettingsResult> {
  const { settings, gm } = await loadGourmetMailSettings(storeId);
  const next: GourmetMailSettings = { ...gm, enabled, token: gm.token ?? (enabled ? newGourmetMailToken() : null) };
  return saveGourmetMailSettings(storeId, organizationId, userId, settings, next);
}

/** 取り込み用アドレスを作り直す（古いアドレスに届いたメールは入らなくなる。サイトの登録印も消える） */
export async function regenerateGourmetMailTokenFor(storeId: string, organizationId: string, userId: string): Promise<GourmetSettingsResult & { token?: string }> {
  const { settings, gm } = await loadGourmetMailSettings(storeId);
  const next: GourmetMailSettings = { ...gm, token: newGourmetMailToken(), sites: {} };
  const r = await saveGourmetMailSettings(storeId, organizationId, userId, settings, next);
  return r.error ? r : { token: next.token ?? undefined };
}

/** 「このサイトの管理画面に登録した」の印 */
export async function markGourmetSiteRegisteredFor(
  storeId: string,
  organizationId: string,
  userId: string,
  site: GourmetSiteKey,
  registered: boolean
): Promise<GourmetSettingsResult> {
  if (!GOURMET_SITE_BY_KEY[site]) return { error: '対象のサイトがありません' };
  const { settings, gm } = await loadGourmetMailSettings(storeId);
  const prev = gm.sites[site] ?? {};
  const next: GourmetMailSettings = {
    ...gm,
    sites: { ...gm.sites, [site]: { ...prev, enabledAt: registered ? (prev.enabledAt ?? new Date().toISOString()) : null } },
  };
  return saveGourmetMailSettings(storeId, organizationId, userId, settings, next);
}

/** 「要確認」のメールを対応済みにする（RLS: 店長以上か運営） */
export async function resolveGourmetMailImportFor(
  supabase: SupabaseClient,
  storeId: string,
  importId: string,
  userId: string
): Promise<GourmetSettingsResult> {
  const { error } = await supabase
    .from('gourmet_mail_imports')
    .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', importId)
    .eq('store_id', storeId);
  if (error) return { error: `更新に失敗しました: ${error.message}` };
  return {};
}
