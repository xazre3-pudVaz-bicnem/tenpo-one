import type { Metadata } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';
import { BellRing, CalendarCog, Globe, Mail, Share2 } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsBackLink } from '@/components/settings/back-link';
import { GourmetMailPanel } from '@/components/settings/gourmet-mail-panel';
import { GourmetMailImports, type GourmetMailImportRow } from '@/components/settings/gourmet-mail-imports';
import { GoogleLinksPanel, SnsLinksPanel } from '@/components/settings/reservation-link-panels';
import { PushSubscribeButton } from '@/components/notifications/push-subscribe-button';
import { ReminderPanel } from '@/components/settings/reminder-panel';
import { pushSubscriptionsFrom } from '@/lib/push-subscriptions';
import { gourmetMailSettingsFrom, type GourmetSiteKey, type MailKind } from '@/lib/gourmet-mail';
import { bookingLinkWithSrc, GOOGLE_CHANNEL, reservationBookSettingsFrom, SNS_CHANNELS } from '@/lib/reservation-book';

export const metadata: Metadata = { title: '予約台帳設定 | 設定' };

type Tab = 'book' | 'gourmet' | 'sns' | 'google';
const TABS: { key: Tab; label: string; en: string; icon: typeof Mail }[] = [
  { key: 'book', label: '予約台帳設定', en: 'Ledger', icon: CalendarCog },
  { key: 'gourmet', label: 'グルメ連携', en: 'Gourmet sites', icon: Mail },
  { key: 'sns', label: 'SNS連携', en: 'SNS', icon: Share2 },
  { key: 'google', label: 'Google連携', en: 'Google', icon: Globe },
];

/**
 * 予約台帳設定（2026-09-28 Ronnie「予約台帳設定の中に 予約台帳設定・グルメ連携・SNS連携・Google連携」）。
 *   予約台帳設定 … 予約の通知（端末）・リマインダー
 *   グルメ連携   … グルメサイトのメール取り込み（新規・変更・キャンセルを自動で台帳へ）
 *   SNS連携      … Instagram・LINE・Facebook・X に貼る予約リンク（経路付き）
 *   Google連携   … Google の「予約」ボタン用リンク・Google カレンダーへの配信
 */
export default async function ReservationBookSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePermission('store.settings');
  const store = ctx.currentStore ?? ctx.stores[0];
  const sp = await searchParams;
  const tab: Tab = (TABS.some((t) => t.key === sp.tab) ? sp.tab : 'book') as Tab;

  if (!store) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="予約台帳設定" en="Reservation book" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const since30 = daysAgoIso(30);

  const [{ data: settingsRow }, { data: storeRow }, { data: imports }, { data: recent }] = await Promise.all([
    supabase.from('store_settings').select('settings, reminder_enabled').eq('store_id', store.id).maybeSingle(),
    supabase.from('stores').select('slug').eq('id', store.id).maybeSingle(),
    tab === 'gourmet'
      ? supabase
          .from('gourmet_mail_imports')
          .select('id, site, kind, status, subject, from_address, external_id, received_at, reservation_id, error, resolved_at, parsed, body_text')
          .eq('store_id', store.id)
          .order('received_at', { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    tab === 'sns' || tab === 'google'
      ? supabase.from('reservations').select('id, reservation_sources(code)').eq('store_id', store.id).gte('created_at', since30).neq('status', 'cancelled').limit(5000)
      : Promise.resolve({ data: [] as { id: string; reservation_sources: unknown }[] }),
  ]);

  const settings = (settingsRow?.settings as Record<string, unknown> | null) ?? {};
  const gm = gourmetMailSettingsFrom(settings);
  const rb = reservationBookSettingsFrom(settings);
  const pushDevices = pushSubscriptionsFrom(settings);
  const bookingUrl = siteUrl && storeRow?.slug ? `${siteUrl}/book/${storeRow.slug}` : '';

  // 経路ごとの過去30日の予約数（SNS・Google のタブ）
  const counts30d: Record<string, number> = {};
  for (const r of recent ?? []) {
    const src = r.reservation_sources as { code: string } | { code: string }[] | null;
    const code = Array.isArray(src) ? src[0]?.code : src?.code;
    if (code) counts30d[code] = (counts30d[code] ?? 0) + 1;
  }

  // 経路付きリンクの QR（画像として保存できるように）
  const qrByChannel: Partial<Record<string, string>> = {};
  if (bookingUrl && (tab === 'sns' || tab === 'google')) {
    const channels = tab === 'sns' ? SNS_CHANNELS : [GOOGLE_CHANNEL];
    for (const c of channels) {
      try {
        qrByChannel[c.key] = await QRCode.toDataURL(bookingLinkWithSrc(bookingUrl, c.key), { width: 320, margin: 1 });
      } catch {
        /* QR が作れなくてもリンクは出す */
      }
    }
  }

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
      <PageHeader title="予約台帳設定" en="Reservation book" description="予約の通知、グルメサイト・SNS・Google からの予約の取り込みと連携" />

      {/* 中のタブ */}
      <nav className="mb-4 flex gap-1.5 overflow-x-auto rounded-2xl border border-line bg-white p-1.5 [scrollbar-width:none]" aria-label="予約台帳設定">
        {TABS.map((t) => {
          const on = t.key === tab;
          const Icon = t.icon;
          return (
            <Link
              key={t.key}
              href={`/app/settings/reservation-book?tab=${t.key}`}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'tap3d flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-left leading-tight whitespace-nowrap',
                on ? 'on-brand text-white' : 'bg-white text-ink-2 hover:bg-lilac-soft'
              )}
            >
              <Icon className={cn('h-[18px] w-[18px] shrink-0', on ? 'text-white' : 'text-saffron')} aria-hidden />
              <span>
                <span className="block text-[14px] font-bold">{t.label}</span>
                <span className={cn('block font-num text-[10.5px] font-semibold', on ? 'text-white/80' : 'text-ink-3')}>{t.en}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      {tab === 'book' && (
        <div className="space-y-5">
          <PushSubscribeButton />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="h-5 w-5 text-royal" aria-hidden />
                通知を受け取る端末
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-2">
                {pushDevices.length === 0
                  ? 'まだありません。ログインした端末で自動でオンになります（通知の許可が出たら「許可」）。'
                  : `${pushDevices.length}台：${pushDevices.map((d) => d.label ?? '端末').join('・')}`}
              </p>
            </CardContent>
          </Card>
          {settingsRow?.reminder_enabled ? (
            <ReminderPanel storeId={store.id} />
          ) : (
            <p className="text-[12px] text-ink-3">
              お客様へのリマインダー（前日メール等）は{' '}
              <Link href="/app/settings/booking" className="font-bold text-royal underline">
                予約受付ルール
              </Link>{' '}
              でオンにできます。
            </p>
          )}
        </div>
      )}

      {tab === 'gourmet' && (
        <div className="space-y-5">
          <GourmetMailPanel
            storeId={store.id}
            storeName={store.name}
            settings={gm}
            domain={process.env.NEXT_PUBLIC_INBOUND_MAIL_DOMAIN ?? 'in.tenpo-one.com'}
            inboundReady={!!process.env.INBOUND_MAIL_SECRET}
            canRegenerate={ctx.isCypressAdmin}
          />
          <GourmetMailImports storeId={store.id} rows={rows} />
        </div>
      )}

      {tab === 'sns' &&
        (bookingUrl ? (
          <SnsLinksPanel storeId={store.id} bookingUrl={bookingUrl} settings={rb} qrByChannel={qrByChannel} counts30d={counts30d} />
        ) : (
          <MissingSiteUrl />
        ))}

      {tab === 'google' &&
        (bookingUrl ? (
          <GoogleLinksPanel storeId={store.id} bookingUrl={bookingUrl} siteUrl={siteUrl} settings={rb} qrDataUrl={qrByChannel.google ?? null} count30d={counts30d.google ?? 0} />
        ) : (
          <MissingSiteUrl />
        ))}
    </div>
  );
}

/** サーバーで「n 日前」を作る（コンポーネント本体で Date.now を呼ばないため） */
function daysAgoIso(days: number): string {
  return new Date(new Date().getTime() - days * 86400000).toISOString();
}

function MissingSiteUrl() {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
      公開予約URLを出すには、環境変数 <code className="font-mono">NEXT_PUBLIC_SITE_URL</code> と店舗のスラッグが必要です。
    </div>
  );
}
