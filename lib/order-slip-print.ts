import 'server-only';
import { createHash } from 'node:crypto';
import { orderSlipMarkup } from '@/lib/receipt-markup';
import { orderSlipStarPrnt } from '@/lib/starprnt';
import { orderSlipEposXml } from '@/lib/epos-print';
import { formatReceiptDateTime } from '@/lib/receipts';
import { normalizeFloorIds, pickDefaultPrinter, pickPrinterForFloor } from '@/lib/printer-floors';
import { devicePrinterId } from '@/lib/device-printer-server';

/**
 * レシート機のプリンターの選び方と、会計伝票（注文伝票・job_type='order_slip'）を積む処理。
 * app/app/pos/print-actions.ts（レジ・ハンディのボタン、ログインあり）と、
 * お客様QRの注文（app/api/qr/kitchen-now、ログインなし・管理クライアント）の両方から使う（2026-10-23）。
 */

/** 会計伝票のジョブの第一希望の形式（print-actions.ts の RECEIPT_CONTENT_TYPE と同じ） */
const RECEIPT_CONTENT_TYPE = 'text/vnd.star.markup';

interface OrderSlipItemRow {
  id: string;
  kitchen_sent_at: string | null;
  tax_rate: number;
  tax_included: boolean;
  name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  modifiers: unknown;
}

export interface OrderSlipResult {
  ok: boolean;
  error?: string;
  queued?: number;
}

/**
 * 店舗のレシート用 CloudPRNT プリンタ設定を取得。無ければ null。
 * usage='receipt' に限定する（厨房・ラベル用プリンタへレシートを出さないため）。
 *
 * 担当フロア（printer_configs.floor_ids）:
 *   - floor を省略（レシート・ドロア）… 担当フロアの無い既定プリンター
 *   - floor を指定（会計伝票）… その卓のフロア担当のプリンター、無ければ既定プリンター
 */
export async function getCloudPrntPrinter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storeId: string,
  floor?: { floorId: string | null }
): Promise<{ id: string; paper_width_mm: number; drawer_kick: boolean; drawer_command: string; upside_down: boolean } | null> {
  let q = supabase
    .from('printer_configs')
    .select('id, paper_width_mm, drawer_kick, drawer_command, usage, floor_ids, bill_slips, upside_down')
    .eq('store_id', storeId)
    .eq('status', 'active')
    .eq('cloudprnt_enabled', true);
  // 会計伝票はレシート機に加えて「会計伝票も出す」厨房（ドリンク）機からも出せる。レシート・ドロアはレシート機だけ
  q = floor ? q.or('usage.eq.receipt,bill_slips.eq.true') : q.eq('usage', 'receipt');
  const { data } = await q.order('created_at', { ascending: true }).limit(20);
  const rows = ((data ?? []) as {
    id: string;
    paper_width_mm: number;
    drawer_kick: boolean;
    drawer_command: string;
    usage: string;
    floor_ids: string[] | null;
    upside_down?: boolean;
  }[])
    .map((r) => ({ ...r, floorIds: normalizeFloorIds(r.floor_ids) }))
    // 既定（担当フロアなし）はレシート機を優先する
    .sort((a, b) => Number(b.usage === 'receipt') - Number(a.usage === 'receipt'));
  // この iPad で選んだプリンター（レジの設定「このiPadのプリンター」）があれば、それに出す（Airレジのように端末ごとに選ぶ）。
  // 選んでいない・この店のレシート機でないときは今まで通り
  const preferredId = await devicePrinterId();
  const preferred = preferredId ? rows.find((r) => r.id === preferredId) : undefined;
  const picked = preferred ?? (floor ? pickPrinterForFloor(rows, floor.floorId) : pickDefaultPrinter(rows));
  if (!picked) return null;
  return {
    upside_down: picked.upside_down === true,
    id: picked.id,
    paper_width_mm: picked.paper_width_mm,
    drawer_kick: picked.drawer_kick,
    drawer_command: picked.drawer_command,
  };
}

/**
 * 注文伝票（会計前の中間伝票）をレシートプリンターへ積む。
 * 会計を確定せずに「いま何をいくつ頼んでいるか」と合計をお客様に見せるための印字。
 * 会計処理・売上には一切影響しない（print_jobs に job_type='order_slip' で積むだけ）。
 * @param opts.createdBy 積んだ人（お客様QRからは null）
 * @param opts.canAccessStore 店舗の権限の確認（ログインしている人が押したときだけ）
 */
export async function queueOrderSlipJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orderId: string,
  opts: { automatic?: boolean; createdBy: string | null; canAccessStore?: (storeId: string) => boolean }
): Promise<OrderSlipResult> {
  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, organization_id, store_id, order_no, guest_count, clerk_name, opened_at, subtotal, tax_total, service_charge, discount_total, rounding_adjustment, total, stores(name), restaurant_tables(name, floor_id)'
    )
    .eq('id', orderId)
    .single();
  if (!order) return { ok: false, error: '注文が見つかりません' };
  if (opts.canAccessStore && !opts.canAccessStore(order.store_id)) return { ok: false, error: 'この店舗へのアクセス権がありません' };

  // 会計伝票はその卓のフロア担当のプリンターから出す（3F の卓 → 3F のプリンター）
  const tableFloor = order.restaurant_tables as unknown as { floor_id: string | null } | null;
  const printer = await getCloudPrntPrinter(supabase, order.store_id, { floorId: tableFloor?.floor_id ?? null });
  if (!printer) {
    return { ok: false, error: 'CloudPRNT対応プリンタが未設定です（設定 > プリンター で有効化してください）' };
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('id, kitchen_sent_at, tax_rate, tax_included, name, unit_price, quantity, line_total, modifiers')
    .eq('order_id', orderId)
    .eq('status', 'active')
    .order('created_at');
  if (!items || items.length === 0) return { ok: false, error: '印刷する注文明細がありません' };

  const printedItems = opts.automatic ? (items as OrderSlipItemRow[]).filter((item) => item.kitchen_sent_at != null) : items as OrderSlipItemRow[];
  if (!printedItems.length) return { ok: true, queued: 0 };
  let amounts = { subtotal: order.subtotal, taxTotal: order.tax_total, serviceCharge: order.service_charge, discount: order.discount_total, total: order.total };
  if (opts.automatic) {
    const { data: settings, error: settingsError } = await supabase.from('store_settings').select('service_charge_rate').eq('store_id', order.store_id).maybeSingle();
    if (settingsError) return { ok: false, error: settingsError.message };
    let gross = 0;
    let tax = 0;
    for (const item of printedItems) {
      const lineTax = item.tax_included ? item.line_total - Math.floor(item.line_total / (1 + item.tax_rate / 100)) : Math.floor(item.line_total * item.tax_rate / 100);
      gross += item.line_total + (item.tax_included ? 0 : lineTax);
      tax += lineTax;
    }
    const service = Math.floor(gross * Number(settings?.service_charge_rate ?? 0) / 100);
    amounts = { subtotal: gross - tax, taxTotal: tax, serviceCharge: service, discount: order.discount_total, total: Math.max(0, gross + service - order.discount_total + (order.rounding_adjustment ?? 0)) };
  }
  // Same sent-item snapshot always has the same primary key: concurrent callbacks cannot insert twice.
  const key = opts.automatic ? createHash('sha256').update(JSON.stringify([order.organization_id, order.store_id, orderId, printedItems.map((item) => [item.id, item.quantity, item.kitchen_sent_at]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))])).digest('hex').slice(0, 32) : null;
  const jobId = key ? `${key.slice(0, 8)}-${key.slice(8, 12)}-5${key.slice(13, 16)}-a${key.slice(17, 20)}-${key.slice(20)}` : null;
  const store = order.stores as unknown as { name: string } | null;
  const table = order.restaurant_tables as unknown as { name: string } | null;
  const slip = {
    storeName: store?.name ?? '',
    orderNo: String(order.order_no),
    tableName: table?.name ?? null,
    guestCount: order.guest_count ?? null,
    clerkName: order.clerk_name ?? null,
    issuedAt: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }),
    // 開始日時（main と同じ。2026-10-24 Codex「卓の開始・会計の時刻を出す」）
    startedAt: formatReceiptDateTime(order.opened_at),
    lines: printedItems.map((it) => ({
      name: it.name as string,
      quantity: it.quantity as number,
      unitPrice: it.unit_price as number,
      lineTotal: it.line_total as number,
      modifiers: ((it.modifiers ?? []) as { name: string; price?: number }[]).map((m) => ({
        name: m.name,
        price: m.price ?? 0,
      })),
    })),
    ...amounts,
  };

  const paper = printer.paper_width_mm === 58 ? 58 : 80;
  const { error } = await supabase.from('print_jobs').insert({
    ...(jobId ? { id: jobId } : {}),
    organization_id: order.organization_id,
    store_id: order.store_id,
    printer_config_id: printer.id,
    job_type: 'order_slip',
    order_id: orderId,
    target: 'cloudprnt',
    content_type: RECEIPT_CONTENT_TYPE,
    payload: {
      body: orderSlipMarkup(slip, { paperWidth: paper }),
      starprnt: orderSlipStarPrnt(slip, { paperWidth: paper }).toString('base64'),
      epos: orderSlipEposXml(slip, { paperWidth: paper }),
    },
    status: 'queued',
    created_by: opts.createdBy,
  });
  if (jobId && error?.code === '23505') return { ok: true, queued: 0 };
  if (error) return { ok: false, error: `印刷ジョブの登録に失敗しました: ${error.message}` };
  return { ok: true, queued: 1 };
}
