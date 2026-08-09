import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/** セクション見出し（中央 or 左寄せ） */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
  tone = 'light',
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'center' | 'left';
  tone?: 'light' | 'dark';
}) {
  return (
    <div className={cn(align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl')}>
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
      )}
      <h2
        className={cn(
          'text-2xl font-bold tracking-tight sm:text-3xl',
          eyebrow && 'mt-3',
          tone === 'dark' ? 'text-white' : 'text-navy'
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            'mt-4 text-sm leading-relaxed sm:text-base',
            tone === 'dark' ? 'text-gray-300' : 'text-gray-600'
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}

/**
 * 実際のTENPO ONE画面/利用シーンを見せる写真枠。
 * device='browser' で軽いブラウザ風フレーム、'plain' で角丸+影のみ。
 */
export function Screenshot({
  src,
  alt,
  priority = false,
  device = 'plain',
  className,
  sizes = '(max-width: 1024px) 100vw, 50vw',
}: {
  src: string;
  alt: string;
  priority?: boolean;
  device?: 'plain' | 'browser';
  className?: string;
  sizes?: string;
}) {
  if (device === 'browser') {
    return (
      <div className={cn('overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5', className)}>
        <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
        </div>
        <Image
          src={src}
          alt={alt}
          width={1690}
          height={950}
          priority={priority}
          sizes={sizes}
          className="h-auto w-full"
        />
      </div>
    );
  }
  return (
    <div className={cn('overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/5', className)}>
      <Image
        src={src}
        alt={alt}
        width={1690}
        height={950}
        priority={priority}
        sizes={sizes}
        className="h-auto w-full"
      />
    </div>
  );
}

/** CTAボタン群（Primary=無料で相談[上書き可] / Secondary=任意） */
export function CtaButtons({
  primaryHref = '/contact',
  primaryLabel = '無料で相談する',
  secondaryHref,
  secondaryLabel,
  align = 'left',
  className,
}: {
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-3', align === 'center' && 'justify-center', className)}>
      <Link href={primaryHref} className={buttonVariants({ size: 'lg' })}>
        {primaryLabel}
        <ArrowRight className="h-4 w-4" />
      </Link>
      {secondaryHref && (
        <Link href={secondaryHref} className={buttonVariants({ size: 'lg', variant: 'secondary' })}>
          {secondaryLabel}
        </Link>
      )}
    </div>
  );
}

/** 最終CTAセクション（濃紺・全ページ共通） */
export function FinalCta({
  title = '店舗運営を、ひとつに。',
  description = 'まずはお問い合わせください。店舗数や現在お使いのツールをお聞かせいただければ、画面を見ながら導入についてご案内します。',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <section className="bg-navy">
      <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">{title}</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-gray-400 sm:text-base">{description}</p>
        <div className="mt-8">
          <CtaButtons secondaryHref="/features" secondaryLabel="機能を見る" align="center" />
        </div>
      </div>
    </section>
  );
}

/** パンくず（詳細ページ用・BreadcrumbList JSON-LDは各ページで別途出力） */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="パンくずリスト" className="text-xs text-gray-500">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {item.href ? (
              <Link href={item.href} className="hover:text-primary-deep">{item.label}</Link>
            ) : (
              <span className="text-gray-700">{item.label}</span>
            )}
            {i < items.length - 1 && <span className="text-gray-300">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
