import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { ADMIN_ONLY_SETTINGS_NOTE } from '@/lib/admin-only-settings';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { tableOrderUrl } from '@/lib/table-qr';
import type { NativeTableQrPayload } from '@/lib/native-table-qr';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * iPad アプリのネイティブの「テーブルQRコード」の読み込み（GET /api/app/v1/pos?part=tableQr）。
 * 中身は Web の app/app/settings/tables/qr-print/page.tsx と同じ：使っている卓を並び順で、お客様の注文ページの URL つきで返す。
 * QR を止めている卓（qr_token が null）は url: null（iPad では「QR停止中」と出し、印刷には入れない）。
 */
export async function loadNativeTableQr(ctx: SessionContext, supabase: Supabase, store: { id: string; name: string }): Promise<NativeTableQrPayload> {
  const [{ data: storeRow }, { data: tables }, origin] = await Promise.all([
    supabase.from('stores').select('name, slug').eq('id', store.id).maybeSingle(),
    supabase
      .from('restaurant_tables')
      .select('id, name, qr_token, sort_order, status')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order')
      .order('name'),
    resolveSiteOrigin(),
  ]);
  const slug = storeRow?.slug ?? null;
  const canEdit = ctx.isRegisterDevice !== true;
  return {
    store: { id: store.id, name: storeRow?.name ?? store.name },
    tables: (tables ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      url: slug && t.qr_token ? tableOrderUrl(origin, slug, t.qr_token) : null,
    })),
    canEdit,
    editNote: canEdit ? null : ADMIN_ONLY_SETTINGS_NOTE,
  };
}
