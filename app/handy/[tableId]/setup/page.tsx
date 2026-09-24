import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { formatTime } from '@/lib/format';
import { requireHandyClerk } from '@/lib/handy-session';
import { HandyBackButton, HandyMain, HandyTopBar } from '@/components/handy/handy-chrome';
import { HandySetupScreen } from '@/components/handy/handy-setup-screen';
import { visitSourcesFrom } from '@/lib/handy-visit';
import { tableState } from '@/components/handy/logic';
import { startHandyVisit } from '@/app/app/handy/actions';
import { loadSetupPlanItems } from '@/app/app/handy/setup-data';

export const metadata: Metadata = { title: 'お客様情報' };

/** 描画の基準時刻（リクエスト時点） */
function requestTime() {
  return Date.now();
}

function problem(tableId: string, message: string) {
  return (
    <>
      <HandyTopBar
        left={<HandyBackButton href={`/handy/${tableId}`} label="卓へ戻る" />}
        title="お客様情報"
      />
      <HandyMain>
        <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#8a769d]">
          {message}
          <br />
          <Link href={`/handy/${tableId}`} className="font-bold text-[#7b3fe4] underline">
            卓の画面へ戻る
          </Link>
        </p>
      </HandyMain>
    </>
  );
}

/**
 * お客様情報（空席の卓の来店登録）。
 * 卓が既に着席中（未会計の伝票がある）なら入力させず、卓の画面へ戻す。
 */
export default async function HandySetupPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.order')) {
    return problem(tableId, 'この画面は利用できません。店舗の割り当てと注文権限を確認してください。');
  }
  const clerk = await requireHandyClerk();

  const supabase = await createClient();
  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, name, current_status, store_id')
    .eq('id', tableId)
    .eq('status', 'active')
    .maybeSingle();
  if (!table || table.store_id !== store.id) {
    return problem(tableId, 'このテーブルは存在しないか、現在の店舗からアクセスできません。');
  }

  const { count: openCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('table_id', tableId)
    .eq('status', 'open');
  const state = tableState(table.current_status, (openCount ?? 0) > 0);
  if (state === 'occupied') redirect(`/handy/${tableId}`);
  // 清掃中（整理中）でも着席できる（会計が終わった卓へすぐ次のお客様を通すため。2026-09-24 店舗要望）
  if (state !== 'available' && state !== 'cleaning') {
    return problem(
      tableId,
      `この卓は現在「${state === 'blocked' ? '使用不可' : '予約あり'}」のため、ハンディからは着席できません。フロア画面で状態を変更してください。`
    );
  }

  // プラン商品（コース・飲み放題など）
  const planItems = await loadSetupPlanItems(ctx.organizationId, store.id);

  // この店で使う来店経路（設定 > レジ で選ぶ。2026-09-24 店舗要望）
  const { data: storeSettings } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', store.id)
    .maybeSingle();
  const visitSources = visitSourcesFrom(storeSettings?.settings ?? null);

  return (
    <HandySetupScreen
      tableId={table.id}
      tableName={table.name}
      staffName={clerk.name}
      planItems={planItems}
      startLabel={formatTime(new Date(requestTime()))}
      sources={visitSources}
      confirmAction={startHandyVisit}
    />
  );
}
