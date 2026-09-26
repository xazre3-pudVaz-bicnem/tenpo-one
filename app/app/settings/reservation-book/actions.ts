'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GOURMET_SITE_BY_KEY, gourmetMailSettingsFrom, type GourmetMailSettings, type GourmetSiteKey } from '@/lib/gourmet-mail';
import { reservationBookSettingsFrom, type ReservationBookSettings } from '@/lib/reservation-book';

export interface ActionResult {
  error?: string;
}

const PATH = '/app/settings/reservation-book';

async function loadSettings(storeId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  const settings = ((data?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  return { admin, settings, gm: gourmetMailSettingsFrom(settings) };
}

async function saveSettings(storeId: string, organizationId: string, userId: string, settings: Record<string, unknown>, gm: GourmetMailSettings) {
  const admin = createAdminClient();
  const { error } = await admin.from('store_settings').upsert(
    { organization_id: organizationId, store_id: storeId, settings: { ...settings, gourmetMail: gm }, updated_by: userId },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `保存に失敗しました: ${error.message}` };
  revalidatePath(PATH);
  return {};
}

function newToken(): string {
  return randomBytes(8).toString('hex'); // 16 文字
}

/** メール取り込みのオン・オフ。オンにしたとき取り込み用アドレス（token）が無ければ作る */
export async function setGourmetMailEnabled(storeId: string, enabled: boolean): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  const { settings, gm } = await loadSettings(storeId);
  const next: GourmetMailSettings = { ...gm, enabled, token: gm.token ?? (enabled ? newToken() : null) };
  return saveSettings(storeId, ctx.organizationId, ctx.userId, settings, next);
}

/** 取り込み用アドレスを作り直す（古いアドレスに届いたメールは入らなくなる）。運営 CYPRESS だけ（2026-09-28 Ronnie） */
export async function regenerateGourmetMailToken(storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.isCypressAdmin) return { error: '取り込み専用アドレスの変更は運営（CYPRESS）だけが行えます' };
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  const { settings, gm } = await loadSettings(storeId);
  const next: GourmetMailSettings = { ...gm, token: newToken(), sites: {} };
  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.gourmet_mail.regenerate',
    p_target_table: 'store_settings',
    p_target_id: storeId,
    p_before: null,
    p_after: { token: next.token },
    p_note: 'グルメサイト取り込み用アドレスを作り直し',
  });
  return saveSettings(storeId, ctx.organizationId, ctx.userId, settings, next);
}

/** 「このサイトの管理画面に登録した」の印 */
export async function markGourmetSiteRegistered(storeId: string, site: GourmetSiteKey, registered: boolean): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  if (!GOURMET_SITE_BY_KEY[site]) return { error: '対象のサイトがありません' };
  const { settings, gm } = await loadSettings(storeId);
  const prev = gm.sites[site] ?? {};
  const next: GourmetMailSettings = {
    ...gm,
    sites: { ...gm.sites, [site]: { ...prev, enabledAt: registered ? (prev.enabledAt ?? new Date().toISOString()) : null } },
  };
  return saveSettings(storeId, ctx.organizationId, ctx.userId, settings, next);
}

/** 「要確認」のメールを対応済みにする */
export async function resolveGourmetMailImport(storeId: string, importId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('gourmet_mail_imports')
    .update({ resolved_at: new Date().toISOString(), resolved_by: ctx.userId })
    .eq('id', importId)
    .eq('store_id', storeId);
  if (error) return { error: `更新に失敗しました: ${error.message}` };
  revalidatePath(PATH);
  revalidatePath('/app/reservations');
  return {};
}

// ---------------------------------------------------------------------------
// SNS連携・Google連携（2026-09-28 Ronnie）
// ---------------------------------------------------------------------------

async function saveReservationBook(storeId: string, organizationId: string, userId: string, settings: Record<string, unknown>, rb: ReservationBookSettings) {
  const admin = createAdminClient();
  const { error } = await admin.from('store_settings').upsert(
    { organization_id: organizationId, store_id: storeId, settings: { ...settings, reservationBook: rb }, updated_by: userId },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `保存に失敗しました: ${error.message}` };
  revalidatePath(PATH);
  return {};
}

/** SNS のアカウントURLを保存 */
export async function saveSnsLinks(storeId: string, sns: ReservationBookSettings['sns']): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  const clean = (v: string | undefined) => {
    const t = (v ?? '').trim();
    if (!t) return undefined;
    if (!/^https?:\/\//i.test(t)) return `https://${t}`;
    return t.slice(0, 300);
  };
  const { settings } = await loadSettings(storeId);
  const rb = reservationBookSettingsFrom(settings);
  const next: ReservationBookSettings = {
    ...rb,
    sns: { instagram: clean(sns.instagram), line: clean(sns.line), facebook: clean(sns.facebook), x: clean(sns.x) },
  };
  return saveReservationBook(storeId, ctx.organizationId, ctx.userId, settings, next);
}

/** Google カレンダー購読URLの token を発行・作り直す（作り直すと古いURLは使えなくなる） */
export async function regenerateIcalToken(storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  const { settings } = await loadSettings(storeId);
  const rb = reservationBookSettingsFrom(settings);
  const next: ReservationBookSettings = { ...rb, icalToken: randomBytes(16).toString('hex') };
  return saveReservationBook(storeId, ctx.organizationId, ctx.userId, settings, next);
}

/** Google カレンダー購読を止める（URLを無効にする） */
export async function revokeIcalToken(storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  const { settings } = await loadSettings(storeId);
  const rb = reservationBookSettingsFrom(settings);
  return saveReservationBook(storeId, ctx.organizationId, ctx.userId, settings, { ...rb, icalToken: null });
}
