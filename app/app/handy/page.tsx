import { redirect } from 'next/navigation';

/**
 * ハンディは TENPO ONE 本体の外（/handy）の全画面アプリに移した。
 * 左メニュー・下部ナビ（lib/nav.ts）のリンクを壊さないよう、旧URLは新URLへ送るだけにする。
 */
export default function HandyRedirectPage() {
  redirect('/handy');
}
