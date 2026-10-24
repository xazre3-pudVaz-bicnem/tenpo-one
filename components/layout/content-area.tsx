'use client';

import { usePathname } from 'next/navigation';
import { regiAccentFor } from '@/lib/regi-accent';

/**
 * 本文の左余白。左メニューが出ているときだけ 250px 空ける。
 * 画面の移動では layout が作り直されないため、余白の判定もここ（クライアント）で行う。
 */
export function ContentArea({
  homeOnly,
  alwaysSidebar = false,
  children,
}: {
  /** レジ端末：左メニューはホーム画面だけ */
  homeOnly: boolean;
  /** 新しい管理画面（パソコン）：どの幅でも左メニューがあるので、いつも左を空ける（狭い幅は 230px・広い幅は 250px） */
  alwaysSidebar?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // レジ（iPad）は左メニューを出さないので、ホームも含めて全幅（2026-10-19 Ronnie の新しいレイアウト）
  const fullWidth = pathname === '/app/pos' || homeOnly;
  // レジ（iPad）だけ、画面ごとの色（ホームのボタンと同じ色。lib/regi-accent.ts・app/globals.css）
  const accent = homeOnly ? regiAccentFor(pathname) : null;
  return (
    <div className={fullWidth ? undefined : alwaysSidebar ? 'pl-[230px] lg:pl-[250px]' : 'lg:pl-[250px]'} data-regi-accent={accent ?? undefined}>
      {children}
    </div>
  );
}
