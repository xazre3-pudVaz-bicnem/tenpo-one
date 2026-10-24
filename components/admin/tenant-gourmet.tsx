import Link from 'next/link';
import { Mail } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase/admin';
import { Badge } from '@/components/ui/badge';
import { GourmetMailPanel } from '@/components/settings/gourmet-mail-panel';
import { GourmetMailImports, type GourmetMailImportRow } from '@/components/settings/gourmet-mail-imports';
import { GOURMET_SITES, gourmetMailSettingsFrom, type GourmetSiteKey, type MailKind } from '@/lib/gourmet-mail';
import {
  adminMarkGourmetSiteRegistered,
  adminRegenerateGourmetMailToken,
  adminResolveGourmetMailImport,
  adminSetGourmetMailEnabled,
} from '@/app/admin/tenants/actions';

/**
 * 運営の店舗導入管理（/admin/tenants/[storeId]）の「グルメサイト連携」。
 * 店舗の 予約台帳設定 › グルメ連携 と同じ画面を、運営側の Server Action で動かす（2026-10-24 Ronnie「管理画面からも」）。
 *   オン・オフ／取り込み専用アドレス（作り直しは運営だけ）／サイトごとの登録印／取り込み履歴（要確認 → 対応済み）
 */
export async function TenantGourmet({ storeId, storeName }: { storeId: string; storeName: string }) {
  const admin = createAdminClient();
  const [{ data: settingsRow }, { data: imports }] = await Promise.all([
    admin.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle(),
    admin
      .from('gourmet_mail_imports')
      .select('id, site, kind, status, subject, from_address, external_id, received_at, reservation_id, error, resolved_at, parsed, body_text')
      .eq('store_id', storeId)
      .order('received_at', { ascending: false })
      .limit(30),
  ]);
  const gm = gourmetMailSettingsFrom((settingsRow?.settings as Record<string, unknown> | null) ?? {});
  const verified = GOURMET_SITES.filter((s) => gm.sites[s.key]?.verifiedAt).length;
  const rows: GourmetMailImportRow[] = (imports ?? []).map((r) => ({
    id: r.id as string,
    site: r.site as GourmetSiteKey,
    kind: r.kind as MailKind,
    status: r.status as string,
    subject: (r.subject as string | null) ?? null,
    fromAddress: (r.from_address as string | null) ?? null,
    externalId: (r.external_id as string | null) ?? null,
    receivedAt: r.received_at as string,
    reservationId: (r.reservation_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    parsed: (r.parsed as GourmetMailImportRow['parsed']) ?? null,
    bodyText: (r.body_text as string | null) ?? null,
  }));
  const pendingReview = rows.filter((r) => r.status === 'needs_review' && !r.resolvedAt).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-navy">
          <Mail className="h-5 w-5 text-royal" aria-hidden />
          グルメサイト連携（メール取り込み）
        </h2>
        <Badge tone={gm.enabled ? 'success' : 'gray'}>{gm.enabled ? `利用中（${verified} サイト設定済）` : '停止中'}</Badge>
        {pendingReview > 0 && <Badge tone="danger">要確認 {pendingReview}</Badge>}
        <Link href="/app/settings/reservation-book?tab=gourmet" className="ml-auto text-xs font-medium text-primary hover:underline">
          店舗側の画面（サポートアクセス）
        </Link>
      </div>
      <GourmetMailPanel
        storeId={storeId}
        storeName={storeName}
        settings={gm}
        domain={process.env.NEXT_PUBLIC_INBOUND_MAIL_DOMAIN ?? 'in.tenpo-one.com'}
        inboundReady={!!process.env.INBOUND_MAIL_SECRET}
        canRegenerate
        actions={{ setEnabled: adminSetGourmetMailEnabled, regenerate: adminRegenerateGourmetMailToken, markSite: adminMarkGourmetSiteRegistered }}
      />
      <GourmetMailImports storeId={storeId} rows={rows} resolveAction={adminResolveGourmetMailImport} ledgerLinks={false} />
    </section>
  );
}
