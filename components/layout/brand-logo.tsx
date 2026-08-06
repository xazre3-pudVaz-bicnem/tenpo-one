import { brand } from '@/lib/brand';
import { cn } from '@/lib/utils';

/** ロゴ。紫グラデーションはロゴと重要箇所のみに限定して使用する。 */
export function BrandLogo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1 font-bold tracking-tight', className)}>
      <span className="bg-gradient-to-r from-[#7B3FF2] to-[#5A2ED6] bg-clip-text text-transparent">
        TENPO
      </span>
      <span className={light ? 'text-white' : 'text-navy'}>ONE</span>
    </span>
  );
}

export function BrandTagline({ className }: { className?: string }) {
  return <span className={cn('text-xs text-gray-400', className)}>{brand.tagline}</span>;
}
