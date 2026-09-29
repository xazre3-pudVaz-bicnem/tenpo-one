'use client';

import { CopyLink } from '@/components/settings/copy-link';
import { BookingQrDownload } from '@/components/settings/booking-qr-download';

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
  coupons = [],
  slugEditor,
}: {
  url: string;
  /** 予約ページの QR（data URL。周りの白4マス込み） */
  qrDataUrl: string | null;
  storeName: string;
  /** 〒 付きの住所（無ければカードに出さない） */
  address: string | null;
  phone: string | null;
  /** 当店のクーポン（表示する文） */
  coupons?: string[];
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
        <div className="mt-4">
          <BookingQrDownload storeName={storeName} address={address} phone={phone} qrDataUrl={qrDataUrl} coupons={coupons} />
        </div>
      )}
    </div>
  );
}
