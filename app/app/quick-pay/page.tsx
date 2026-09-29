import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { loadHandyMenu } from '@/lib/handy-menu-server';
import { QUICK_PAY_LINE_NAME } from '@/lib/quick-pay';
import { submitHandyOrder } from '@/app/app/handy/actions';
import { QuickPayScreen, type QuickPayOrderedLine } from '@/components/pos/quick-pay-screen';
import { startQuickOrder, prepareQuickCheckout } from './actions';
import { enqueueDrawerKick } from '@/app/app/pos/print-actions';

export const metadata: Metadata = { title: '即会計' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 即会計（左メニュー 店舗台帳 の下）。電卓のように金額を入れて、そのままいつもの会計へ。
 * 右上の「メニュー選択」でハンディと同じメニューから商品を入れて注文（厨房へ送信）もできる。
 * 2026-09-30 Ronnie「手書き伝票の合計だけで会計するお店のため。ほかの会計の仕組みは同じ」。
 */
export default async function QuickPayPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order: orderParam } = await searchParams;
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.checkout')) {
    return (
      <div>
        <PageHeader title="即会計" en="Quick pay" />
        <EmptyState
          title={store ? '会計する権限がありません' : '対象の店舗がありません'}
          description={store ? '店長・管理者に権限の付与を依頼してください' : '店舗を選択してください'}
        />
      </div>
    );
  }

  const supabase = await createClient();

  // 「メニュー選択」で作った即会計の伝票（開いているものだけ）
  let order: { id: string; orderNo: number; guestCount: number; lines: QuickPayOrderedLine[] } | null = null;
  if (orderParam && UUID.test(orderParam)) {
    const { data } = await supabase
      .from('orders')
      .select('id, order_no, status, store_id, table_id, guest_count, memo')
      .eq('id', orderParam)
      .maybeSingle();
    if (data && data.status === 'open' && data.store_id === store.id && !data.table_id) {
      const { data: items } = await supabase
        .from('order_items')
        .select('id, name, quantity, line_total, menu_item_id')
        .eq('order_id', data.id)
        .eq('status', 'active')
        .order('created_at');
      order = {
        id: data.id,
        orderNo: data.order_no,
        guestCount: data.guest_count ?? 1,
        lines: (items ?? []).map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          lineTotal: Number(i.line_total) || 0,
          isAmount: !i.menu_item_id,
        })),
      };
    }
  }

  const menu = await loadHandyMenu(supabase, ctx.organizationId, store.id, order?.id ?? null);

  return (
    <QuickPayScreen
      storeId={store.id}
      staffName={ctx.displayName}
      lineName={QUICK_PAY_LINE_NAME}
      order={order}
      menu={menu}
      startOrderAction={startQuickOrder}
      prepareCheckoutAction={prepareQuickCheckout}
      submitMenuAction={submitHandyOrder}
      drawerAction={enqueueDrawerKick}
    />
  );
}
