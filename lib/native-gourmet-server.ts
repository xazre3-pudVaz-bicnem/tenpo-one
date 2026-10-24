import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { GOURMET_SITES, GOURMET_SITE_BY_KEY, MAIL_KIND_LABEL, gourmetImportAddress, gourmetMailSettingsFrom, type GourmetSiteKey, type MailKind } from '@/lib/gourmet-mail';
import { GOURMET_IMPORT_STATUS_LABEL, type NativeGourmetImport, type NativeGourmetPayload, type NativeGourmetSite } from '@/lib/native-gourmet';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * iPad アプリのネイティブの「グルメ連携」に返すもの（GET /api/app/v1/pos?part=gourmet）。
 * Web の 予約台帳設定 › グルメ連携（app/app/settings/reservation-book/page.tsx の tab=gourmet）と同じ組み立て（2026-10-24）
 */
export async function loadNativeGourmet(ctx: SessionContext, supabase: Supabase, store: { id: string; name: string }): Promise<NativeGourmetPayload> {
  const [{ data: settingsRow }, { data: imports }] = await Promise.all([
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
    supabase
      .from('gourmet_mail_imports')
      .select('id, site, kind, status, subject, from_address, external_id, received_at, reservation_id, error, resolved_at, parsed, body_text, reservations(reserved_date)')
      .eq('store_id', store.id)
      .order('received_at', { ascending: false })
      .limit(50),
  ]);

  const gm = gourmetMailSettingsFrom((settingsRow?.settings as Record<string, unknown> | null) ?? {});
  const domain = process.env.NEXT_PUBLIC_INBOUND_MAIL_DOMAIN ?? 'in.tenpo-one.com';

  const sites: NativeGourmetSite[] = GOURMET_SITES.map((s) => {
    const st = gm.sites[s.key] ?? {};
    return {
      key: s.key,
      name: s.name,
      en: s.en,
      adminUrl: s.adminUrl,
      howTo: s.howTo,
      status: st.verifiedAt ? 'verified' : st.enabledAt ? 'registered' : 'off',
      enabledAt: st.enabledAt ?? null,
      verifiedAt: st.verifiedAt ?? null,
      lastImportAt: st.lastImportAt ?? null,
      lastKind: st.lastKind ?? null,
    };
  });

  const rows: NativeGourmetImport[] = (imports ?? []).map((r) => {
    const site = r.site as GourmetSiteKey;
    const kind = r.kind as MailKind;
    const status = r.status as string;
    const rsv = r.reservations as unknown as { reserved_date: string } | { reserved_date: string }[] | null;
    const reservedDate = Array.isArray(rsv) ? (rsv[0]?.reserved_date ?? null) : (rsv?.reserved_date ?? null);
    return {
      id: r.id as string,
      site,
      siteName: GOURMET_SITE_BY_KEY[site]?.name ?? site,
      kind,
      kindLabel: MAIL_KIND_LABEL[kind] ?? kind,
      status,
      statusLabel: GOURMET_IMPORT_STATUS_LABEL[status] ?? status,
      subject: (r.subject as string | null) ?? null,
      fromAddress: (r.from_address as string | null) ?? null,
      externalId: (r.external_id as string | null) ?? null,
      receivedAt: r.received_at as string,
      reservationId: (r.reservation_id as string | null) ?? null,
      reservedDate,
      error: (r.error as string | null) ?? null,
      resolvedAt: (r.resolved_at as string | null) ?? null,
      parsed: (r.parsed as NativeGourmetImport['parsed']) ?? null,
      // 本文は長いので先頭だけ（Web も 3000 文字で切っている）
      bodyText: typeof r.body_text === 'string' ? r.body_text.slice(0, 3000) : null,
    };
  });

  return {
    store: { id: store.id, name: store.name },
    enabled: gm.enabled,
    address: gm.enabled && gm.token ? gourmetImportAddress(gm.token, domain) : null,
    domain,
    inboundReady: !!process.env.INBOUND_MAIL_SECRET,
    canRegenerate: ctx.isCypressAdmin,
    canWrite: !!ctx.role && can(ctx.role, 'store.settings'),
    verifiedCount: sites.filter((s) => s.status === 'verified').length,
    sites,
    imports: rows,
    pendingReview: rows.filter((r) => r.status === 'needs_review' && !r.resolvedAt).length,
  };
}
