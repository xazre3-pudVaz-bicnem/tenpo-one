'use client';

import { usePathname } from 'next/navigation';

/**
 * 注文画面（/app/pos）では中身を出さない。layout は画面の移動で作り直されないので、
 * 「注文画面かどうか」はサーバーではなくここ（クライアント）で見る。
 */
export function HideOnPos({ children, also }: { children: React.ReactNode; also?: string[] }) {
  const pathname = usePathname();
  if (pathname === '/app/pos' || also?.includes(pathname)) return null;
  return <>{children}</>;
}
