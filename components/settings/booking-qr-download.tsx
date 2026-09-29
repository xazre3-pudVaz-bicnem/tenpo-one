'use client';

import { BookingQrCard } from '@/components/settings/booking-qr-card';
import { TableQrPdfButton } from '@/components/settings/table-qr-pdf-button';

/**
 * 予約QRの A6 カード（店舗名・住所・電話番号入り）を半分の大きさで見せて、PDF（A6）・PNG でダウンロードする。
 * 店舗情報（設定トップ・編集画面）で使う（2026-09-30 Ronnie「編集を押さなくても店舗情報に出るように」）。
 */
export function BookingQrDownload({
  storeName,
  address,
  phone,
  qrDataUrl,
  align = 'start',
}: {
  storeName: string;
  address: string | null;
  phone: string | null;
  /** 予約ページの QR（data URL。周りの白4マス込み） */
  qrDataUrl: string;
  /** ボタンの並び（設定トップは右寄せ） */
  align?: 'start' | 'end';
}) {
  return (
    <div className={`flex flex-wrap items-center gap-5 ${align === 'end' ? 'sm:justify-end' : ''}`}>
      {/* A6 のカードを半分の大きさで見せる（ダウンロードは元の大きさで画像にする） */}
      <div className="h-[74mm] w-[52.5mm] shrink-0 overflow-hidden rounded-lg shadow-[0_1px_4px_rgba(21,18,26,0.12)]">
        <div className="origin-top-left scale-50">
          <BookingQrCard storeName={storeName} address={address} phone={phone} dataUrl={qrDataUrl} />
        </div>
      </div>
      <div className="text-left text-sm">
        <p className="font-medium text-navy">予約QRコード</p>
        <p className="mt-0.5 text-xs font-normal text-gray-500">
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
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-navy hover:bg-gray-50 disabled:opacity-70"
          />
        </div>
      </div>
    </div>
  );
}
