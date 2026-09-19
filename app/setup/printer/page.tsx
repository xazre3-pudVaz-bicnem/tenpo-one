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
 * ?m=epson のときは EPSON（Server Direct Print）向けのURLと手順を出す。
 */
export default async function PrinterSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const isEpson = m === 'epson';

  return (
    <div className="mx-auto max-w-md px-5 py-8">
      <BrandLogo className="text-xl" />
      <h1 className="mt-5 text-lg font-bold text-navy">プリンター接続用URL</h1>
      <p className="mt-1 text-sm text-gray-600">
        {isEpson
          ? '下のURLをコピーして、プリンターの設定画面（Web Config）の「Server Direct Print」→「サーバー1 URL」に貼り付けてください。'
          : '下のURLをコピーして、Star Quick Setup Utility の「CloudPRNT」→「サーバーURL」に貼り付けてください。'}
      </p>
      <PrinterUrlCopy maker={isEpson ? 'epson' : 'star'} />
    </div>
  );
}
