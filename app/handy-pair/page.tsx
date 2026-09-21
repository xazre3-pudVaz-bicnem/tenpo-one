import type { Metadata } from 'next';
import { HandyPairView } from '@/components/handy/handy-pair-view';
import { pairHandyDevice } from './actions';

export const metadata: Metadata = {
  title: 'ハンディの設定',
  robots: { index: false, follow: false },
};

/**
 * QRから開く端末設定画面。
 * コードは URL の # 以降で受け取るため、サーバーやアクセスログには残らない。
 * このページ自体は何も照会せず、受け取った値をサーバーアクションへ渡すだけ。
 */
export default function HandyPairPage() {
  return <HandyPairView pairAction={pairHandyDevice} />;
}
