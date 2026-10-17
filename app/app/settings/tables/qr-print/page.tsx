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
import { TableQrBusinessCard } from '@/components/settings/table-qr-business-card';

export const metadata: Metadata = { title: 'テーブルQRコードをまとめて印刷 | 設定' };

/**
 * テーブルのお客様QRをまとめて印刷。
 * 2026-09-21 店舗報告「QRコードが読み取れない卓がある」→ 全卓を同じ読み取りやすい形（周りの白4マス）で
 * 刷り直せるようにした。トークンは変えない（印刷済みの正しいQRはそのまま使える）。
 * 2026-09-29 Ronnie「A6 で、黒と紫（TENPO ONE の色）、ダウンロードして印刷するだけ」→ 1卓1枚の A6 カード
 * （components/settings/table-qr-card.tsx）。PDF でダウンロード（A6・1枚1ページ）か、そのまま印刷（@page A6）。
 * 2026-10-16 Ronnie「a4 paper ma katna milne tarikale pdf」→ A4 1枚に4卓＋切り取り線の PDF も選べるようにした。
 * 2026-10-17 Ronnie「名刺サイズ・A4 に10面」→ 91×55mm のカード（components/settings/table-qr-business-card.tsx）を
 * A4 に 2列×5段＋切り取り線の PDF。カードは PDF を作るためだけに画面外に描いておく。
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
        description={`${storeName}｜A6（105×148mm）に1卓1枚。A4に4卓並べて切る形でも出せます`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TableQrPdfButton
              fileName={`${storeName}_テーブルQR_A4_4面.pdf`}
              layout="a4-4up"
              label="PDFでダウンロード（A4・4面）"
              className="on-brand inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-70"
            />
            <TableQrPdfButton
              fileName={`${storeName}_テーブルQR_名刺サイズ.pdf`}
              layout="a4-business-card"
              label="PDFでダウンロード（名刺サイズ・A4に10面）"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-lilac-soft disabled:opacity-70"
            />
            <TableQrPdfButton
              fileName={`${storeName}_テーブルQR_A6.pdf`}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-lilac-soft disabled:opacity-70"
            />
            <PrintButton className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-lilac-soft">
              <Printer className="h-4 w-4" aria-hidden />
              印刷する
            </PrintButton>
          </div>
        }
      />
      <div className="mb-4 space-y-1 rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-600">
        <p className="font-semibold text-ink">
          ・ふつうは「PDFでダウンロード（A4・4面）」。A4 の紙にそのまま刷って、点線で切るだけで A6 のカードになります（倍率は
          100%・実際のサイズ）。
        </p>
        <p>
          ・名刺サイズで配るなら「PDFでダウンロード（名刺サイズ・A4に10面）」。A4 の紙に刷って点線で切ると 91×55mm のカードになります。
        </p>
        <p>・A6 の紙に1枚ずつ刷れるプリンターなら「PDFでダウンロード（A6）」。1ページに1卓です。</p>
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
                <div key={c.id} className="rounded-lg shadow-[0_1px_4px_rgba(41,39,37,0.12)] print:rounded-none print:shadow-none">
                  <TableQrCard storeName={storeName} tableName={c.name} dataUrl={c.dataUrl as string} />
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 名刺サイズの PDF 用（画面外に描いておき、ボタンが1枚ずつ画像にする。画面・印刷には出ない位置） */}
      {cards.some((c) => c.dataUrl) && (
        <div aria-hidden className="pointer-events-none fixed top-0 left-[-10000px] flex flex-col gap-[2mm]">
          {cards
            .filter((c) => c.dataUrl)
            .map((c) => (
              <TableQrBusinessCard key={c.id} storeName={storeName} tableName={c.name} dataUrl={c.dataUrl as string} />
            ))}
        </div>
      )}
    </div>
  );
}
