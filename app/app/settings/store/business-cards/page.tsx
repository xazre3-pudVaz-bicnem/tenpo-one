import type { Metadata } from 'next';
import { Printer } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { tableQrDataUrl } from '@/lib/table-qr';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { PrintButton } from '@/components/reservations/print-button';
import { TableQrPdfButton } from '@/components/settings/table-qr-pdf-button';
import { BookingMeishiSheet } from '@/components/settings/booking-meishi';
import { bookingCouponsFrom, couponLabel } from '@/lib/booking-coupons';

export const metadata: Metadata = { title: '店舗名刺 | 設定' };

/**
 * 店舗名刺（立名刺 55×91mm）を A4 1枚に 9枚。切り取り線とトンボ入り。
 * お店で A4 に印刷して、線に沿って切ってレジに置く（2026-09-30 Ronnie「店舗名刺としてプリントする。システムの中で」）。
 * 中身は予約QRカードと同じ（店舗名・予約QR・住所・電話番号）。
 */
export default async function StoreBusinessCardsPage() {
  const ctx = await requirePermission('store.settings');
  const target = ctx.currentStore ?? ctx.stores[0];
  if (!target) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="店舗名刺" en="Business cards" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: store }, { data: storeSettings }] = await Promise.all([
    supabase.from('stores').select('name, slug, postal_code, address, phone').eq('id', target.id).maybeSingle(),
    supabase.from('store_settings').select('settings').eq('store_id', target.id).maybeSingle(),
  ]);
  const coupons = bookingCouponsFrom(storeSettings?.settings ?? null).map(couponLabel);
  const bookingUrl = store?.slug ? `${await resolveSiteOrigin()}/book/${store.slug}` : null;
  const qrDataUrl = bookingUrl ? await tableQrDataUrl(bookingUrl, 480).catch(() => null) : null;

  if (!store || !qrDataUrl) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="店舗名刺" en="Business cards" />
        <EmptyState title="予約URLがありません" description="店舗の予約URL（スラッグ）が決まると作れます" />
      </div>
    );
  }
  const address = store.address ? `${store.postal_code ? `〒${store.postal_code} ` : ''}${store.address}` : null;

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="店舗名刺"
        en="Business cards"
        description={`${store.name}｜A4 に立名刺（55×91mm）9枚。印刷して線に沿って切り、レジに置いてください`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TableQrPdfButton
              page="a4"
              fileName={`${store.name}_店舗名刺_A4.pdf`}
              label="PDFでダウンロード（A4）"
              className="on-brand inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-70"
            />
            <PrintButton className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-lilac-soft">
              <Printer className="h-4 w-4" aria-hidden />
              印刷する
            </PrintButton>
          </div>
        }
      />
      <div className="mb-4 space-y-1 rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-600">
        <p>・印刷は「用紙 A4」「倍率 100%（実際のサイズ）」で。フチなし印刷は要りません（まわりの白い余白に切る位置の線があります）。</p>
        <p>・点線（カードの境目）と、余白の短い線（トンボ）に沿って切ると、立名刺（55×91mm）が9枚できます。</p>
        <p>・厚めの紙（名刺用紙・画用紙）に印刷すると、レジに立てて置きやすくなります。</p>
      </div>

      <div className="print-area overflow-x-auto">
        <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
        <div className="inline-block shadow-[0_1px_6px_rgba(21,18,26,0.15)] print:shadow-none">
          <BookingMeishiSheet storeName={store.name} address={address} phone={store.phone} qrDataUrl={qrDataUrl} coupons={coupons} />
        </div>
      </div>
    </div>
  );
}
