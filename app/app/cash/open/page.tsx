import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { RegisterOpenCard } from '@/components/cash/register-open-card';
import { cleanRegisterName, pickMainRegister } from '@/lib/register-name';
import { openPageRedirect } from '@/lib/register-open-gate';
import { loadExpectedOpening, loadStoreDay } from '@/lib/register-day-server';
import { mdLabel, registerDayFlowActive } from '@/lib/register-day';

export const metadata: Metadata = { title: 'レジ開局' };

/**
 * 朝いちばんの開局画面（2026-09-28 Ronnie「翌日レジを開けるとき、レジの中のお金を数えて合計を入れる画面をログイン後に出す」）。
 * レジ端末はログイン直後のホームからここへ送られる（app/app/dashboard/page.tsx）。
 * ここで入れた合計が釣銭準備金＝レジオープン時現金になり、レジ精算の現金の計算に使う。
 */
export default async function RegisterOpenPage() {
  const ctx = await requireFeature('accounting');
  const store = ctx.currentStore ?? ctx.stores[0] ?? null;
  if (!store) {
    return (
      <div>
        <PageHeader title="レジ開局" en="Open register" />
        <EmptyState title="所属店舗がありません" description="レジ操作には店舗への割当が必要です。管理者に確認してください。" />
      </div>
    );
  }
  const supabase = await createClient();
  const [{ data: registers }, { count: openCount }, lastCloseRaw, storeDay] = await Promise.all([
    supabase.from('registers').select('id, name, created_at').eq('store_id', store.id).eq('status', 'active').order('created_at'),
    supabase.from('register_sessions').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'open'),
    // 前回のレジクローズで残した金額（翌準備金）と比べる（2026-09-28 Ronnie）
    loadExpectedOpening(supabase, store.id),
    loadStoreDay(supabase, store.id),
  ]);
  // 比べるのは REGISTER_DAY_FLOW_FROM（9/29）から（それまでは今まで通り）
  const lastClose = registerDayFlowActive(storeDay.clock) ? lastCloseRaw : { ...lastCloseRaw, expected: null };
  const to = openPageRedirect({ hasOpenSession: (openCount ?? 0) > 0 });
  if (to) redirect(to);

  const main = pickMainRegister((registers ?? []).map((r) => ({ id: r.id as string, name: r.name as string, createdAt: r.created_at as string | null })));
  const canOperate = can(ctx.role, 'register.operate');

  return (
    <div>
      <PageHeader
        title="レジ開局"
        en="Open register"
        description="レジの中の現金を数えて、金種ごとに枚数を入れてください。合計が今日の釣銭準備金（レジオープン時現金）になり、レジ精算の現金の計算はここから始まります ／ Count the cash in the drawer to open the register"
      />
      {!main ? (
        <EmptyState title="レジがまだ登録されていません" description="設定 > デバイス管理 でレジ（レシートプリンター）を登録すると、ここで開局できます。" />
      ) : !canOperate ? (
        <EmptyState title="レジを開局する権限がありません" description="レジ担当（register.operate）の権限が必要です。店長に開局してもらってください。" />
      ) : (
        <div className="space-y-3">
          {lastClose.expected != null && (
            <p className="max-w-md rounded-xl border border-line bg-white px-4 py-3 text-[13px] text-ink-2">
              前回のレジクローズ{lastClose.businessDate ? `（${mdLabel(lastClose.businessDate)}）` : ''}で残した金額は{' '}
              <b className="text-[15px] tabular-nums text-ink">¥{lastClose.expected.toLocaleString('ja-JP')}</b> です。
              数えた金額と違うときは、違う理由を入れてから開局します。
            </p>
          )}
          <RegisterOpenCard
            storeId={store.id}
            registerId={main.id}
            registerName={cleanRegisterName(main.name)}
            afterOpenHref="/app/floor"
            expectedOpening={lastClose.expected}
            expectedFrom={lastClose.businessDate}
          />
        </div>
      )}
    </div>
  );
}
