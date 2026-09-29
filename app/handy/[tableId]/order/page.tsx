import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { requireHandyClerk } from '@/lib/handy-session';
import { HandyBackButton, HandyMain, HandyTopBar } from '@/components/handy/handy-chrome';
import { HandyOrderScreen } from '@/components/handy/handy-order-screen';
import { submitHandyOrder } from '@/app/app/handy/actions';
import { loadHandyMenu } from '@/lib/handy-menu-server';

export const metadata: Metadata = { title: '注文' };

function problem(tableId: string, message: string) {
  return (
    <>
      <HandyTopBar
        left={<HandyBackButton href={`/handy/${tableId}`} label="卓へ戻る" />}
        title="注文"
      />
      <HandyMain>
        <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#7a7090]">
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

export default async function HandyOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  const { tableId } = await params;
  const { order: orderId } = await searchParams;
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.order')) {
    return problem(tableId, 'この画面は利用できません。店舗の割り当てと注文権限を確認してください。');
  }
  if (!orderId) {
    return problem(tableId, '伝票が指定されていません。卓の画面から開いてください。');
  }
  const clerk = await requireHandyClerk();

  const supabase = await createClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_no, status, store_id, table_id, guest_count, total, restaurant_tables(name)')
    .eq('id', orderId)
    .maybeSingle();

  if (!order || order.store_id !== store.id || order.table_id !== tableId || order.status !== 'open') {
    return problem(tableId, 'この伝票には注文できません。既に会計済み・取消済みの可能性があります。');
  }

  const { tabs, initialTabId, optionGroupsByItem } = await loadHandyMenu(supabase, ctx.organizationId, store.id, order.id);
  const tableName = (order.restaurant_tables as unknown as { name: string } | null)?.name ?? '—';

  return (
    <HandyOrderScreen
      tableId={tableId}
      tableName={tableName}
      staffName={clerk.name}
      orderId={order.id}
      orderNo={order.order_no}
      guestCount={order.guest_count}
      unpaidTotal={Number(order.total ?? 0)}
      tabs={tabs}
      initialTabId={initialTabId}
      optionGroupsByItem={optionGroupsByItem}
      submitAction={submitHandyOrder}
    />
  );
}
