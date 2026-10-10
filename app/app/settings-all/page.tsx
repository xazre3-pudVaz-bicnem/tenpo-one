import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, MonitorSmartphone } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { visibleV2Settings } from '@/lib/admin-v2';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: '設定の一覧' };

type Show = 'all' | 'admin' | 'ipad';

/**
 * 設定の一覧（新しい管理画面。2026-10-10 Ronnie「iPad で変えられない設定をぜんぶ管理画面に」）。
 * 設定の中身は今の各画面のまま。ここは入口と「管理画面だけ」の印（lib/admin-v2.ts の V2_SETTINGS）。
 */
export default async function SettingsAllPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireMember();
  const sp = await searchParams;
  const show: Show = sp.show === 'admin' || sp.show === 'ipad' ? sp.show : 'all';
  const sections = visibleV2Settings(ctx.role);
  const all = sections.flatMap((s) => s.items);
  const adminOnly = all.filter((i) => i.adminOnly);
  const filtered = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => (show === 'admin' ? i.adminOnly : show === 'ipad' ? !i.adminOnly : true)) }))
    .filter((s) => s.items.length > 0);

  const tabs: { key: Show; label: string; count: number }[] = [
    { key: 'all', label: 'すべて', count: all.length },
    { key: 'admin', label: '管理画面だけ', count: adminOnly.length },
    { key: 'ipad', label: 'iPad でも変えられる', count: all.length - adminOnly.length },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="設定"
        en="Settings"
        description="お店の設定はここから全部開けます。「管理画面だけ」の印は、iPad（レジ）からは変えられない設定です"
      />

      <nav aria-label="表示する設定" className="-mt-2 flex w-fit flex-wrap gap-0.5 rounded-lg border border-line bg-white p-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'all' ? '/app/settings-all' : `/app/settings-all?show=${t.key}`}
            aria-current={show === t.key ? 'page' : undefined}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-[13px]',
              show === t.key ? 'bg-plum font-bold text-white' : 'text-ink-2 hover:bg-lilac-soft hover:text-royal'
            )}
          >
            {t.label} {t.count}
          </Link>
        ))}
      </nav>

      {show !== 'ipad' && adminOnly.length > 0 && (
        <section aria-label="iPadでは変えられない設定" className="flex flex-col gap-3 rounded-xl border border-wisteria bg-white px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-iris-soft text-royal">
              <MonitorSmartphone className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="flex flex-col">
              <h2 className="text-[15px] font-extrabold text-ink">iPad（レジ）では変えられない設定　{adminOnly.length}</h2>
              <p className="text-[12.5px] text-ink-2">スタッフが触って壊さないように、パソコンの管理画面（店長以上）だけで変えます</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {adminOnly.map((i) => (
              <Link
                key={i.label}
                href={i.href}
                className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 hover:border-wisteria hover:text-royal"
              >
                {i.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4">
        {filtered.map((s) => (
          <section key={s.id} id={s.id} aria-label={s.label} className="scroll-mt-20 rounded-xl border border-line bg-white px-5 pt-3.5 pb-1.5">
            <h2 className="mb-2 text-[15px] font-extrabold text-ink">{s.label}</h2>
            {s.items.map((i) => (
              <Link key={i.label} href={i.href} className="group flex items-center gap-3 border-t border-line/70 py-3 text-ink">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-bold group-hover:text-royal">{i.label}</span>
                  <span className="text-xs text-ink-3">
                    {i.description}
                    {i.note ? `（${i.note}）` : ''}
                  </span>
                </span>
                {i.adminOnly && (
                  <span className="shrink-0 rounded-full bg-iris-soft px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-royal">管理画面だけ</span>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-wisteria" aria-hidden />
              </Link>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
