import type { Metadata } from 'next';
import { BrandLogo } from '@/components/layout/brand-logo';
import { PrinterUrlCopy } from '@/components/setup/printer-url-copy';

export const metadata: Metadata = {
  title: 'プリンター接続用URL',
  robots: { index: false, follow: false },
};

/**
 * 設定画面のQRコードから開く、接続用URLのコピー画面（スマホ向け）。
 * トークンは URL の # 以降（フラグメント）で受け取るため、サーバーやアクセスログには送られない。
 * このページ自体は何も照会せず、受け取った値からURLを組み立てて表示するだけ。
 */
export default function PrinterSetupPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-8">
      <BrandLogo className="text-xl" />
      <h1 className="mt-5 text-lg font-bold text-navy">プリンター接続用URL</h1>
      <p className="mt-1 text-sm text-gray-600">
        下のURLをコピーして、Star Quick Setup Utility の「CloudPRNT」→「サーバーURL」に貼り付けてください。
      </p>
      <PrinterUrlCopy />
    </div>
  );
}
