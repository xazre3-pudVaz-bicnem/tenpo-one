import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'オフライン',
  robots: { index: false, follow: false },
};

/**
 * オフライン時のフォールバック画面。Service Worker が通信失敗時にこのページを返す。
 * 認証・データ取得を行わない完全な静的ページにしておく（オフラインでも必ず表示できるようにするため）。
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm">
        <WifiOff className="h-8 w-8 text-gray-400" />
      </div>
      <h1 className="mt-6 text-xl font-bold text-navy">オフラインです</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-600">
        インターネットに接続できないため、{brand.name} を表示できません。
        Wi-Fiやモバイル通信の状態をご確認のうえ、再読み込みしてください。
      </p>
      <p className="mt-4 text-xs text-gray-500">
        会計・注文データは端末に保存されません。通信が復帰してから操作してください。
      </p>
    </div>
  );
}
