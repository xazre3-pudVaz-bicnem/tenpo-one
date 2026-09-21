import type { Metadata } from 'next';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { tableOrderUrl, tableQrDataUrl } from '@/lib/table-qr';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { PrintButton } from '@/components/reservations/print-button';

export const metadata: Metadata = { title: 'テーブルQRコードをまとめて印刷 | 設定' };

/**
 * テーブルのお客様QRをまとめて印刷（A4 に6枚・切り取り線つき）。
 * 2026-09-21 店舗報告「QRコードが読み取れない卓がある」→ 全卓を同じ読み取りやすい形（周りの白4マス）で
 * 刷り直せるようにした。トークンは変えない（印刷済みの正しいQRはそのまま使える）。
 */
export default async function TableQrPrintPage() {
  const ctx = await requirePermission('store.settings');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="テーブルQRコードをまとめて印刷" en="Table QR codes" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから印刷してください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: storeRow }, { data: tables }] = await Promise.all([
    supabase.from('stores').select('name, slug').eq('id', store.id).maybeSingle(),
    supabase
      .from('restaurant_tables')
      .select('id, name, qr_token, sort_order, status')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order')
      .order('name'),
  ]);
  const slug = storeRow?.slug ?? null;
  const origin = await resolveSiteOrigin();
  const cards = await Promise.all(
    (tables ?? []).map(async (t) => ({
      id: t.id,
      name: t.name,
      dataUrl: slug && t.qr_token ? await tableQrDataUrl(tableOrderUrl(origin, slug, t.qr_token), 600) : null,
    }))
  );
  const stopped = cards.filter((c) => !c.dataUrl);

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="テーブルQRコードをまとめて印刷"
        en="Table QR codes"
        description={`${storeRow?.name ?? store.name}｜A4に6枚・切り取り線つき。読めないQRは刷り直して貼り替えてください`}
        actions={
          <PrintButton className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-deep">
            <Printer className="h-4 w-4" aria-hidden />
            印刷する
          </PrintButton>
        }
      />
      <div className="mb-4 space-y-1 rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-600">
        <p>・印刷のときは「倍率 100%（実際のサイズ）」「用紙 A4」にしてください。QRは約5cm角で、周りの白いフチも切り落とさないでください。</p>
        <p>・QRの中身（URL）は今のものと同じです。「トークン再発行」はしていないので、正しく読めている卓はそのまま使えます。</p>
        {stopped.length > 0 && (
          <p className="font-semibold text-danger">
            ・QRを止めている卓（{stopped.map((c) => c.name).join('・')}）は出ていません。フロア・テーブルの「QRコード」から再発行してください。
          </p>
        )}
        <p>
          ・1卓だけ刷り直すときは{' '}
          <Link href="/app/settings/tables" className="font-semibold text-primary hover:underline">
            フロア・テーブル
          </Link>{' '}
          の各卓の「QRコード」から印刷できます。
        </p>
      </div>

      {cards.length === 0 ? (
        <EmptyState title="テーブルがありません" description="フロア・テーブルでテーブルを追加してください" />
      ) : (
        <div className="print-area">
          <style>{'@page { size: A4; margin: 10mm; }'}</style>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 print:grid-cols-2 print:gap-0">
            {cards
              .filter((c) => c.dataUrl)
              .map((c) => (
                <div
                  key={c.id}
                  className="flex flex-col items-center justify-center border border-dashed border-gray-300 bg-white px-3 py-4 text-center [break-inside:avoid] print:h-[92mm] print:py-0"
                >
                  <p className="text-[11px] font-bold tracking-wide text-gray-500">{storeRow?.name ?? store.name}</p>
                  <p className="mt-1 text-4xl leading-none font-extrabold text-navy">{c.name}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- サーバーで作った QR の data URL */}
                  <img
                    src={c.dataUrl as string}
                    alt={`${c.name}の注文用QRコード`}
                    width={600}
                    height={600}
                    className="mt-2 h-[52mm] w-[52mm] [image-rendering:pixelated]"
                  />
                  <p className="mt-1 text-[13px] leading-snug font-bold text-navy">
                    スマートフォンのカメラで読み取って
                    <br />
                    ご注文ください
                  </p>
                  <p className="text-[10px] text-gray-500">Scan with your phone camera to order</p>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
