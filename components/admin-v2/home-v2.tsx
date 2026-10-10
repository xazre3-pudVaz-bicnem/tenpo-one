import { createClient } from '@/lib/supabase/server';
import { loadHomeData } from '@/components/dashboard/home-data';
import { loadHomeV2 } from '@/lib/home-v2-server';
import type { SalesMetricsOptions } from '@/lib/metrics';
import type { Role } from '@/lib/permissions';
import { HomeV2View, type HomeV2Todo } from './home-v2-view';

/** 描画の基準時刻（リクエスト時点） */
function requestTime() {
  return Date.now();
}

/**
 * 新しい管理画面のホーム（会社のオーナーがパソコンで ON にしたときだけ。app/app/dashboard/page.tsx）。
 * 上の店舗の切り替えが「全店舗」なら全店舗、1店舗ならその店舗。数字は今のホームと同じ決め方（loadHomeData）。
 */
export async function HomeV2({
  ctx,
  today,
  metricsOpts,
}: {
  ctx: {
    organizationId: string;
    userId: string;
    role: Role;
    disabledFeatures: ReadonlySet<string>;
    stores: { id: string; name: string }[];
    currentStore: { id: string; name: string } | null;
  };
  today: string;
  metricsOpts: SalesMetricsOptions;
}) {
  const supabase = await createClient();
  const stores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  const now = requestTime();
  const [home, v2] = await Promise.all([
    loadHomeData({
      supabase,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      role: ctx.role,
      accountingEnabled: !ctx.disabledFeatures.has('accounting'),
      stores,
      isAllStores: !ctx.currentStore,
      today,
      metricsOpts,
    }),
    loadHomeV2(supabase, stores, ctx.organizationId, today, now),
  ]);

  const todos: HomeV2Todo[] = [
    ...home.autoNotices.map((n) => ({
      key: `n-${n.id}`,
      label: n.message,
      sub: n.at,
      href: n.href,
      linkLabel: n.linkLabel ?? '見る',
      tone: 'warn' as const,
    })),
    ...home.todos.map((t) => ({
      key: `t-${t.key}`,
      label: t.label,
      sub: t.valueLabel ?? `${t.count}件`,
      href: t.href,
      linkLabel: '見る',
      tone: 'info' as const,
    })),
  ];

  const d = new Date(now);
  const asOf = `${d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short' })} ${d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}`;
  const nowHour = Number(d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).slice(0, 2)) % 24;

  return (
    <HomeV2View
      scopeLabel={ctx.currentStore ? ctx.currentStore.name : `全店舗（${stores.length}店舗）`}
      asOf={asOf}
      kpi={{
        sales: home.actualSales,
        settled: home.actualSales - home.openSales,
        open: home.openSales,
        guests: home.guests,
        groups: home.groups,
        avgSpend: home.avgSpend,
        dailyBudget: home.dailyBudget,
        achievementPct: home.achievementPct,
      }}
      rows={v2.rows}
      todos={todos}
      hourly={v2.hourly}
      nowHour={nowHour}
    />
  );
}
