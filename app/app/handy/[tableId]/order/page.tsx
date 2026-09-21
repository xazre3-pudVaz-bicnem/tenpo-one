import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { HandyOrderScreen } from '@/components/handy/handy-order-screen';
import { buildMenuGroups, type HandyCategoryInput, type HandyMenuItemInput } from '@/components/handy/logic';
import type { PosOptionGroup } from '@/components/pos/option-dialog';
import { submitHandyOrder } from '../../actions';

export const metadata: Metadata = { title: '注文' };

/** JSTの 'HH:MM'（販売時間帯の判定用。描画中ではなくリクエスト時に1回だけ求める） */
function nowHmJst(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
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
    return (
      <div>
        <PageHeader title="注文" en="Order" />
        <EmptyState title="この画面は利用できません" description="店舗の割り当てと注文権限を確認してください" />
      </div>
    );
  }

  const backLink = (
    <Link href={`/app/handy/${tableId}`} className="text-sm font-medium text-primary hover:underline">
      卓の画面へ戻る
    </Link>
  );

  if (!orderId) {
    return (
      <div>
        <PageHeader title="注文" en="Order" />
        <EmptyState title="伝票が指定されていません" description="卓の画面から「注文を追加」で開いてください" action={backLink} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_no, status, store_id, table_id, guest_count, total, restaurant_tables(name)')
    .eq('id', orderId)
    .maybeSingle();

  if (!order || order.store_id !== store.id || order.table_id !== tableId || order.status !== 'open') {
    return (
      <div>
        <PageHeader title="注文" en="Order" />
        <EmptyState
          title="この伝票には注文できません"
          description="伝票が見つからないか、既に会計済み・取消済みです"
          action={backLink}
        />
      </div>
    );
  }

  const [{ data: categories }, { data: menuItems }, { data: optionLinks }] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, name_en, station, sort_order')
      .eq('organization_id', ctx.organizationId)
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .eq('status', 'active')
      .order('sort_order'),
    // POSと違い item_type='option'（サービス・追加オプション）も出す（承認済みUIの⑥サービス）
    supabase
      .from('menu_items')
      .select(
        'id, category_id, name, name_en, price, item_type, is_sold_out, sort_order, sell_start_time, sell_end_time, image_path'
      )
      .eq('organization_id', ctx.organizationId)
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .eq('status', 'active')
      .order('sort_order'),
    // menu_option_groups に name_en 列は無い（選択肢の英語名は menu_option_items のみ）。
    // ここに存在しない列を入れるとクエリが失敗し、選択肢ダイアログが黙って出なくなる。
    supabase
      .from('menu_item_option_groups')
      .select(
        'menu_item_id, sort_order, menu_option_groups!inner(id, name, is_required, min_select, max_select, status, menu_option_items(id, name, name_en, price, sort_order, status))'
      )
      .eq('store_id', store.id)
      .eq('menu_option_groups.status', 'active')
      .order('sort_order'),
  ]);

  // 商品ごとの選択肢グループ（POS画面と同じ構造・同じダイアログを使う）
  const optionGroupsByItem: Record<string, PosOptionGroup[]> = {};
  for (const link of optionLinks ?? []) {
    const g = link.menu_option_groups as unknown as {
      id: string;
      name: string;
      is_required: boolean;
      min_select: number;
      max_select: number;
      menu_option_items: {
        id: string;
        name: string;
        name_en: string | null;
        price: number;
        sort_order: number;
        status: string;
      }[];
    } | null;
    if (!g) continue;
    const items = (g.menu_option_items ?? [])
      .filter((o) => o.status === 'active')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({ id: o.id, name: o.name, nameEn: o.name_en, price: o.price }));
    if (items.length === 0) continue;
    (optionGroupsByItem[link.menu_item_id] ??= []).push({
      id: g.id,
      name: g.name,
      nameEn: null,
      isRequired: g.is_required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      items,
    });
  }

  const categoryInputs: HandyCategoryInput[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: c.name_en,
    station: c.station,
    sortOrder: c.sort_order,
  }));
  const itemInputs: HandyMenuItemInput[] = (menuItems ?? []).map((m) => ({
    id: m.id,
    categoryId: m.category_id,
    name: m.name,
    nameEn: m.name_en,
    price: m.price,
    itemType: m.item_type,
    isSoldOut: m.is_sold_out,
    sortOrder: m.sort_order,
    sellStartTime: m.sell_start_time,
    sellEndTime: m.sell_end_time,
    imagePath: m.image_path,
    hasOptions: !!optionGroupsByItem[m.id],
  }));

  const groups = buildMenuGroups(categoryInputs, itemInputs, nowHmJst());
  const tableName = (order.restaurant_tables as unknown as { name: string } | null)?.name ?? '—';

  return (
    <HandyOrderScreen
      tableId={tableId}
      tableName={tableName}
      orderId={order.id}
      orderNo={order.order_no}
      guestCount={order.guest_count}
      unpaidTotal={Number(order.total ?? 0)}
      groups={groups}
      optionGroupsByItem={optionGroupsByItem}
      submitAction={submitHandyOrder}
    />
  );
}
