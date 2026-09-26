import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { GourmetMailPanel } from '@/components/settings/gourmet-mail-panel';
import { GourmetMailImports, type GourmetMailImportRow } from '@/components/settings/gourmet-mail-imports';
import { gourmetMailSettingsFrom, type GourmetSiteKey, type MailKind } from '@/lib/gourmet-mail';

export const metadata: Metadata = { title: 'ご予約台帳設定 | 設定' };

/**
 * ご予約台帳設定（2026-09-27 Ronnie「グルメサイト連携のある予約台帳を」）。
 * いまはグルメサイト連携（メール取り込み）と取り込み履歴。
 */
export default async function ReservationBookSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="ご予約台帳設定" en="Reservation book" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: settingsRow }, { data: imports }] = await Promise.all([
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
    supabase
      .from('gourmet_mail_imports')
      .select('id, site, kind, status, subject, from_address, external_id, received_at, reservation_id, error, resolved_at, parsed, body_text')
      .eq('store_id', store.id)
      .order('received_at', { ascending: false })
      .limit(50),
  ]);

  const gm = gourmetMailSettingsFrom((settingsRow?.settings as Record<string, unknown> | null) ?? {});
  const domain = process.env.NEXT_PUBLIC_INBOUND_MAIL_DOMAIN ?? 'in.tenpo-one.com';
  const inboundReady = !!process.env.INBOUND_MAIL_SECRET;

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

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="ご予約台帳設定"
        en="Reservation book"
        description="グルメサイトの予約（新規・変更・キャンセル）を自動で台帳に取り込む設定"
      />
      <div className="space-y-5">
        <GourmetMailPanel storeId={store.id} storeName={store.name} settings={gm} domain={domain} inboundReady={inboundReady} />
        <GourmetMailImports storeId={store.id} rows={rows} />
      </div>
    </div>
  );
}
