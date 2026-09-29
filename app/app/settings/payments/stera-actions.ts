'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { newLinkCode } from '@/lib/stera';

/**
 * stera 端末の登録（設定 > 決済・端末）。管理画面だけ（レジの iPad からは変えられない。2026-09-29 Ronnie）。
 * 端末の「TENPO ONE 連携」アプリに、ここで出るリンクコードを1回入れるとつながる。
 */

export interface SteraActionResult {
  error?: string;
}

const ADMIN_ONLY = 'stera 端末の設定は管理画面（パソコン・店長以上のアカウント）で行ってください';

async function ctxForStore(storeId: string) {
  const ctx = await requirePermission('store.settings');
  if (ctx.isRegisterDevice) return { ctx, error: ADMIN_ONLY };
  if (!ctx.stores.some((s) => s.id === storeId)) return { ctx, error: '対象店舗にアクセス権がありません' };
  return { ctx, error: null as string | null };
}

function cleanName(name: string): string | null {
  const s = (name ?? '').trim().slice(0, 40);
  return s || null;
}

function cleanTerminalNo(no: string): string | null {
  const s = (no ?? '').trim().slice(0, 40);
  return s || null;
}

export async function addSteraTerminal(storeId: string, name: string, terminalNo: string): Promise<SteraActionResult> {
  const { ctx, error } = await ctxForStore(storeId);
  if (error) return { error };
  const n = cleanName(name);
  if (!n) return { error: '端末の名前を入れてください（例：レジ横 stera）' };
  const admin = createAdminClient();
  // リンクコードが重なったときだけ作り直す
  for (let i = 0; i < 3; i++) {
    const { error: insertError } = await admin.from('stera_terminals').insert({
      organization_id: ctx.organizationId,
      store_id: storeId,
      name: n,
      terminal_no: cleanTerminalNo(terminalNo),
      link_code: newLinkCode((k) => randomBytes(k)),
      created_by: ctx.userId,
    });
    if (!insertError) {
      revalidatePath('/app/settings/payments');
      return {};
    }
    if (!/duplicate|unique/i.test(insertError.message)) return { error: `登録に失敗しました: ${insertError.message}` };
  }
  return { error: '登録に失敗しました。もう一度お試しください' };
}

async function terminalOfStore(id: string, storeId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from('stera_terminals').select('id, store_id, status').eq('id', id).maybeSingle();
  return data && data.store_id === storeId && data.status !== 'deleted' ? { admin, terminal: data } : { admin, terminal: null };
}

export async function updateSteraTerminal(
  id: string,
  storeId: string,
  patch: { name?: string; terminalNo?: string; active?: boolean }
): Promise<SteraActionResult> {
  const { error } = await ctxForStore(storeId);
  if (error) return { error };
  const { admin, terminal } = await terminalOfStore(id, storeId);
  if (!terminal) return { error: '端末が見つかりません' };
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const n = cleanName(patch.name);
    if (!n) return { error: '端末の名前を入れてください' };
    update.name = n;
  }
  if (patch.terminalNo !== undefined) update.terminal_no = cleanTerminalNo(patch.terminalNo);
  if (patch.active !== undefined) update.status = patch.active ? 'active' : 'disabled';
  const { error: updateError } = await admin.from('stera_terminals').update(update).eq('id', id);
  if (updateError) return { error: `保存に失敗しました: ${updateError.message}` };
  revalidatePath('/app/settings/payments');
  return {};
}

/** リンクコードを作り直す（前のコードの端末はつながらなくなる） */
export async function regenerateSteraLinkCode(id: string, storeId: string): Promise<SteraActionResult> {
  const { error } = await ctxForStore(storeId);
  if (error) return { error };
  const { admin, terminal } = await terminalOfStore(id, storeId);
  if (!terminal) return { error: '端末が見つかりません' };
  const { error: updateError } = await admin
    .from('stera_terminals')
    .update({ link_code: newLinkCode((k) => randomBytes(k)), last_seen_at: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) return { error: `作り直しに失敗しました: ${updateError.message}` };
  revalidatePath('/app/settings/payments');
  return {};
}

/** 削除（決済の記録は残す。端末は一覧から消え、つながらなくなる） */
export async function deleteSteraTerminal(id: string, storeId: string): Promise<SteraActionResult> {
  const { error } = await ctxForStore(storeId);
  if (error) return { error };
  const { admin, terminal } = await terminalOfStore(id, storeId);
  if (!terminal) return { error: '端末が見つかりません' };
  const { error: updateError } = await admin
    .from('stera_terminals')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) return { error: `削除に失敗しました: ${updateError.message}` };
  revalidatePath('/app/settings/payments');
  return {};
}
