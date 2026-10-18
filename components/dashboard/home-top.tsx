/**
 * ホーム上段（プロトタイプ 01-home の配置）:
 * お知らせ&アラート → [予算達成率(2/3) | 時計(1/3)] → KPI（1つの箱を4つに区切る。客単価は予算達成率の売上の下）
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
        alerts={data.alerts}
        alertCount={data.alertCount}
        autoNotices={data.autoNotices}
        todos={data.todos}
      />

      {/* 予算達成率と時計は1つの箱（2026-10-18 Ronnie「1つの箱にしたほうがいい」）。間は線で区切る */}
      <section className="ui-card grid divide-line overflow-hidden border border-line bg-white max-md:divide-y md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] md:divide-x xl:grid-cols-[minmax(0,2fr)_minmax(0,0.95fr)]">
        <BudgetCard
          actual={data.actualSales}
          openSales={data.openSales}
          budget={data.dailyBudget}
          pct={data.achievementPct}
          ringPct={data.ringPct}
          perGroup={data.perGroupSales}
          avgSpend={data.avgSpend}
          asOf={asOf}
          className="rounded-none border-0 shadow-none"
        />
        <ClockCard
          className="rounded-none border-0 shadow-none"
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
        repeat={data.repeat}
        lowStock={data.lowStock}
        guestsNote={guestsNote}
        ordersHref={ordersHref}
      />
    </div>
  );
}
