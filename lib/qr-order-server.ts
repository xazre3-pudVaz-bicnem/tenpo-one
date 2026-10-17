import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { dynamicUnitPrice } from '@/lib/dynamic-pricing';
import { loadDynamicRules } from '@/lib/dynamic-pricing-server';
import { resolveOptionSelection, type OptionGroup, type OptionItem } from '@/lib/menu-options';
import { groupOfTable, tableGroupsFrom } from '@/lib/table-group';
import type { QrOptionGroup } from '@/components/qr-order/types';
import { attachQrOptionGroups, onSaleNow } from '@/lib/qr-order';

export { attachQrOptionGroups, onSaleNow };

/**
 * お客様QR の選択肢グループを、データベースの関数（get_qr_menu / create_qr_order）に頼らずに
 * サーバー（Next.js）側で扱う。
 *
 * 2026-10-17 MEAT CROWN 新横浜：00097/00098（QR の選択肢を DB 関数で返す）を本番に当てる前でも、
 * お客様が QR からナン/ライス・辛さ・ランチドリンクを選べるように。
 * - loadQrOptionGroups  … 店の商品 → 選択肢グループ（設定 > メニュー選択肢 の「上へ・下へ」の順）
 * - attachQrOptionGroups … get_qr_menu が option_groups を返していない商品に足す
 * - createQrOrderWithOptions … create_qr_order（00069）と同じ手順で注文を入れ、選択肢を明細に残す
 *   （lib/menu-options.ts の resolveOptionSelection でレジと同じ検証）
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface QrTableRef {
  id: string;
  name: string;
  store_id: string;
  organization_id: string;
}

export async function findQrTable(admin: Admin, slug: string, token: string): Promise<QrTableRef | null> {
  const { data } = await admin
    .from('restaurant_tables')
    .select('id, name, store_id, organization_id, stores!inner(slug)')
    .eq('qr_token', token)
    .eq('stores.slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    store_id: data.store_id as string,
    organization_id: data.organization_id as string,
  };
}

interface GroupRow {
  id: string;
  name: string;
  is_required: boolean | null;
  min_select: number | null;
  max_select: number | null;
  sort_order: number | null;
}

interface OptionRow {
  id: string;
  group_id: string;
  name: string;
  name_en: string | null;
  price: number | null;
  sort_order: number | null;
}

/** 店の商品 → 選択肢グループ（グループの sort_order → 紐付けの順。選択肢は sort_order → 名前） */
export async function loadQrOptionGroups(admin: Admin, storeId: string): Promise<Map<string, QrOptionGroup[]>> {
  const out = new Map<string, QrOptionGroup[]>();
  const { data: links, error: lErr } = await admin
    .from('menu_item_option_groups')
    .select('menu_item_id, group_id, sort_order')
    .eq('store_id', storeId);
  if (lErr || !links || links.length === 0) return out;
  const groupIds = [...new Set(links.map((l) => l.group_id as string))];
  const [{ data: groups }, { data: options }] = await Promise.all([
    admin
      .from('menu_option_groups')
      .select('id, name, is_required, min_select, max_select, sort_order')
      .in('id', groupIds)
      .eq('status', 'active'),
    admin
      .from('menu_option_items')
      .select('id, group_id, name, name_en, price, sort_order')
      .in('group_id', groupIds)
      .eq('status', 'active'),
  ]);
  const groupById = new Map<string, GroupRow>(((groups ?? []) as GroupRow[]).map((g) => [g.id, g]));
  const itemsByGroup = new Map<string, OptionRow[]>();
  for (const o of (options ?? []) as OptionRow[]) {
    const list = itemsByGroup.get(o.group_id) ?? [];
    list.push(o);
    itemsByGroup.set(o.group_id, list);
  }
  for (const list of itemsByGroup.values()) {
    list.sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || a.name.localeCompare(b.name, 'ja'));
  }
  const sortedLinks = [...links].sort((a, b) => {
    const ga = Number(groupById.get(a.group_id as string)?.sort_order ?? 0);
    const gb = Number(groupById.get(b.group_id as string)?.sort_order ?? 0);
    return ga - gb || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
  });
  for (const l of sortedLinks) {
    const g = groupById.get(l.group_id as string);
    if (!g) continue;
    const items = (itemsByGroup.get(g.id) ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      name_en: o.name_en,
      price: Number(o.price ?? 0),
    }));
    if (items.length === 0) continue;
    const list = out.get(l.menu_item_id as string) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      is_required: !!g.is_required,
      min_select: Math.max(0, Number(g.min_select ?? 0)),
      max_select: Math.max(1, Number(g.max_select ?? 1)),
      items,
    });
    out.set(l.menu_item_id as string, list);
  }
  return out;
}

/* ---------------------------------------------------------------- 注文 */

export interface QrOrderLineInput {
  menu_item_id: string;
  quantity: number;
  memo?: string | null;
  modifier_ids?: string[];
  option_item_ids?: string[];
}

export interface QrOrderResult {
  ok: true;
  order_id: string;
  items_added: number;
  table_name: string;
}

/** create_qr_order と同じエラーコード（お客様の画面の文言は components/qr-order/types.ts） */
export class QrOrderError extends Error {}

function jstHm(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

interface MenuRow {
  id: string;
  name: string;
  price: number;
  category_id: string | null;
  item_type: string;
  tax_rate_id: string | null;
  is_sold_out: boolean | null;
  status: string;
  sell_start_time: string | null;
  sell_end_time: string | null;
  store_id: string | null;
  organization_id: string;
}

/**
 * create_qr_order（DB 関数）と同じ手順を Next.js 側で行い、選択肢グループの選択を明細（modifiers）に残す。
 * 卓の QR（slug＋token）が合うときだけ動く。伝票が無ければ開く（人数 1・卓を着席に）。
 */
export async function createQrOrderWithOptions(
  admin: Admin,
  input: { slug: string; token: string; items: QrOrderLineInput[]; seatToken?: string | null }
): Promise<QrOrderResult> {
  const table = await findQrTable(admin, input.slug, input.token);
  if (!table) throw new QrOrderError('TABLE_NOT_FOUND');
  const items = input.items ?? [];
  if (items.length === 0) throw new QrOrderError('EMPTY_ORDER');
  if (items.length > 30) throw new QrOrderError('TOO_MANY_ITEMS');

  // 連打の抑止（create_qr_order と同じ：1分に 5 回まで）
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count: recent } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('table_id', table.id)
    .eq('order_source', 'qr')
    .gt('created_at', since);
  if ((recent ?? 0) >= 5) throw new QrOrderError('RATE_LIMITED');

  // 伝票（未会計）。無ければ開く
  let orderId: string;
  const { data: open } = await admin
    .from('orders')
    .select('id')
    .eq('table_id', table.id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) {
    orderId = open.id as string;
  } else {
    const { data: created, error: cErr } = await admin
      .from('orders')
      .insert({
        organization_id: table.organization_id,
        store_id: table.store_id,
        table_id: table.id,
        order_type: 'dine_in',
        order_source: 'qr',
        status: 'open',
        guest_count: 1,
      })
      .select('id')
      .single();
    if (cErr || !created) throw new QrOrderError('ORDER_FAILED');
    orderId = created.id as string;
    await admin
      .from('restaurant_tables')
      .update({ current_status: 'seated' })
      .eq('id', table.id)
      .in('current_status', ['available', 'reserved', 'waiting']);
  }

  const now = new Date();
  const nowHm = jstHm(now);
  const rules = await loadDynamicRules(admin, table.store_id);
  const menuIds = [...new Set(items.map((i) => i.menu_item_id))];
  const { data: menuRows } = await admin
    .from('menu_items')
    .select('id, name, price, category_id, item_type, tax_rate_id, is_sold_out, status, sell_start_time, sell_end_time, store_id, organization_id')
    .in('id', menuIds)
    .eq('organization_id', table.organization_id);
  const menuById = new Map<string, MenuRow>(((menuRows ?? []) as MenuRow[]).map((m) => [m.id, m]));
  const optionGroupsByItem = await loadQrOptionGroups(admin, table.store_id);
  const taxIds = [...new Set([...menuById.values()].map((m) => m.tax_rate_id).filter((x): x is string => !!x))];
  const taxById = new Map<string, number>();
  if (taxIds.length > 0) {
    const { data: taxes } = await admin.from('tax_rates').select('id, rate').in('id', taxIds);
    for (const t of taxes ?? []) taxById.set(t.id as string, Number(t.rate));
  }

  const rows: Record<string, unknown>[] = [];
  for (const line of items) {
    const qty = Math.floor(Number(line.quantity ?? 1));
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) throw new QrOrderError('INVALID_QUANTITY');
    const menu = menuById.get(line.menu_item_id);
    if (
      !menu ||
      menu.status !== 'active' ||
      menu.is_sold_out ||
      !(menu.item_type === 'food' || menu.item_type === 'drink') ||
      !(menu.store_id === null || menu.store_id === table.store_id) ||
      !onSaleNow(menu.sell_start_time, menu.sell_end_time, nowHm)
    ) {
      throw new QrOrderError('ITEM_UNAVAILABLE');
    }

    // 古い menu_modifiers（グループ無し）
    const modIds = [...new Set((line.modifier_ids ?? []).filter((x) => typeof x === 'string'))];
    if (modIds.length > 5) throw new QrOrderError('TOO_MANY_MODIFIERS');
    let legacy: { name: string; price: number }[] = [];
    let legacyTotal = 0;
    if (modIds.length > 0) {
      const { data: mods } = await admin
        .from('menu_item_modifiers')
        .select('modifier_id, menu_modifiers!inner(id, name, price, status)')
        .eq('menu_item_id', menu.id)
        .in('modifier_id', modIds);
      legacy = (mods ?? [])
        .map((r) => r.menu_modifiers as unknown as { id: string; name: string; price: number; status: string } | null)
        .filter((m): m is { id: string; name: string; price: number; status: string } => !!m && m.status === 'active')
        .map((m) => ({ name: m.name, price: Number(m.price ?? 0) }));
      if (legacy.length !== modIds.length) throw new QrOrderError('INVALID_MODIFIER');
      legacyTotal = legacy.reduce((s, m) => s + m.price, 0);
    }

    // 選択肢グループ（レジと同じ検証。必須・最小/最大）
    const optIds = [...new Set((line.option_item_ids ?? []).filter((x) => typeof x === 'string'))];
    if (optIds.length > 12) throw new QrOrderError('TOO_MANY_MODIFIERS');
    const groups = optionGroupsByItem.get(menu.id) ?? [];
    const optionGroups: OptionGroup[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      isRequired: g.is_required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
    }));
    const selected: OptionItem[] = [];
    for (const id of optIds) {
      const g = groups.find((grp) => grp.items.some((o) => o.id === id));
      const o = g?.items.find((x) => x.id === id);
      if (!g || !o) throw new QrOrderError('INVALID_MODIFIER');
      selected.push({ id: o.id, name: o.name, nameEn: o.name_en, price: o.price, groupId: g.id });
    }
    let resolved: { modifiers: { name: string; name_en?: string; price: number }[]; extraPrice: number };
    try {
      resolved = resolveOptionSelection(optionGroups, selected);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      throw new QrOrderError(/以上選んでください/.test(msg) ? 'OPTION_REQUIRED' : 'INVALID_MODIFIER');
    }

    const base = dynamicUnitPrice(
      rules,
      { id: menu.id, categoryId: menu.category_id, itemType: menu.item_type },
      Number(menu.price),
      now
    ).price;
    const unit = base + resolved.extraPrice;
    const memo = typeof line.memo === 'string' ? line.memo.trim().slice(0, 200) : '';
    rows.push({
      organization_id: table.organization_id,
      store_id: table.store_id,
      order_id: orderId,
      menu_item_id: menu.id,
      name: menu.name,
      unit_price: unit,
      quantity: qty,
      tax_rate: menu.tax_rate_id ? (taxById.get(menu.tax_rate_id) ?? 10) : 10,
      tax_included: true,
      line_total: (unit + legacyTotal) * qty,
      memo: memo || null,
      modifiers: [...resolved.modifiers, ...legacy],
      kitchen_status: 'pending',
    });
  }

  // テーブルグループ：別の卓の QR から入れた品は「注文した卓」を残す（create_qr_order_at_seat と同じ）
  if (input.seatToken && input.seatToken !== input.token) {
    const seat = await findQrTable(admin, input.slug, input.seatToken);
    if (seat && seat.store_id === table.store_id && seat.id !== table.id) {
      const { data: settings } = await admin.from('store_settings').select('settings').eq('store_id', table.store_id).maybeSingle();
      const group = groupOfTable(tableGroupsFrom(settings?.settings), table.id);
      if (group && group.tableIds.includes(seat.id)) for (const r of rows) r.ordered_table_id = seat.id;
    }
  }

  const { error: iErr } = await admin.from('order_items').insert(rows);
  if (iErr) {
    // ordered_table_id の無い古いデータベースなら、その列を外してもう一度
    if (/ordered_table_id/.test(iErr.message)) {
      for (const r of rows) delete r.ordered_table_id;
      const { error: again } = await admin.from('order_items').insert(rows);
      if (again) throw new QrOrderError('ORDER_FAILED');
    } else {
      throw new QrOrderError('ORDER_FAILED');
    }
  }
  const { error: rErr } = await admin.rpc('recalc_order_totals', { p_order_id: orderId });
  if (rErr) console.error('[qr-order] recalc_order_totals failed', rErr.message);

  return { ok: true, order_id: orderId, items_added: rows.length, table_name: table.name };
}
