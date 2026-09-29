'use client';

import { CopyLink } from '@/components/settings/copy-link';
import { BookingQrCard } from '@/components/settings/booking-qr-card';
import { TableQrPdfButton } from '@/components/settings/table-qr-pdf-button';

/**
 * 公開予約ページのURLとQRコードを表示する。Google/Instagram/LINE/店舗HPへの掲出用。
 * QR はテーブルQRと同じ A6 のカード（店舗名・住所・電話番号入り）で、PDF（A6）か PNG でダウンロードする
 * （2026-09-30 Ronnie「ダウンロードしたら店舗名・電話番号・住所も。テーブルと同じデザインで」）。
 * 置き場所は 店舗情報（2026-09-30 Ronnie「店舗情報に置いて。予約受付ルールには要らない」）。
 */
export function BookingUrlPanel({
  url,
  qrDataUrl,
  storeName,
  address,
  phone,
  slugEditor,
}: {
  url: string;
  /** 予約ページの QR（data URL。周りの白4マス込み） */
  qrDataUrl: string | null;
  storeName: string;
  /** 〒 付きの住所（無ければカードに出さない） */
  address: string | null;
  phone: string | null;
  /** スラッグ編集UI（サーバー側で組み立てて渡す） */
  slugEditor?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-sm font-semibold text-navy">公開予約ページ</p>
      <p className="mb-3 text-xs text-gray-500">
        このURL・QRコードを Google ビジネスプロフィール／Instagram／LINE／店舗HP に掲出できます。
      </p>
      <CopyLink url={url} label="公開予約URL" />
      {slugEditor && <div className="mt-3 border-t border-gray-100 pt-3">{slugEditor}</div>}

      {qrDataUrl && (
        <div className="mt-4 flex flex-wrap items-center gap-5">
          {/* A6 のカードを半分の大きさで見せる（ダウンロードは元の大きさで画像にする） */}
          <div className="h-[74mm] w-[52.5mm] shrink-0 overflow-hidden rounded-lg shadow-[0_1px_4px_rgba(21,18,26,0.12)]">
            <div className="origin-top-left scale-50">
              <BookingQrCard storeName={storeName} address={address} phone={phone} dataUrl={qrDataUrl} />
            </div>
          </div>
          <div className="text-sm">
            <p className="font-medium text-navy">予約QRコード</p>
            <p className="mt-0.5 text-xs text-gray-500">
              スマホで読み取ると予約ページが開きます。店舗名・住所・電話番号入り（A6）
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <TableQrPdfButton
                fileName={`${storeName}_予約QR_A6.pdf`}
                className="on-brand inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
              />
              <TableQrPdfButton
                format="png"
                fileName={`${storeName}_予約QR.png`}
                label="PNGをダウンロード"
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-navy hover:bg-gray-50 disabled:opacity-70"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
