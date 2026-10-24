import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { validateUploadMeta } from '@/components/invoices/labels';
import { canDeleteManual, canManageAllStoreManuals, loadManualsPage } from '@/lib/manuals-server';
import { createManual, deleteManual, getManualSignedUrl } from '@/app/app/manuals/actions';
import { MANUAL_CATEGORIES, MANUAL_CATEGORY_LABELS } from '@/app/app/manuals/labels';
import { manualFileKind, manualUploadPath, parseManualCreate } from '@/lib/native-modules/manuals-input';
import { parseNativeId } from '@/lib/native-modules/daily-reports-input';
import { nativeBad, nativeErrorText, nativePageGuard, nativeRun } from '@/lib/native-modules/guard';
import type { NativeModuleGet, NativeModulePost } from '@/lib/native-modules/registry';

/**
 * マニュアルの iPad ネイティブ（GET part=manuals・manualFile ／ POST manualCreate・manualDelete）。
 * 中身・操作は Web の /app/manuals と同じ（lib/manuals-server.ts・app/app/manuals/actions.ts）。
 * ファイルの登録は Web がブラウザから Storage へ上げる所を、サーバーが代わりに上げてから同じ createManual を呼ぶ（スキャンと同じ形）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 */

const PATH = '/app/manuals';

/** カテゴリのタブ・カード（Web の ManualCatalog と同じ）と、登録できるか・登録先の店舗 */
export const manualsGet: NativeModuleGet = async ({ ctx }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const d = await loadManualsPage(ctx, await createClient());
  return {
    body: {
      ok: true,
      canWrite: d.canWrite && !!d.targetStore && !!ctx.organizationId,
      canTargetAllStores: d.canTargetAllStores,
      target: d.targetStore ? { id: d.targetStore.id, name: d.targetStore.name } : null,
      categories: MANUAL_CATEGORIES.map((c) => ({ key: c, label: MANUAL_CATEGORY_LABELS[c] })),
      manuals: d.manuals,
    },
  };
};

/** 添付ファイルを開く（?id=。1時間の署名URLと、PDF か画像か） */
export const manualFileGet: NativeModuleGet = async ({ ctx, url }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const id = parseNativeId({ id: url.searchParams.get('id') }, 'マニュアル');
  if (!id.ok) return nativeBad(id.error);
  const supabase = await createClient();
  // 一覧に出ているもの（同じ企業・有効・全店共通か担当の店舗）だけ
  const { data: m } = await supabase
    .from('manuals')
    .select('id, store_id, file_path, status')
    .eq('id', id.value.id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!m || m.status !== 'active' || (m.store_id !== null && !ctx.stores.some((s) => s.id === m.store_id))) {
    return nativeBad('マニュアルが見つかりません', 404);
  }
  if (!m.file_path) return nativeBad('ファイルが見つかりません', 404);
  try {
    const signed = await getManualSignedUrl(id.value.id);
    return { body: { ok: true, url: signed, kind: manualFileKind(m.file_path as string) } };
  } catch (e) {
    return nativeBad(nativeErrorText(e, '開けませんでした'));
  }
};

/** マニュアルの登録（ファイル＝写真・PDF／外部URL）。権限・対象の確かめは上げる前にも（要らないファイルを残さない） */
export const manualCreatePost: NativeModulePost = async ({ ctx, raw }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  if (!can(ctx.role, 'store.settings')) return nativeBad('マニュアルを登録する権限がありません', 403);
  const orgId = ctx.organizationId;
  if (!orgId) return nativeBad('ログインしてください', 401);
  const p = parseManualCreate(raw);
  if (!p.ok) return nativeBad(p.error);
  const input = p.value;

  // 登録先（Web の ManualForm と同じ：今の店舗か最初の店舗、全店共通は本社管理者だけ）
  const targetStore = ctx.currentStore ?? ctx.stores[0] ?? null;
  if (input.target === 'all' && !canManageAllStoreManuals(ctx.role)) return nativeBad('全店共通マニュアルの登録は本社管理者のみ行えます', 403);
  if (input.target === 'store' && !targetStore) return nativeBad('店舗がありません', 404);
  const storeId = input.target === 'all' || !targetStore ? null : targetStore.id;

  if (input.source.kind === 'url') {
    const url = input.source.url;
    return nativeRun(() =>
      createManual({
        title: input.title,
        category: input.category,
        storeId,
        filePath: null,
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        url,
        note: input.note,
      })
    );
  }

  const file = input.source;
  const bytes = Buffer.from(file.dataBase64, 'base64');
  const metaError = validateUploadMeta({ fileName: file.fileName, mimeType: file.mimeType, sizeBytes: bytes.length });
  if (metaError) return nativeBad(metaError);
  const supabase = await createClient();
  const path = manualUploadPath(orgId, crypto.randomUUID(), file.mimeType);
  const { error: upErr } = await supabase.storage.from('documents').upload(path, bytes, { contentType: file.mimeType, upsert: false });
  if (upErr) return nativeBad('アップロードに失敗しました', 500);
  try {
    await createManual({
      title: input.title,
      category: input.category,
      storeId,
      filePath: path,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: bytes.length,
      url: null,
      note: input.note,
    });
  } catch (e) {
    // 登録できなかったら上げたファイルは消す（残しても誰も開けない）
    await supabase.storage.from('documents').remove([path]);
    return nativeBad(nativeErrorText(e, '保存に失敗しました'));
  }
  return { body: { ok: true } };
};

/** 削除（論理削除）。全店共通は本社管理者だけ（Web の一覧の削除ボタンと同じ） */
export const manualDeletePost: NativeModulePost = async ({ ctx, raw }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  if (!can(ctx.role, 'store.settings')) return nativeBad('マニュアルを削除する権限がありません', 403);
  const p = parseNativeId(raw, 'マニュアル');
  if (!p.ok) return nativeBad(p.error);
  const supabase = await createClient();
  const { data: m } = await supabase
    .from('manuals')
    .select('id, store_id')
    .eq('id', p.value.id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!m) return nativeBad('マニュアルが見つかりません', 404);
  if (!canDeleteManual(ctx.role, (m.store_id as string | null) ?? null)) return nativeBad('このマニュアルは削除できません', 403);
  return nativeRun(() => deleteManual(p.value.id), '削除に失敗しました');
};
