'use client';

import Link from 'next/link';
import { IdCard } from 'lucide-react';
import { BookingQrCard } from '@/components/settings/booking-qr-card';
import { TableQrPdfButton } from '@/components/settings/table-qr-pdf-button';

/**
 * 予約QRの横名刺カード（91×55mm。店舗名・住所・電話番号入り）を見せて、PDF（名刺サイズ1枚）・PNG でダウンロードする。
 * 2026-10-18 Ronnie「横名刺サイズに」で A6 から変更。
 * 店舗情報（設定トップ・編集画面）で使う（2026-09-30 Ronnie「編集を押さなくても店舗情報に出るように」）。
 */
export function BookingQrDownload({
  storeName,
  address,
  phone,
  qrDataUrl,
  qrValue,
  coupons = [],
  align = 'start',
}: {
  storeName: string;
  address: string | null;
  phone: string | null;
  /** 予約ページの QR（data URL。周りの白4マス込み） */
  qrDataUrl: string;
  /** 予約ページの URL（あれば QR を SVG で描く＝印刷でにじまない） */
  qrValue?: string;
  /** 当店のクーポン（表示する文） */
  coupons?: string[];
  /** ボタンの並び（設定トップは右寄せ） */
  align?: 'start' | 'end';
}) {
  return (
    <div className={`flex flex-wrap items-center gap-5 ${align === 'end' ? 'sm:justify-end' : ''}`}>
      {/* 横名刺（91×55mm）をそのままの大きさで見せる。ダウンロードもこの見た目 */}
      <div className="shrink-0 overflow-hidden rounded-lg shadow-[0_1px_4px_rgba(41,39,37,0.12)]">
        <BookingQrCard storeName={storeName} address={address} phone={phone} dataUrl={qrDataUrl} qrValue={qrValue} coupons={coupons} />
      </div>
      <div className="text-left text-sm">
        <p className="font-medium text-navy">予約QRコード</p>
        <p className="mt-0.5 text-xs font-normal text-gray-500">
          スマホで読み取ると予約ページが開きます。店舗名・住所・電話番号入り（横名刺 91×55mm）
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <TableQrPdfButton
            fileName={`${storeName}_予約QR_名刺.pdf`}
            page="card"
            label="PDFでダウンロード（名刺サイズ）"
            className="on-brand inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
          />
          <TableQrPdfButton
            format="png"
            fileName={`${storeName}_予約QR.png`}
            label="PNGをダウンロード"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-navy hover:bg-gray-50 disabled:opacity-70"
          />
          {/* A4 に横名刺 10枚（切り取り線入り）。2026-09-30 Ronnie「店舗名刺としてプリントする」 */}
          <Link
            href="/app/settings/store/business-cards"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-navy hover:bg-gray-50"
          >
            <IdCard className="h-4 w-4" aria-hidden />
            店舗名刺としてプリントする
          </Link>
        </div>
      </div>
    </div>
  );
}
