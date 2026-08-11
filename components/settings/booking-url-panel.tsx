'use client';

import { Download } from 'lucide-react';
import { CopyLink } from '@/components/settings/copy-link';

/**
 * 公開予約ページのURLとQRコードを表示する。QRはサーバーで生成した data URL を受け取り、
 * 画像表示＋PNGダウンロードを提供する。Google/Instagram/LINE/店舗HPへの掲出用。
 */
export function BookingUrlPanel({
  url,
  qrDataUrl,
  storeName,
  slugEditor,
}: {
  url: string;
  qrDataUrl: string | null;
  storeName: string;
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
        <div className="mt-4 flex items-center gap-4">
          {/* data URL は CSP img-src の data: 許可により表示可 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt={`${storeName}の予約QRコード`} className="h-32 w-32 rounded-lg border border-gray-200" />
          <div className="text-sm">
            <p className="font-medium text-navy">予約QRコード</p>
            <p className="mt-0.5 text-xs text-gray-500">スマホで読み取ると予約ページが開きます。</p>
            <a
              href={qrDataUrl}
              download={`booking-qr-${storeName}.png`}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-navy hover:bg-gray-50"
            >
              <Download className="h-3.5 w-3.5" />
              PNGをダウンロード
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
