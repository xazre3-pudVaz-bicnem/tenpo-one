import { redirect } from 'next/navigation';

/** 集計は 設定 > 集計 へ移した（2026-09-28 Ronnie）。古いリンク用 */
export default function MenuSummaryRedirect() {
  redirect('/app/settings/summary');
}
