'use server';

import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadReceiptData } from '@/lib/receipts-loader';
import { receiptToStarMarkup, ryoshushoToStarMarkup, orderSlipMarkup, drawerKickMarkup } from '@/lib/receipt-markup';
import { receiptToStarPrnt, ryoshushoToStarPrnt, orderSlipStarPrnt, drawerKickStarPrnt } from '@/lib/starprnt';
import { normalizeFloorIds, pickDefaultPrinter, pickPrinterForFloor } from '@/lib/printer-floors';
import { receiptToEposXml, ryoshushoToEposXml, orderSlipEposXml, drawerKickEpos, kitchenTicketsEpos, eposCols } from '@/lib/epos-print';
import { layoutKitchenTicket, rotateLines180, type KitchenTicket } from '@/lib/kitchen-ticket';
import { kitchenTicketsMarkup } from '@/lib/receipt-markup';
import { kitchenTicketsStarPrnt } from '@/lib/starprnt';
import { colsFor, STAR_WIDTH_OPTIONS } from '@/lib/receipt-layout';

/**
 * ジョブに載せる既定の形式。実際にどの形式で印字されるかはプリンタが
 * CloudPRNT の mediaTypes ネゴシエーションで選ぶ（app/api/cloudprnt/[token]/route.ts）。
 * この値は表示・互換のための「第一希望」に過ぎない。
 */
const RECEIPT_CONTENT_TYPE = 'text/vnd.star.markup';
/** 厨房伝票と同じ組み方で出す紙（取消伝票）の形式 */
const MARKUP_CONTENT_TYPE = 'text/vnd.star.markup';

export interface EnqueueResult {
  ok: boolean;
  error?: string;
  queued?: number;
}

function assertStore(ctx: { isHq: boolean; stores: { id: string }[] }, storeId: string): boolean {
  return ctx.isHq || ctx.stores.some((s) => s.id === storeId);
}

/**
 * 店舗のレシート用 CloudPRNT プリンタ設定を取得。無ければ null。
 * usage='receipt' に限定する（厨房・ラベル用プリンタへレシートを出さないため）。
 *
 * 担当フロア（printer_configs.floor_ids）:
 *   - floor を省略（レシート・ドロア）… 担当フロアの無い既定プリンター
 *   - floor を指定（会計伝票）… その卓のフロア担当のプリンター、無ければ既定プリンター
 */
async function getCloudPrntPrinter(
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
  const picked = floor ? pickPrinterForFloor(rows, floor.floorId) : pickDefaultPrinter(rows);
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
 * レシートを CloudPRNT キューへ積む。プリンタがポーリング時に取得して印字する。
 * drawer=true かつプリンタのドロアキックが有効なら、ドロア開放を別ジョブとして併せて積む
 * （ドロア命令の機種差でレシート印字が巻き込まれないよう分離）。
 */
export async function enqueueReceiptPrint(
  orderId: string,
  opts: {
    reissue?: boolean;
    drawer?: boolean;
    jobType?: 'receipt' | 'ryoshusho';
    /** 領収書の宛名（空欄なら「上様」） */
    recipientName?: string | null;
    /** 領収書の但し書き（空欄なら「お品代として」） */
    purpose?: string | null;
  } = {}
): Promise<EnqueueResult> {
  const ctx = await requirePermission('pos.checkout');
  const supabase = await createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, organization_id, store_id')
    .eq('id', orderId)
    .single();
  if (!order) return { ok: false, error: '注文が見つかりません' };
  if (!assertStore(ctx, order.store_id)) return { ok: false, error: 'この店舗へのアクセス権がありません' };

  const printer = await getCloudPrntPrinter(supabase, order.store_id);
  if (!printer) {
    return { ok: false, error: 'CloudPRNT対応プリンタが未設定です（設定 > プリンター で有効化してください）' };
  }

  const loaded = await loadReceiptData(supabase, orderId, { isReissue: opts.reissue });
  if (!loaded) return { ok: false, error: 'レシートデータの取得に失敗しました' };

  const paper = printer.paper_width_mm === 58 ? 58 : 80;
  // Markup / StarPRNT / ePOS-Print XML の3表現を持たせ、対応形式はプリンタ側に選ばせる
  // （Star機はMarkupかStarPRNT、EPSON機はePOS-Print XMLを取りに来る）。
  // 領収書はレシートとは別レイアウト（見出し「領収書」・宛名・但し書き・金額を大きく）。
  const isRyoshusho = opts.jobType === 'ryoshusho';
  const ryoshushoOpts = {
    paperWidth: paper,
    recipientName: opts.recipientName ?? null,
    purpose: opts.purpose ?? null,
  } as const;
  const markup = isRyoshusho
    ? ryoshushoToStarMarkup(loaded.receipt, ryoshushoOpts)
    : receiptToStarMarkup(loaded.receipt, { paperWidth: paper });
  const starprnt = (
    isRyoshusho
      ? ryoshushoToStarPrnt(loaded.receipt, ryoshushoOpts)
      : receiptToStarPrnt(loaded.receipt, { paperWidth: paper })
  ).toString('base64');
  const epos = isRyoshusho
    ? ryoshushoToEposXml(loaded.receipt, ryoshushoOpts)
    : receiptToEposXml(loaded.receipt, { paperWidth: paper });

  const rows: Record<string, unknown>[] = [
    {
      organization_id: order.organization_id,
      store_id: order.store_id,
      printer_config_id: printer.id,
      job_type: opts.jobType ?? 'receipt',
      order_id: orderId,
      target: 'cloudprnt',
      content_type: RECEIPT_CONTENT_TYPE,
      payload: { body: markup, starprnt, epos },
      status: 'queued',
      created_by: ctx.userId,
    },
  ];
  if (opts.drawer && printer.drawer_kick) {
    rows.push({
      organization_id: order.organization_id,
      store_id: order.store_id,
      printer_config_id: printer.id,
      job_type: 'test',
      order_id: orderId,
      target: 'cloudprnt',
      content_type: RECEIPT_CONTENT_TYPE,
      payload: {
        body: drawerKickMarkup(printer.drawer_command),
        starprnt: drawerKickStarPrnt(printer.drawer_command).toString('base64'),
        epos: drawerKickEpos(printer.drawer_command),
        drawer: true,
      },
      status: 'queued',
      created_by: ctx.userId,
    });
  }

  const { error } = await supabase.from('print_jobs').insert(rows);
  if (error) return { ok: false, error: `印刷ジョブの登録に失敗しました: ${error.message}` };
  return { ok: true, queued: rows.length };
}

/**
 * 注文伝票（会計前の中間伝票）をレシートプリンターへ積む。
 * 会計を確定せずに「いま何をいくつ頼んでいるか」と合計をお客様に見せるための印字。
 * 会計処理・売上には一切影響しない（print_jobs に job_type='order_slip' で積むだけ）。
 */
export async function enqueueOrderSlipPrint(orderId: string): Promise<EnqueueResult> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();

  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, organization_id, store_id, order_no, guest_count, clerk_name, subtotal, tax_total, service_charge, discount_total, total, stores(name), restaurant_tables(name, floor_id)'
    )
    .eq('id', orderId)
    .single();
  if (!order) return { ok: false, error: '注文が見つかりません' };
  if (!assertStore(ctx, order.store_id)) return { ok: false, error: 'この店舗へのアクセス権がありません' };

  // 会計伝票はその卓のフロア担当のプリンターから出す（3F の卓 → 3F のプリンター）
  const tableFloor = order.restaurant_tables as unknown as { floor_id: string | null } | null;
  const printer = await getCloudPrntPrinter(supabase, order.store_id, { floorId: tableFloor?.floor_id ?? null });
  if (!printer) {
    return { ok: false, error: 'CloudPRNT対応プリンタが未設定です（設定 > プリンター で有効化してください）' };
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('name, unit_price, quantity, line_total, modifiers')
    .eq('order_id', orderId)
    .eq('status', 'active')
    .order('created_at');
  if (!items || items.length === 0) return { ok: false, error: '印刷する注文明細がありません' };

  const store = order.stores as unknown as { name: string } | null;
  const table = order.restaurant_tables as unknown as { name: string } | null;
  const slip = {
    storeName: store?.name ?? '',
    orderNo: String(order.order_no),
    tableName: table?.name ?? null,
    guestCount: order.guest_count ?? null,
    clerkName: order.clerk_name ?? null,
    issuedAt: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }),
    lines: items.map((it) => ({
      name: it.name as string,
      quantity: it.quantity as number,
      unitPrice: it.unit_price as number,
      lineTotal: it.line_total as number,
      modifiers: ((it.modifiers ?? []) as { name: string; price?: number }[]).map((m) => ({
        name: m.name,
        price: m.price ?? 0,
      })),
    })),
    subtotal: order.subtotal as number,
    taxTotal: order.tax_total as number,
    serviceCharge: order.service_charge as number,
    discount: order.discount_total as number,
    total: order.total as number,
  };

  const paper = printer.paper_width_mm === 58 ? 58 : 80;
  const { error } = await supabase.from('print_jobs').insert({
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
    created_by: ctx.userId,
  });
  if (error) return { ok: false, error: `印刷ジョブの登録に失敗しました: ${error.message}` };
  return { ok: true, queued: 1 };
}

/** キャッシュドロアのみを開くジョブを積む（会計時の自動開放や手動開放ボタン用）。 */
export async function enqueueDrawerKick(storeId: string): Promise<EnqueueResult> {
  const ctx = await requirePermission('pos.checkout');
  if (!assertStore(ctx, storeId)) return { ok: false, error: 'この店舗へのアクセス権がありません' };
  const supabase = await createClient();
  const printer = await getCloudPrntPrinter(supabase, storeId);
  if (!printer) return { ok: false, error: 'CloudPRNT対応プリンタが未設定です' };
  if (!printer.drawer_kick) return { ok: false, error: 'このプリンタはドロアキックが無効です' };

  const { data: store } = await supabase.from('stores').select('organization_id').eq('id', storeId).single();
  const { error } = await supabase.from('print_jobs').insert({
    organization_id: store?.organization_id,
    store_id: storeId,
    printer_config_id: printer.id,
    job_type: 'test',
    target: 'cloudprnt',
    content_type: RECEIPT_CONTENT_TYPE,
    payload: {
      body: drawerKickMarkup(printer.drawer_command),
      starprnt: drawerKickStarPrnt(printer.drawer_command).toString('base64'),
      epos: drawerKickEpos(printer.drawer_command),
      drawer: true,
    },
    status: 'queued',
    created_by: ctx.userId,
  });
  if (error) return { ok: false, error: `ドロア開放ジョブの登録に失敗しました: ${error.message}` };
  return { ok: true, queued: 1 };
}

/** 取消の紙に載せる1品 */
export interface CancelSlipLine {
  name: string;
  nameEn?: string | null;
  /** 取り消した数（正の数で渡す） */
  quantity: number;
  modifiers?: string[];
  memo?: string | null;
}

/**
 * 一度キッチンへ出した品を取り消したときに、レジのレシート機へ「取消」の紙を出す（2026-09-24 店舗要望）。
 * 厨房ぶんは claim_kitchen_items のマイナス差分で今までどおり出るので、ここはレジ側だけ。
 * 印刷できなくても取消そのものは成立させる（呼び出し側で握りつぶす）。
 */
export async function enqueueCancelSlipPrint(orderId: string, lines: CancelSlipLine[]): Promise<EnqueueResult> {
  const ctx = await requirePermission('pos.order');
  if (lines.length === 0) return { ok: false, error: '取消した品がありません' };
  const supabase = await createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, organization_id, store_id, order_no, guest_count, clerk_name, restaurant_tables(name)')
    .eq('id', orderId)
    .single();
  if (!order) return { ok: false, error: '注文が見つかりません' };
  if (!assertStore(ctx, order.store_id)) return { ok: false, error: 'この店舗へのアクセス権がありません' };

  const printer = await getCloudPrntPrinter(supabase, order.store_id);
  if (!printer) return { ok: false, error: 'レシート用のCloudPRNT対応プリンタが未設定です' };

  const table = order.restaurant_tables as unknown as { name: string } | null;
  const ticket: KitchenTicket = {
    orderId: order.id,
    orderNo: String(order.order_no),
    tableName: table?.name ?? null,
    guestCount: order.guest_count ?? null,
    clerkName: order.clerk_name ?? null,
    lines: lines.map((l) => ({
      name: l.name,
      nameEn: l.nameEn ?? null,
      modifiers: l.modifiers ?? [],
      memo: l.memo ?? null,
      // マイナス＝取消（厨房伝票と同じ書き方で「*** CANCEL / 取消 ***」が出る）
      delta: -Math.abs(l.quantity),
    })),
  };

  const printedAt = new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
  const paperWidth = printer.paper_width_mm === 58 ? 58 : 80;
  const common = { title: '取消 伝票', titleEn: 'CANCEL', printedAt, textSize: 'large' as const, language: 'both' as const };
  const starLines = layoutKitchenTicket(ticket, { ...common, paperWidth, ...STAR_WIDTH_OPTIONS });
  const eposLines = layoutKitchenTicket(ticket, { ...common, columns: eposCols(paperWidth) });
  // プリンターを上下さかさまに付けている店舗は、印字を180度回して出す
  const star = printer.upside_down ? rotateLines180(starLines, colsFor(paperWidth)) : starLines;
  const epos = printer.upside_down ? rotateLines180(eposLines, eposCols(paperWidth)) : eposLines;

  const { error } = await supabase.from('print_jobs').insert({
    organization_id: order.organization_id,
    store_id: order.store_id,
    printer_config_id: printer.id,
    job_type: 'cancel_slip',
    order_id: orderId,
    target: 'cloudprnt',
    content_type: MARKUP_CONTENT_TYPE,
    payload: {
      body: kitchenTicketsMarkup([star]),
      starprnt: kitchenTicketsStarPrnt([star]).toString('base64'),
      epos: kitchenTicketsEpos([epos]),
    },
    status: 'queued',
    created_by: ctx.userId,
  });
  if (error) return { ok: false, error: `印刷ジョブの登録に失敗しました: ${error.message}` };
  return { ok: true, queued: 1 };
}
