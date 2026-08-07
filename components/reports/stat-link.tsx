import Link from 'next/link';
import { StatCard } from '@/components/ui/stat-card';

/** StatCard をクリック可能にするラッパー。href が無ければ通常の StatCard として表示する */
export function LinkStatCard({
  href,
  ...props
}: React.ComponentProps<typeof StatCard> & { href?: string }) {
  if (!href) return <StatCard {...props} />;
  return (
    <Link
      href={href}
      className="block rounded-xl outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-primary"
    >
      <StatCard {...props} className="cursor-pointer hover:border-primary/40" />
    </Link>
  );
}
