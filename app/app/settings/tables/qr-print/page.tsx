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
import { TableQrCard } from '@/components/settings/table-qr-card';
import { TableQrPdfButton } from '@/components/settings/table-qr-pdf-button';

export const metadata: Metadata = { title: 'テーブルQRコードをまとめて印刷 | 設定' };

/**
 * テーブルのお客様QRをまとめて印刷。
 * 2026-09-21 店舗報告「QRコードが読み取れない卓がある」→ 全卓を同じ読み取りやすい形（周りの白4マス）で
 * 刷り直せるようにした。トークンは変えない（印刷済みの正しいQRはそのまま使える）。
 * 2026-09-29 Ronnie「A6 で、黒と紫（TENPO ONE の色）、ダウンロードして印刷するだけ」→ 1卓1枚の A6 カード
 * （components/settings/table-qr-card.tsx）。PDF でダウンロード（A6・1枚1ページ）か、そのまま印刷（@page A6）。
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
  const storeName = storeRow?.name ?? store.name;

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="テーブルQRコードをまとめて印刷"
        en="Table QR codes"
        description={`${storeName}｜A6（105×148mm）に1卓1枚。PDFでダウンロードして印刷するだけ`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TableQrPdfButton
              fileName={`${storeName}_テーブルQR_A6.pdf`}
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
        <p>・「PDFでダウンロード」→ PDF を開いて「倍率 100%（実際のサイズ）」「用紙 A6」で印刷してください。1ページに1卓です。</p>
        <p>・A4 の紙しか無いときは、印刷の設定で「1枚に4ページ」にすると A4 1枚に4卓（ちょうど A6 の大きさ）で出ます。</p>
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
          <style>{'@page { size: A6 portrait; margin: 0; }'}</style>
          <div className="flex flex-wrap gap-4 print:block">
            {cards
              .filter((c) => c.dataUrl)
              .map((c) => (
                <div key={c.id} className="rounded-lg shadow-[0_1px_4px_rgba(21,18,26,0.12)] print:rounded-none print:shadow-none">
                  <TableQrCard storeName={storeName} tableName={c.name} dataUrl={c.dataUrl as string} />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
