import { brand } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * ロゴ。六角マーク（透過PNG・濃色/淡色どちらの背景でも使用可）＋ワードマーク。
 * Midnight Sunset のグラデーション（.text-sunset）はロゴと見出し・選択中の表示のみに使う。
 * markOnly でマークのみ、showMark=false でワードマークのみ表示できる。
 */
export function BrandLogo({
  className,
  light,
  showMark = true,
  markOnly = false,
}: {
  className?: string;
  light?: boolean;
  showMark?: boolean;
  markOnly?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold tracking-tight', className)}>
      {showMark && (
        // 高さは文字サイズ(1em)に追従。next/imageは固定サイズ用途に不向きなためプレーンimgを使用。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo-mark.png"
          alt={markOnly ? brand.name : ''}
          aria-hidden={markOnly ? undefined : true}
          className="h-[1.15em] w-auto shrink-0"
        />
      )}
      {!markOnly && (
        <span className="inline-flex items-baseline gap-1">
          <span className="text-sunset">TENPO</span>
          <span className={light ? 'text-white' : 'text-navy'}>ONE</span>
        </span>
      )}
    </span>
  );
}

export function BrandTagline({ className }: { className?: string }) {
  return <span className={cn('text-xs text-gray-400', className)}>{brand.tagline}</span>;
}
