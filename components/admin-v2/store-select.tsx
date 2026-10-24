'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Store } from 'lucide-react';
import { switchStore } from '@/app/app/actions';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * 店舗を選ぶプルダウン（2026-10-24 Ronnie「店舗を全部ボタンで並べない。選べるように」）。
 * 選ぶと上の店舗の切り替えと同じく、その店舗を覚えて hrefTemplate の {id} をその店舗にした場所へ行く。店舗ナウなどで使う。
 * （サーバー部品からは関数を渡せないので、行き先は文字列のテンプレートで受け取る）
 */
export function StoreSelect({
  stores,
  currentId,
  hrefTemplate,
  className,
}: {
  stores: { id: string; name: string }[];
  currentId: string;
  /** 例 '/app/now?store={id}' */
  hrefTemplate: string;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <label className={cn('relative inline-flex h-10 items-center rounded-lg border border-line bg-white pr-9 pl-3 text-sm font-bold text-ink hover:border-wisteria', pending && 'opacity-60', className)}>
      <Store className="mr-2 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
      <span className="sr-only">店舗を選ぶ</span>
      <select
        value={currentId}
        disabled={pending}
        className="absolute inset-0 w-full cursor-pointer appearance-none opacity-0"
        onChange={(e) => {
          const id = e.target.value;
          startTransition(async () => {
            try {
              await switchStore(id);
              router.push(hrefTemplate.replace('{id}', encodeURIComponent(id)));
            } catch (err) {
              toast(err instanceof Error ? err.message : '店舗を切り替えられませんでした', 'error');
            }
          });
        }}
      >
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none max-w-[260px] truncate">{stores.find((s) => s.id === currentId)?.name ?? '店舗'}</span>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-ink-3" aria-hidden />
    </label>
  );
}
