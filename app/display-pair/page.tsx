import type { Metadata } from 'next';
import { DisplayPairView } from '@/components/display/display-pair-view';
import { pairDisplayDevice } from './actions';

export const metadata: Metadata = {
  title: 'ディスプレイ端末の設定',
  robots: { index: false, follow: false },
};

/**
 * QRから開く端末設定画面（ディスプレイ端末。ハンディの /handy-pair と同じ作り）。
 * コードは URL の # 以降で受け取るため、サーバーやアクセスログには残らない。
 * このページ自体は何も照会せず、受け取った値をサーバーアクションへ渡すだけ。
 */
export default function DisplayPairPage() {
  return <DisplayPairView pairAction={pairDisplayDevice} />;
}
