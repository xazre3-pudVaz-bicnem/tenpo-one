import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { isSteraOnline, STERA_PAYMENT_TYPES } from '@/lib/stera';
import { loadMenuBook } from '@/lib/menu-book-server';
import { loadMenuStock } from '@/lib/menu-stock-server';
import { isMenuSoldOut } from '@/lib/menu-stock';
import { filterTakeoutItems, isTakeoutLikeOrder, takeoutMenuFrom } from '@/lib/takeout-menu';
import { isQuickPayOrder, QUICK_PAY_ORDER_LABEL } from '@/lib/quick-pay';
import { groupMenuPages, picksSlot } from '@/lib/menu-book';
import { englishName } from '@/lib/romaji';
import { BRANDED_METHODS, checkoutPresetsFrom, discountPresetsOf, methodBrandsOf, pointBrandsOf } from '@/lib/checkout-presets';
import { VISIT_SOURCES, visitSourceByLabel, visitSourcesFrom } from '@/lib/handy-visit';
import { isMissingColumnError } from '@/lib/schema-compat';
import {
  type NativePosCatalog,
  type NativePosLive,
  jstHm,
  nativePosPages,
  optionGroupsFrom,
  type NativePosCategory,
  type NativePosItem,
  type NativePosLine,
  type NativePosOrder,
  type NativePosPayload,
} from '@/lib/native-pos';

/**
 * iPad アプリのネイティブ画面（オーダー・会計）に渡すデータ。Web のレジ（app/app/pos/page.tsx）と同じものを、
 * 同じ決まり（メニューブックのページ・売り切れ・テイクアウトのメニュー・担当者・会計の選択肢）で読む。
 * Web のページは変えない（こちらは読むだけの別の入口）。
 */

type Client = Awaited<ReturnType<typeof createClient>>;

const ORDER_COLUMNS =
  'id, order_no, order_type, status, guest_count, discount_total, discount_reason, customer_id, subtotal, tax_total, service_charge, total, store_id, table_id, clerk_id, opened_at, memo, restaurant_tables(name), customers(name), reservations(start_at, end_at, purpose, source_id, reservation_sources(code))';

/** 伝票の明細（未送信も送信済みも。取消は出さない） */
async function loadLines(supabase: Client, orderId: string): Promise<NativePosLine[]> {
  const cols = 'id, menu_item_id, name, unit_price, quantity, line_total, status, modifiers';
  const first = await supabase.from('order_items').select(`${cols}, kitchen_sent_at`).eq('order_id', orderId).eq('status', 'active').order('created_at');
  let rows = first.data as Record<string, unknown>[] | null;
  if (first.error && isMissingColumnError(first.error.message, 'kitchen_sent_at')) {
    rows = ((await supabase.from('order_items').select(cols).eq('order_id', orderId).eq('status', 'active').order('created_at')).data ?? []).map(
      (r) => ({ ...(r as Record<string, unknown>), kitchen_sent_at: 'legacy' })
    );
  } else if (first.error) {
    throw new Error('注文内容の読み込みに失敗しました');
  }
  return (rows ?? []).map((r) => ({
    id: r.id as string,
    menuItemId: (r.menu_item_id as string | null) ?? null,
    name: r.name as string,
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    lineTotal: Number(r.line_total),
    sent: r.kitchen_sent_at != null,
    ...optionNames(r.modifiers),
  }));
}

/** 明細の modifiers（[{ name, name_en?, ... }]）から選択肢の名前（日本語・英語。英語が無ければ日本語） */
function optionNames(raw: unknown): { options: string[]; optionsEn: string[] } {
  const list = (Array.isArray(raw) ? raw : [])
    .map((m) => (m && typeof m === 'object' ? (m as { name?: unknown; name_en?: unknown }) : null))
    .filter((m): m is { name: string; name_en?: unknown } => !!m && typeof m.name === 'string' && m.name.trim() !== '');
  return {
    options: list.map((m) => m.name),
    optionsEn: list.map((m) => englishName(m.name, null, typeof m.name_en === 'string' ? m.name_en : null) ?? m.name),
  };
}

/** 伝票の来店経路（予約の経路 → VISIT_SOURCES の id。経路の行が無い店は予約の目的に名前が残っている） */
function visitSourceIdOf(resv: { purpose: string | null; reservation_sources: { code: string } | { code: string }[] | null } | null): string | null {
  if (!resv) return null;
  const src = Array.isArray(resv.reservation_sources) ? resv.reservation_sources[0] : resv.reservation_sources;
  if (src?.code) {
    const hit = VISIT_SOURCES.find((s) => (s.codes as readonly string[]).includes(src.code));
    if (hit) return hit.id;
  }
  if (resv.purpose) return visitSourceByLabel(resv.purpose)?.id ?? null;
  return null;
}

/** 伝票の部分だけ（操作のあとアプリに返す） */
export async function loadNativeOrder(supabase: Client, ctx: SessionContext, orderId: string): Promise<NativePosOrder | null> {
  const { data: order } = await supabase.from('orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle();
  if (!order) return null;
  const allowed = ctx.isHq || ctx.stores.some((s) => s.id === order.store_id);
  if (!allowed) return null;
  const table = order.restaurant_tables as unknown as { name: string } | null;
  const customer = order.customers as unknown as { name: string } | null;
  const resvRaw = order.reservations as unknown;
  const resv = (Array.isArray(resvRaw) ? resvRaw[0] : resvRaw) as {
    start_at: string | null;
    end_at: string | null;
    purpose: string | null;
    reservation_sources: { code: string } | { code: string }[] | null;
  } | null;
  return {
    id: order.id as string,
    orderNo: Number(order.order_no),
    orderType: order.order_type as string,
    tableName:
      table?.name ??
      (isQuickPayOrder({ table_id: order.table_id as string | null, order_type: order.order_type as string, memo: order.memo as string | null })
        ? QUICK_PAY_ORDER_LABEL
        : null),
    guestCount: Number(order.guest_count),
    clerkId: (order.clerk_id as string | null) ?? null,
    customerName: customer?.name ?? null,
    seatFrom: order.table_id ? jstHm(order.opened_at as string) : null,
    seatTo: order.table_id ? jstHm(resv?.end_at) : null,
    visitSourceId: visitSourceIdOf(resv),
    subtotal: Number(order.subtotal),
    taxTotal: Number(order.tax_total),
    serviceCharge: Number(order.service_charge),
    discountTotal: Number(order.discount_total),
    discountReason: (order.discount_reason as string | null) ?? null,
    total: Number(order.total),
    lines: await loadLines(supabase, orderId),
  };
}

export type NativeLoadResult =
  | NativePosPayload
  | { ok: false; status: number; error: string; /** Web の画面で開いてもらう（端末の登録・回線の制限など） */ useWeb?: boolean };

/** 中身のハッシュ（JSON を安定した並びで） */
function versionOf(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
        : v;
  return createHash('sha1').update(JSON.stringify(stable(value))).digest('hex').slice(0, 16);
}

/**
 * 店のメニューまわり（伝票に寄らない部分）。アプリが iPad に保存して、次からはそれを先に出す。
 * takeout のときは テイクアウトメニュー・テイクアウト価格（保存はしない。開くたびに読む）
 */
export async function loadNativeCatalog(
  ctx: SessionContext,
  supabase: Client,
  storeId: string,
  organizationId: string,
  opts: { takeout?: boolean } = {}
): Promise<NativePosCatalog> {
  const store = ctx.stores.find((s) => s.id === storeId) ?? null;
  const takeout = !!opts.takeout;
  const [menuBook, { data: settingsRow }, { data: categories }, { data: menuItems }, { data: recentSales }, { data: clerks }, { data: optionLinks }, stock] =
    await Promise.all([
      loadMenuBook(supabase, storeId),
      supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle(),
      supabase
        .from('menu_categories')
        .select('id, name, name_en, sort_order, station')
        .eq('organization_id', organizationId)
        .or(`store_id.is.null,store_id.eq.${storeId}`)
        .eq('status', 'active')
        .order('sort_order'),
      supabase
        .from('menu_items')
        .select('id, category_id, name, name_en, name_kana, price, takeout_price, is_sold_out, is_recommended, sort_order')
        .eq('organization_id', organizationId)
        .or(`store_id.is.null,store_id.eq.${storeId}`)
        .eq('status', 'active')
        .neq('item_type', 'option')
        .order('sort_order'),
      supabase.rpc('get_best_sellers', { p_store: storeId, p_days: 30, p_limit: 12 }),
      supabase.from('pos_clerks').select('id, name').eq('store_id', storeId).eq('status', 'active').order('sort_order').order('name'),
      // Web のレジ（app/app/pos/page.tsx）と同じ取り方。グループに name_en は無い（付けるとクエリごと失敗する）
      supabase
        .from('menu_item_option_groups')
        .select(
          'menu_item_id, sort_order, menu_option_groups!inner(id, name, is_required, min_select, max_select, sort_order, status, menu_option_items(id, name, name_en, price, sort_order, status))'
        )
        .eq('store_id', storeId)
        .eq('menu_option_groups.status', 'active')
        .order('sort_order'),
      // 売り切れ（本日の食数が0になったものも）
      loadMenuStock(supabase, storeId),
    ]);
  const settings = (settingsRow as { settings?: unknown } | null)?.settings ?? null;

  // 商品ごとの選択肢グループ（有効な選択肢が1つでもあるグループだけ。Web のレジと同じ）
  const optionGroups = optionGroupsFrom(optionLinks ?? []);
  const withOptions = new Set(Object.keys(optionGroups));

  type Row = {
    id: string; category_id: string | null; name: string; name_en: string | null; name_kana: string | null;
    price: number; takeout_price: number | null; is_sold_out: boolean | null; is_recommended: boolean | null;
  };
  let rows = (menuItems ?? []) as Row[];
  if (takeout) rows = filterTakeoutItems(rows, takeoutMenuFrom(settings));
  const bestRank = new Map(((recentSales ?? []) as { menu_item_id: string }[]).map((r, i) => [r.menu_item_id, i]));
  const items: NativePosItem[] = rows.map((m) => {
    const price = Number(takeout ? (m.takeout_price ?? m.price) : m.price);
    return {
      id: m.id,
      categoryId: m.category_id,
      name: m.name,
      kana: m.name_kana,
      english: englishName(m.name, m.name_kana, m.name_en),
      price,
      soldOut: isMenuSoldOut(!!m.is_sold_out, stock.get(m.id)),
      recommended: !!m.is_recommended,
      bestRank: bestRank.get(m.id) ?? null,
      hasOptions: withOptions.has(m.id),
      openPrice: price === 0,
    };
  });

  // 中央のカテゴリの並び（Web のレジの buildPosPages と同じ：メニューブックのページ順、おすすめ・売れ筋は店の決めた位置）
  type Cat = { id: string; name: string; name_en: string | null; station: string | null };
  const cats = (categories ?? []) as Cat[];
  const zeroOnly = new Map<string, boolean>();
  for (const m of rows) {
    if (!m.category_id) continue;
    zeroOnly.set(m.category_id, (zeroOnly.get(m.category_id) ?? true) && Number(m.price) === 0);
  }
  const book = { pages: menuBook.pages ?? [], categoryPage: menuBook.categoryPage ?? {} };
  const grouped = groupMenuPages(
    cats.map((c) => ({ ...c, allZeroPrice: zeroOnly.get(c.id) ?? false })),
    book
  ).filter((pg) => pg.categories.length > 0);
  const fromPages = nativePosPages(grouped, picksSlot(book, grouped.map((pg) => pg.key)));
  const nativeCategories: NativePosCategory[] = takeout ? [{ id: '__takeout__', name: 'テイクアウト', sub: 'Takeout' }] : fromPages.categories;
  const nativePages = takeout ? [] : fromPages.pages;

  // 会計の選択肢（設定 > 決済・端末）
  const presets = checkoutPresetsFrom(settings);
  const methodBrands = Object.fromEntries(BRANDED_METHODS.map((m) => [m, methodBrandsOf(presets, m).map((b) => ({ id: b.key, name: b.name }))]));
  const clerkList = (clerks ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));

  const body = {
    store: { id: storeId, name: store?.name ?? '' },
    categories: nativeCategories,
    pages: nativePages,
    items,
    optionGroups: Object.fromEntries(Object.entries(optionGroups).filter(([id]) => withOptions.has(id) && items.some((i) => i.id === id))),
    clerks: clerkList,
    clerkRequired: clerkList.length > 0,
    visitSources: visitSourcesFrom(settings).map((s) => ({ id: s.id, label: s.label })),
    methodBrands,
    pointBrands: pointBrandsOf(presets).map((b) => ({ id: b.key, name: b.name })),
    discountPresets: discountPresetsOf(presets).map((d) => ({ id: d.key, name: d.name, kind: d.kind, value: d.value })),
    steraPaymentTypes: STERA_PAYMENT_TYPES.map((t) => ({ code: t.code, method: t.method, label: t.label, en: t.en })),
    canCheckout: can(ctx.role, 'pos.checkout'),
    canDiscount: can(ctx.role, 'pos.discount'),
  };
  return { ...body, version: versionOf(body) };
}

/** 伝票を開く・読み直すときの軽い部分（伝票・レジの開局・stera の端末）。メニューは別（loadNativeCatalog） */
export async function loadNativeLive(ctx: SessionContext, supabase: Client, orderId: string): Promise<NativePosLive | { ok: false; status: number; error: string }> {
  const [order, { data: orderRow }] = await Promise.all([
    loadNativeOrder(supabase, ctx, orderId),
    supabase.from('orders').select('store_id, status').eq('id', orderId).single(),
  ]);
  if (!order) return { ok: false, status: 404, error: '注文が見つかりません' };
  if (!orderRow || orderRow.status !== 'open') return { ok: false, status: 409, error: 'この注文は既に会計済み・取消済みです' };
  const storeId = orderRow.store_id as string;
  const canCheckout = can(ctx.role, 'pos.checkout');
  let registerOpen = true;
  let steraTerminals: { id: string; name: string; online: boolean }[] = [];
  if (canCheckout) {
    const [{ data: openSession }, { data: steraRows }] = await Promise.all([
      supabase.from('register_sessions').select('id').eq('store_id', storeId).eq('status', 'open').limit(1).maybeSingle(),
      createAdminClient().from('stera_terminals').select('id, name, last_seen_at').eq('store_id', storeId).eq('status', 'active').order('created_at'),
    ]);
    registerOpen = !!openSession;
    const now = Date.now();
    steraTerminals = (steraRows ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      online: isSteraOnline(t.last_seen_at as string | null, now),
    }));
  }
  return { order, registerOpen, steraTerminals, storeId };
}

/** オーダー画面を開くときの全部（メニュー・担当者・会計の選択肢・stera）。アプリに保存が無いとき・テイクアウトのとき */
export async function loadNativePos(ctx: SessionContext, orderId: string): Promise<NativeLoadResult> {
  const supabase = await createClient();
  const { data: orderRow } = await supabase.from('orders').select('store_id, status, organization_id').eq('id', orderId).single();
  if (!orderRow) return { ok: false, status: 404, error: '注文が見つかりません' };
  if (orderRow.status !== 'open') return { ok: false, status: 409, error: 'この注文は既に会計済み・取消済みです' };
  const storeId = orderRow.store_id as string;
  const organizationId = orderRow.organization_id as string;
  const { data: typeRow } = await supabase.from('orders').select('order_type').eq('id', orderId).single();
  const takeout = isTakeoutLikeOrder((typeRow?.order_type as string | null) ?? null);
  const [live, catalog] = await Promise.all([
    loadNativeLive(ctx, supabase, orderId),
    loadNativeCatalog(ctx, supabase, storeId, organizationId, { takeout }),
  ]);
  if ('ok' in live) return live;
  const { version, ...rest } = catalog;
  return {
    ok: true,
    ...rest,
    order: live.order,
    // テイクアウトのメニューは保存させない（開くたびに読む）
    catalogVersion: takeout ? undefined : version,
    steraTerminals: live.steraTerminals,
    registerOpen: live.registerOpen,
  };
}

/**
 * 伝票の来店経路を変える（会計の画面の「来店経路」）。予約の経路（source_id）に入れ、経路の行が無い店は予約の目的に名前を残す
 * （ハンディの「お客様情報」と同じ残し方。app/app/floor/actions.ts の startWalkIn）。予約の無い伝票（即会計など）は何もしない。
 */
export async function setOrderVisitSource(ctx: SessionContext, orderId: string, sourceId: string | null): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('id, store_id, organization_id, reservation_id, status').eq('id', orderId).maybeSingle();
  if (!order || !(ctx.isHq || ctx.stores.some((s) => s.id === order.store_id))) return { ok: false, error: '注文が見つかりません' };
  if (!order.reservation_id) return { ok: false, error: 'この伝票には来店経路を残せません（テーブルの伝票だけ）' };
  const source = sourceId ? VISIT_SOURCES.find((s) => s.id === sourceId) : null;
  if (sourceId && !source) return { ok: false, error: '来店経路が正しくありません' };

  let sourceRowId: string | null = null;
  if (source) {
    const { data: srcRow } = await supabase
      .from('reservation_sources')
      .select('id')
      .in('code', source.codes as string[])
      .eq('status', 'active')
      .or(`organization_id.is.null,organization_id.eq.${order.organization_id}`)
      .limit(1)
      .maybeSingle();
    sourceRowId = (srcRow?.id as string | undefined) ?? null;
  }
  // 経路の行が無い店は予約の目的に名前を残している。経路を変える・外すときは、前の経路の名前だけ消す（ほかの目的は残す）
  const { data: resv } = await supabase.from('reservations').select('purpose').eq('id', order.reservation_id).maybeSingle();
  const oldPurpose = (resv?.purpose as string | null | undefined) ?? null;
  const purposeIsSource = !!oldPurpose && !!visitSourceByLabel(oldPurpose);
  const purpose = source && !sourceRowId ? source.label : purposeIsSource ? null : oldPurpose;
  const { error } = await supabase
    .from('reservations')
    .update({ source_id: sourceRowId, purpose })
    .eq('id', order.reservation_id);
  if (error) return { ok: false, error: '来店経路を保存できませんでした' };
  return { ok: true };
}
