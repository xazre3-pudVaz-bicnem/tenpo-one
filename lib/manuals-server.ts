import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { StoreRef } from '@/lib/auth';
import type { Role } from '@/lib/permissions';
import type { ManualItem } from '@/app/app/manuals/manual-catalog';
import type { ManualCategory } from '@/app/app/manuals/labels';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** マニュアルを登録・削除できるロール（createManual / deleteManual の store.settings と同じ顔ぶれ） */
export const MANUAL_WRITE_ROLES: readonly Role[] = ['org_owner', 'hq_admin', 'area_manager', 'store_manager'];

/** 全店共通（store_id = null）のマニュアルを登録・削除できるのは本社管理者だけ */
export function canManageAllStoreManuals(role: Role | null): boolean {
  return role === 'org_owner' || role === 'hq_admin';
}

/** 1件のマニュアルを消してよいか（Web の一覧の削除ボタンと同じ決まり） */
export function canDeleteManual(role: Role | null, manualStoreId: string | null): boolean {
  const canWrite = role != null && MANUAL_WRITE_ROLES.includes(role);
  return canWrite && (manualStoreId === null ? canManageAllStoreManuals(role) : true);
}

export interface ManualsPageData {
  canWrite: boolean;
  manuals: ManualItem[];
  /** 「〇〇のみ」で登録する店舗（今の店舗か最初の店舗） */
  targetStore: StoreRef | null;
  canTargetAllStores: boolean;
}

/**
 * マニュアルの画面の中身。Web の /app/manuals と iPad ネイティブ（lib/native-modules/manuals.ts）で同じ読み込み
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）
 */
export async function loadManualsPage(
  ctx: { role: Role | null; organizationId: string | null; currentStore: StoreRef | null; stores: StoreRef[] },
  supabase: Supabase
): Promise<ManualsPageData> {
  const canWrite = ctx.role != null && MANUAL_WRITE_ROLES.includes(ctx.role);
  const storeIds = ctx.stores.map((s) => s.id);

  const { data: rows } = await supabase
    .from('manuals')
    .select('id, title, category, store_id, file_path, url, note, stores(name)')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .or(storeIds.length > 0 ? `store_id.is.null,store_id.in.(${storeIds.join(',')})` : 'store_id.is.null')
    .order('title');

  const manuals: ManualItem[] = (rows ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    category: m.category as ManualCategory,
    storeLabel: m.store_id === null ? '全店共通' : ((m.stores as unknown as { name: string } | null)?.name ?? '店舗'),
    hasFile: !!m.file_path,
    url: m.url,
    note: m.note,
    canDelete: canDeleteManual(ctx.role, m.store_id),
  }));

  const targetStore = ctx.currentStore ?? ctx.stores[0] ?? null;

  return { canWrite, manuals, targetStore, canTargetAllStores: canManageAllStoreManuals(ctx.role) };
}
