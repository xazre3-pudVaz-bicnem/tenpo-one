import type { Metadata } from 'next';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { tableOrderUrl } from '@/lib/table-qr';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { PrintButton } from '@/components/reservations/print-button';
import { TableQrCard } from '@/components/settings/table-qr-card';
import { TableQrPdfButton } from '@/components/settings/table-qr-pdf-button';
import { TableQrBusinessCard } from '@/components/settings/table-qr-business-card';
import { A4CutSheets } from '@/components/settings/a4-cut-sheets';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'テーブルQRコードをまとめて印刷 | 設定' };

/**
 * テーブルのお客様QRをまとめて印刷。
 * 2026-09-21 店舗報告「QRコードが読み取れない卓がある」→ 全卓を同じ読み取りやすい形（周りの白4マス）で
 * 刷り直せるようにした。トークンは変えない（印刷済みの正しいQRはそのまま使える）。
 * 2026-09-29 Ronnie「A6 で、ダウンロードして印刷するだけ」→ 1卓1枚の A6 カード。
 * 2026-10-16 Ronnie「a4 paper ma katna milne tarikale pdf」→ A4 1枚に4卓＋切り取り線の PDF。
 * 2026-10-17 Ronnie「名刺サイズ・A4 に10面」→ 91×55mm のカードを A4 に 2列×5段。
 * 2026-10-19 Ronnie「デザインを変えて。横名刺で、全部のテーブルを A4 にまとめて印刷して切れるように。A6 も A4 にまとめて切れるように。
 * 印刷するとぼやけるので高画質に。卓番号は真ん中。QR の真ん中に TENPO ONE のロゴ」→
 *   - 大きさは「名刺サイズ（横・A4 に10枚）」と「A6（A4 に4枚）」を上で切り替える（?size=a6。ふだんは名刺）
 *   - 画面には A4 の見本（切り取り線・トンボ入り）をそのまま出す。「印刷する」も A4 でこのまま出る
 *   - QR は SVG（にじまない）。PDF は1枚ずつ約 576dpi の画像にする（TableQrPdfButton）
 */
export default async function TableQrPrintPage({ searchParams }: { searchParams: Promise<{ size?: string }> }) {
  const { size } = await searchParams;
  const a6 = size === 'a6';
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
  const cards = (tables ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    url: slug && t.qr_token ? tableOrderUrl(origin, slug, t.qr_token) : null,
  }));
  const printable = cards.filter((c): c is { id: string; name: string; url: string } => c.url !== null);
  const stopped = cards.filter((c) => !c.url);
  const storeName = storeRow?.name ?? store.name;

  const tab = (on: boolean) =>
    cn(
      'inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold transition-colors',
      on ? 'bg-ink text-white' : 'border border-line bg-white text-ink hover:bg-lilac-soft'
    );
  const secondary =
    'inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-lilac-soft disabled:opacity-70';

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="テーブルQRコードをまとめて印刷"
        en="Table QR codes"
        description={
          a6
            ? `${storeName}｜A6（105×148mm）を A4 に4枚。印刷して点線で切ってください`
            : `${storeName}｜横名刺（91×55mm）を A4 に10枚。印刷して線に沿って切ってください`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TableQrPdfButton
              fileName={a6 ? `${storeName}_テーブルQR_A6_A4に4枚.pdf` : `${storeName}_テーブルQR_名刺_A4に10枚.pdf`}
              layout={a6 ? 'a4-4up' : 'a4-business-card'}
              label={a6 ? 'PDFでダウンロード（A4に4枚）' : 'PDFでダウンロード（A4に10枚）'}
              className="on-brand inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-70"
            />
            {a6 && (
              <TableQrPdfButton fileName={`${storeName}_テーブルQR_A6.pdf`} label="PDF（A6の紙に1枚ずつ）" className={secondary} />
            )}
            <PrintButton className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-lilac-soft">
              <Printer className="h-4 w-4" aria-hidden />
              印刷する
            </PrintButton>
          </div>
        }
      />

      {/* 大きさの切り替え */}
      <nav aria-label="QRの大きさ" className="mb-3 flex flex-wrap gap-2">
        <Link href="/app/settings/tables/qr-print" className={tab(!a6)} aria-current={!a6 ? 'page' : undefined}>
          名刺サイズ（横・A4に10枚）
        </Link>
        <Link href="/app/settings/tables/qr-print?size=a6" className={tab(a6)} aria-current={a6 ? 'page' : undefined}>
          A6（A4に4枚）
        </Link>
      </nav>

      <div className="mb-4 space-y-1 rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-600">
        <p className="font-semibold text-ink">
          ・「PDFでダウンロード」か「印刷する」で、全部のテーブルが A4 にまとめて出ます。用紙 A4・倍率 100%（実際のサイズ）で刷り、
          {a6 ? '点線で切ると A6 のカードになります。' : '点線とトンボ（余白の短い線）に沿って切ると横名刺（91×55mm）になります。'}
        </p>
        <p>・QR は真ん中に TENPO ONE のマーク入り。印刷してもぼやけない高画質です。</p>
        <p>・QRの中身（URL）は今のものと同じです。「トークン再発行」はしていないので、今置いてあるQRもそのまま使えます。</p>
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

      {printable.length === 0 ? (
        <EmptyState title="テーブルがありません" description="フロア・テーブルでテーブルを追加してください" />
      ) : (
        <div className="print-area overflow-x-auto pb-2">
          <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
          {a6 ? (
            <A4CutSheets cardW={105} cardH={148} cols={2} rows={2}>
              {printable.map((c) => (
                <TableQrCard key={c.id} storeName={storeName} tableName={c.name} url={c.url} />
              ))}
            </A4CutSheets>
          ) : (
            <A4CutSheets cardW={91} cardH={55} cols={2} rows={5} note="✂ 線に沿って切ってください ／ 横名刺 91×55mm × 10枚">
              {printable.map((c) => (
                <TableQrBusinessCard key={c.id} storeName={storeName} tableName={c.name} url={c.url} />
              ))}
            </A4CutSheets>
          )}
        </div>
      )}
    </div>
  );
}
