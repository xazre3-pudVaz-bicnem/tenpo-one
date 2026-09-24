import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { requireHandyClerk } from '@/lib/handy-session';
import { HandyBackButton, HandyMain, HandyTopBar } from '@/components/handy/handy-chrome';
import { HandyOrderScreen } from '@/components/handy/handy-order-screen';
import {
  buildHandyTabs,
  initialHandyTab,
  type HandyCategoryInput,
  type HandyMenuItemInput,
} from '@/components/handy/logic';
import type { PosOptionGroup } from '@/components/pos/option-dialog';
import { submitHandyOrder } from '@/app/app/handy/actions';
import { filterMenuBook, planCategoryIds } from '@/lib/menu-book';
import { englishName } from '@/lib/romaji';
import { jstNowHm, loadMenuBook, loadOrderPlanState } from '@/lib/menu-book-server';

export const metadata: Metadata = { title: '注文' };

function problem(tableId: string, message: string) {
  return (
    <>
      <HandyTopBar
        left={<HandyBackButton href={`/handy/${tableId}`} label="卓へ戻る" />}
        title="注文"
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

  const [{ data: categories }, { data: menuItems }, { data: optionLinks }, menuBook, plan] = await Promise.all([
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
        'id, category_id, name, name_en, name_kana, price, item_type, is_sold_out, sort_order, sell_start_time, sell_end_time, image_path'
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
    // メニューブック（店長が決めたカテゴリの出し方）と、この伝票に入っているプラン（飲み放題など）
    loadMenuBook(supabase, store.id),
    loadOrderPlanState(supabase, order.id),
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
      isRequired: g.is_required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      items,
    });
  }

  const categoryInputs: HandyCategoryInput[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: englishName(c.name, null, c.name_en),
    station: c.station,
    sortOrder: c.sort_order,
  }));
  const itemInputs: HandyMenuItemInput[] = (menuItems ?? []).map((m) => ({
    id: m.id,
    categoryId: m.category_id,
    name: m.name,
    // 英語名が入っていない商品はカナからローマ字を作る（レジ画面と同じ englishName）
    nameEn: englishName(m.name, m.name_kana, m.name_en),
    price: m.price,
    itemType: m.item_type,
    isSoldOut: m.is_sold_out,
    sortOrder: m.sort_order,
    sellStartTime: m.sell_start_time,
    sellEndTime: m.sell_end_time,
    imagePath: m.image_path,
    hasOptions: !!optionGroupsByItem[m.id],
  }));

  // ハンディに出すカテゴリだけに絞る（アラカルトの伝票には飲み放題の F などを出さない。レジは今まで通り全部出す）
  const nowHm = jstNowHm();
  const visible = filterMenuBook(categoryInputs, itemInputs, menuBook, { channel: 'handy', plan, nowHm });
  // 上のタブ（1 単品／2 コース・飲み放題／3 サービス）→ メニューブックのページ。ページの区切りは出さないカテゴリも
  // 含めた並び順で決める（時間帯・卓によって区切りが変わらないように）
  const planIds = planCategoryIds(categoryInputs, itemInputs, menuBook);
  const tabs = buildHandyTabs(categoryInputs, visible.items, nowHm, { planCategoryIds: planIds, pages: menuBook });
  const initialTabId = initialHandyTab(tabs, planIds, plan.hasPlan);
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
