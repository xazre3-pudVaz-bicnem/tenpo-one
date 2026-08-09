'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * スクロール時の軽いフェード＋上方向への移動。
 * prefers-reduced-motion では即座に表示（アニメーションなし）。
 * IntersectionObserver で一度だけ発火。アニメーション自体を主役にしない。
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 同期setStateによるcascading renders警告を避けるため、判定はタスクへ遅延する
    let io: IntersectionObserver | null = null;
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setShown(true);
        return;
      }
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              setShown(true);
              io?.disconnect();
            }
          }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.1 }
      );
      io.observe(el);
    }, 0);
    return () => {
      clearTimeout(timer);
      io?.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
      className={cn(
        'transition-all duration-700 ease-out motion-reduce:transition-none',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        className
      )}
    >
      {children}
    </div>
  );
}
