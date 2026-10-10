'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { switchStore } from '@/app/app/actions';
import { useToast } from '@/components/ui/toast';

/**
 * 店舗を選んで（上の店舗の切り替えと同じ）、その店舗の画面へ行くボタン。
 * 店舗ナウの店舗タブ・ホームの店舗の行で使う。店舗台帳・伝票明細も同じ店舗で開けるように、選んだ店舗を覚えておく。
 */
export function StoreSwitchLink({
  storeId,
  href,
  className,
  children,
  current,
}: {
  storeId: string;
  href: string;
  className?: string;
  children: React.ReactNode;
  current?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      disabled={pending}
      className={className}
      onClick={() =>
        startTransition(async () => {
          try {
            await switchStore(storeId);
            router.push(href);
          } catch (e) {
            toast(e instanceof Error ? e.message : '店舗を切り替えられませんでした', 'error');
          }
        })
      }
    >
      {children}
    </button>
  );
}
