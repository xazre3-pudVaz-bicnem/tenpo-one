import type { Metadata } from 'next';
import { HandyJoinView } from '@/components/handy/handy-join-view';
import { handyHeartbeat, joinHandyByQr } from './actions';

export const metadata: Metadata = {
  title: 'ハンディ',
  robots: { index: false, follow: false },
  manifest: '/manifest-handy.webmanifest',
  applicationName: 'ハンディ',
  appleWebApp: { capable: true, title: 'ハンディ', statusBarStyle: 'black' },
};
export const viewport = { themeColor: '#211c28' };

/**
 * iPhone用ハンディの入口。お店の固定QRコード（/handy-join#<QRの値>）を読むと、
 * お店のWi-Fiにつないでいればそのままハンディが開く。
 * ?out=1 は Wi-Fi の外に出て自動でログアウトしたとき。
 */
export default async function HandyJoinPage({ searchParams }: { searchParams: Promise<{ out?: string }> }) {
  const { out } = await searchParams;
  return <HandyJoinView joinAction={joinHandyByQr} heartbeatAction={handyHeartbeat} loggedOut={out === '1'} />;
}
