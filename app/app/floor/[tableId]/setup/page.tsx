import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { formatTime } from '@/lib/format';
import { HandySetupScreen } from '@/components/handy/handy-setup-screen';
import { visitSourcesFrom } from '@/lib/handy-visit';
import { tableState } from '@/components/handy/logic';
import { startHandyVisit } from '@/app/app/handy/actions';
import { loadSetupPlanItems } from '@/app/app/handy/setup-data';

export const metadata: Metadata = { title: 'お客様情報 | オーダー・会計' };

/** 描画の基準時刻（リクエスト時点） */
function requestTime() {
  return Date.now();
}

/**
 * レジ（オーダー・会計）のファーストオーダー: 空席の卓に着席するときの「お客様情報」。
 * ハンディと同じ画面（モード・プラン・時間制・終了前注意・開始時間・男女の人数・利用シーン）を iPad でも出す
 * （2026-09-22 店舗要望 FULL MOoN 御茶ノ水）。確定するとレジの伝票画面へ進む。
 */
export default async function FloorSetupPage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  const shell = (children: React.ReactNode) => (
    <div className="theme-regi mx-auto flex h-[calc(100dvh-7rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e3dbf1] bg-[#f6f3fb] text-[#2a2138]">
      {children}
    </div>
  );
  const problem = (message: string) =>
    shell(
      <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#7a7090]">
        {message}
        <br />
        <Link href="/app/floor" className="font-bold text-[#7b3fe4] underline">
          テーブル一覧へ戻る
        </Link>
      </p>
    );

  if (!store || !can(ctx.role, 'pos.order') || !can(ctx.role, 'tables.operate')) {
    return problem('この画面は利用できません。店舗の割り当てと注文権限を確認してください。');
  }

  const supabase = await createClient();
  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, name, current_status, store_id')
    .eq('id', tableId)
    .eq('status', 'active')
    .maybeSingle();
  if (!table || table.store_id !== store.id) {
    return problem('このテーブルは存在しないか、現在の店舗からアクセスできません。');
  }

  const { data: openOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('table_id', tableId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // 既に着席中なら入力させず、その伝票へ
  if (openOrder) redirect(`/app/pos?order=${openOrder.id}`);
  const state = tableState(table.current_status, false);
  // 清掃中（整理中）でも着席できる（会計が終わった卓へすぐ次のお客様を通すため。2026-09-24 店舗要望）
  if (state !== 'available' && state !== 'cleaning') {
    return problem(
      `この卓は現在「${state === 'blocked' ? '使用不可' : '予約あり'}」のため着席できません。テーブル一覧で状態を変更してください。`
    );
  }

  const planItems = await loadSetupPlanItems(ctx.organizationId, store.id);
  // この店で使う来店経路（設定 > レジ で選ぶ。2026-09-24 店舗要望）
  const { data: storeSettings } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', store.id)
    .maybeSingle();
  const visitSources = visitSourcesFrom(storeSettings?.settings ?? null);

  return shell(
    <HandySetupScreen
      from="pos"
      tableId={table.id}
      tableName={table.name}
      planItems={planItems}
      startLabel={formatTime(new Date(requestTime()))}
      sources={visitSources}
      confirmAction={startHandyVisit}
    />
  );
}
