import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTableError } from '@/lib/schema-compat';
import { QR_ORDER_FLAG, resolveQrOrderFlag, type QrOrderFlagState } from '@/lib/qr-order-flag';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * この店舗でテーブルQR（お客様の QR 注文）を受け付けるか（lib/qr-order-flag.ts）。
 * 店舗の表（store_feature_flags）がまだ無い（migration 00103 の前）・読めないときは今まで通り ON
 * （お客様の注文を間違って止めない。企業の OFF は DB のトリガーでも止まる）。
 */
export async function loadQrOrderFlag(organizationId: string, storeId: string, preAdmin?: Admin): Promise<QrOrderFlagState> {
  try {
    const admin = preAdmin ?? createAdminClient();
    const [orgRes, storeRes] = await Promise.all([
      admin.from('feature_flags').select('enabled').eq('organization_id', organizationId).eq('flag_key', QR_ORDER_FLAG).maybeSingle(),
      admin.from('store_feature_flags').select('enabled').eq('store_id', storeId).eq('flag_key', QR_ORDER_FLAG).maybeSingle(),
    ]);
    const orgEnabled = orgRes.error || !orgRes.data ? null : orgRes.data.enabled === true;
    let storeEnabled: boolean | null = null;
    if (storeRes.error) {
      if (!isMissingTableError(storeRes.error, 'store_feature_flags')) console.error('[qr-order] store flag read failed', storeRes.error.message);
    } else if (storeRes.data) {
      storeEnabled = storeRes.data.enabled === true;
    }
    return resolveQrOrderFlag({ orgEnabled, storeEnabled });
  } catch (e) {
    console.error('[qr-order] flag read failed', e instanceof Error ? e.message : e);
    return { on: true, reason: 'on' };
  }
}

/** お客様の注文ページ（/order/<店舗>/<卓>）用：店舗のスラッグから。店舗が見つからなければ null（ページ側で 404） */
export async function loadQrOrderFlagBySlug(slug: string): Promise<(QrOrderFlagState & { storeName: string }) | null> {
  try {
    const admin = createAdminClient();
    const { data: store } = await admin.from('stores').select('id, name, organization_id').eq('slug', slug).maybeSingle();
    if (!store) return null;
    const flag = await loadQrOrderFlag(store.organization_id as string, store.id as string, admin);
    return { ...flag, storeName: (store.name as string) ?? '' };
  } catch (e) {
    console.error('[qr-order] flag by slug failed', e instanceof Error ? e.message : e);
    return null;
  }
}
