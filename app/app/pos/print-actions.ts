'use server';

import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadReceiptData } from '@/lib/receipts-loader';
import { receiptToStarMarkup, drawerKickMarkup } from '@/lib/receipt-markup';

const RECEIPT_CONTENT_TYPE = 'text/vnd.star.markup';

export interface EnqueueResult {
  ok: boolean;
  error?: string;
  queued?: number;
}

function assertStore(ctx: { isHq: boolean; stores: { id: string }[] }, storeId: string): boolean {
  return ctx.isHq || ctx.stores.some((s) => s.id === storeId);
}

/** 店舗の CloudPRNT 有効レシートプリンタ設定を取得（usage=receipt優先）。無ければ null。 */
async function getCloudPrntPrinter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storeId: string
): Promise<{ id: string; paper_width_mm: number; drawer_kick: boolean; drawer_command: string } | null> {
  const { data } = await supabase
    .from('printer_configs')
    .select('id, paper_width_mm, drawer_kick, drawer_command, usage')
    .eq('store_id', storeId)
    .eq('status', 'active')
    .eq('cloudprnt_enabled', true)
    .order('usage', { ascending: true }) // 'receipt' が 'label'/'kitchen' より前に来る
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * レシートを CloudPRNT キューへ積む。プリンタがポーリング時に取得して印字する。
 * drawer=true かつプリンタのドロアキックが有効なら、ドロア開放を別ジョブとして併せて積む
 * （ドロア命令の機種差でレシート印字が巻き込まれないよう分離）。
 */
export async function enqueueReceiptPrint(
  orderId: string,
  opts: { reissue?: boolean; drawer?: boolean; jobType?: 'receipt' | 'ryoshusho' } = {}
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
  const markup = receiptToStarMarkup(loaded.receipt, { paperWidth: paper });

  const rows: Record<string, unknown>[] = [
    {
      organization_id: order.organization_id,
      store_id: order.store_id,
      printer_config_id: printer.id,
      job_type: opts.jobType ?? 'receipt',
      order_id: orderId,
      target: 'cloudprnt',
      content_type: RECEIPT_CONTENT_TYPE,
      payload: { body: markup },
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
      payload: { body: drawerKickMarkup(printer.drawer_command), drawer: true },
      status: 'queued',
      created_by: ctx.userId,
    });
  }

  const { error } = await supabase.from('print_jobs').insert(rows);
  if (error) return { ok: false, error: `印刷ジョブの登録に失敗しました: ${error.message}` };
  return { ok: true, queued: rows.length };
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
    payload: { body: drawerKickMarkup(printer.drawer_command), drawer: true },
    status: 'queued',
    created_by: ctx.userId,
  });
  if (error) return { ok: false, error: `ドロア開放ジョブの登録に失敗しました: ${error.message}` };
  return { ok: true, queued: 1 };
}
