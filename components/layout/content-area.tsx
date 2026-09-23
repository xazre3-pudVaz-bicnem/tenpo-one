'use client';

import { usePathname } from 'next/navigation';

/**
 * 本文の左余白。左メニューが出ているときだけ 250px 空ける。
 * 画面の移動では layout が作り直されないため、余白の判定もここ（クライアント）で行う。
 */
export function ContentArea({
  homeOnly,
  children,
}: {
  /** レジ端末：左メニューはホーム画面だけ */
  homeOnly: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const fullWidth = pathname === '/app/pos' || (homeOnly && pathname !== '/app/dashboard');
  return <div className={fullWidth ? undefined : 'lg:pl-[250px]'}>{children}</div>;
}
