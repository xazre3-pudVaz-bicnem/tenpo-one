/**
 * レジ（iPad）では「お知らせ&アラート」をホームから外し、仕入・経費 の画面のいちばん上に出す
 * （2026-10-19 Ronnie の新しいレイアウト。ホームの 仕入・経費 には赤い件数だけ）。
 * 取得はホームと同じ loadHomeData。<Suspense> で包んで、経費の一覧の表示を待たせない。
 */
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import type { requireMember } from '@/lib/auth';
import { loadHomeData } from './home-data';
import { HomeNotices } from './home-notices';

type Ctx = Awaited<ReturnType<typeof requireMember>>;

export async function RegiNotices({ ctx }: { ctx: Ctx }) {
  const store = ctx.currentStore;
  if (!store) return null;
  const supabase = await createClient();
  const data = await loadHomeData({
    supabase,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    role: ctx.role,
    accountingEnabled: !ctx.disabledFeatures.has('accounting'),
    stores: [store],
    isAllStores: false,
    today: todayJst(),
    metricsOpts: {},
  });
  const empty =
    data.announcements.length === 0 && data.alerts.length === 0 && data.autoNotices.length === 0 && data.todos.length === 0;
  if (empty) return null;
  return (
    <div className="mb-4">
      <HomeNotices
        announcements={data.announcements}
        unreadCount={data.unreadCount}
        alerts={data.alerts}
        alertCount={data.alertCount}
        autoNotices={data.autoNotices}
        todos={data.todos}
      />
    </div>
  );
}
