/**
 * ホーム上段（プロトタイプ 01-home の配置）:
 * お知らせ → [予算達成率(2/3) | 時計(1/3)] → KPI 5タイル
 */
import { Suspense } from 'react';
import { BudgetCard } from './budget-card';
import { ClockCard } from './clock-card';
import { HomeKpis } from './home-kpis';
import { HomeNotices } from './home-notices';
import { StorePlace, StoreWeatherInfo } from './weather-slot';
import type { HomeData } from './home-data';

export function HomeTop({
  data,
  asOf,
  guestsNote,
  ordersHref,
}: {
  data: HomeData;
  asOf: string;
  guestsNote?: string;
  ordersHref: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <HomeNotices
        announcements={data.announcements}
        unreadCount={data.unreadCount}
        autoNotices={data.autoNotices}
        todos={data.todos}
      />

      <section className="grid gap-4 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,2fr)_minmax(0,0.95fr)]">
        <BudgetCard
          actual={data.actualSales}
          openSales={data.openSales}
          budget={data.dailyBudget}
          pct={data.achievementPct}
          ringPct={data.ringPct}
          asOf={asOf}
        />
        <ClockCard
          place={
            <Suspense fallback={<span className="opacity-60">&nbsp;</span>}>
              <StorePlace address={data.address} />
            </Suspense>
          }
          weather={
            <Suspense fallback={null}>
              <StoreWeatherInfo address={data.address} />
            </Suspense>
          }
        />
      </section>

      <HomeKpis
        groups={data.groups}
        groupsYesterday={data.groupsYesterday}
        guests={data.guests}
        guestsYesterday={data.guestsYesterday}
        avgSpend={data.avgSpend}
        repeat={data.repeat}
        lowStock={data.lowStock}
        guestsNote={guestsNote}
        ordersHref={ordersHref}
      />
    </div>
  );
}
