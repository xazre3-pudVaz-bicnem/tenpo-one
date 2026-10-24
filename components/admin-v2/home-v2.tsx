import { createClient } from '@/lib/supabase/server';
import { loadHomeData } from '@/components/dashboard/home-data';
import { loadHomeV2 } from '@/lib/home-v2-server';
import { loadHomePeriod } from '@/lib/home-period-server';
import { compareRange, defaultCompareFor, parseHomeCard, parseHomeCompare, parseHomeRange, resolveHomeRange } from '@/lib/home-period';
import type { SalesMetricsOptions } from '@/lib/metrics';
import type { Role } from '@/lib/permissions';
import { HomeV2View, type HomeV2Todo } from './home-v2-view';

/** 描画の基準時刻（リクエスト時点） */
function requestTime() {
  return Date.now();
}

export type HomeV2SearchParams = Record<string, string | string[] | undefined>;

/**
 * 新しい管理画面のホーム（会社のオーナーがパソコンで ON にしたときだけ。app/app/dashboard/page.tsx）。
 * 上の店舗の切り替えが「全店舗」なら全店舗、1店舗ならその店舗。
 * 期間（?range=）と比較（?compare=）は lib/home-period.ts。数字は lib/home-period-server.ts（lib/metrics.ts の正式定義）。
 * 本日のときだけ、店舗の一覧は「いまの席・未会計・本日の予約」（lib/home-v2-server.ts）。
 */
export async function HomeV2({
  ctx,
  today,
  metricsOpts,
  sp = {},
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
  sp?: HomeV2SearchParams;
}) {
  const supabase = await createClient();
  const stores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  const now = requestTime();

  const range = parseHomeRange(sp.range);
  const compare = defaultCompareFor(range, parseHomeCompare(sp.compare));
  const card = parseHomeCard(sp.card);
  const current = resolveHomeRange(range, today, sp);
  const previous = compareRange(current, compare);
  const isToday = range === 'today';

  const [home, live, period] = await Promise.all([
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
    isToday ? loadHomeV2(supabase, stores, ctx.organizationId, today, now) : Promise.resolve(null),
    loadHomePeriod({
      supabase,
      organizationId: ctx.organizationId,
      stores,
      isAllStores: !ctx.currentStore,
      range: current,
      compare: previous,
      today,
      metricsOpts,
      card,
    }),
  ]);

  // リピート率：本日は今のホームと同じ「初回来店が今日より前の人」（loadHomeData）。期間は「期間内に 2 回以上会計した人」
  const extras = isToday ? { ...period.extras, repeat: home.repeat } : period.extras;
  const repeatNote = isToday ? '顧客を紐づけた会計・初回来店が今日より前ならリピーター' : '顧客を紐づけた会計・期間内に 2 回以上';

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
  const includesToday = current.from <= today && today <= current.to;
  const nowHour = includesToday
    ? Number(d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).slice(0, 2)) % 24
    : null;

  return (
    <HomeV2View
      scopeLabel={ctx.currentStore ? ctx.currentStore.name : `全店舗（${stores.length}店舗）`}
      asOf={asOf}
      period={{ range, compare, current, previous, card }}
      kpi={{ current: period.current, previous: period.previous }}
      extras={extras}
      repeatNote={repeatNote}
      rows={live ? live.rows : null}
      periodRows={live ? null : period.rows}
      todos={todos}
      hourly={period.hourly}
      nowHour={nowHour}
    />
  );
}
