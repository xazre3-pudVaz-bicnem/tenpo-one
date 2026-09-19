import 'server-only';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  groupKitchenTickets,
  layoutKitchenTicket,
  STATION_LABELS,
  STATION_LABELS_EN,
  type ClaimedKitchenItem,
  type KitchenStation,
} from '@/lib/kitchen-ticket';
import { kitchenTicketMarkup } from '@/lib/receipt-markup';
import { kitchenTicketStarPrnt } from '@/lib/starprnt';
import { kitchenTicketEposXml } from '@/lib/epos-print';

/** 厨房伝票ジョブの既定 content_type（Star Document Markup） */
export const KITCHEN_JOB_CONTENT_TYPE = 'text/vnd.star.markup';

/** 連続タップを1枚にまとめる待ち（秒） */
export const KITCHEN_BATCH_DELAY_SECONDS = 3;
/** これより古い変更は伝票にしない（分）。ジョブのTTLと揃える */
export const KITCHEN_WINDOW_MINUTES = 30;

export interface KitchenPrinterRow {
  id: string;
  organization_id: string;
  store_id: string;
  paper_width_mm: number;
  kitchen_stations: string[] | null;
}

/**
 * キッチン機のポーリング時に、担当ステーションの注文差分を確定して伝票ジョブにする。
 * 端末（iPad等）が起動していなくても、QR注文の伝票がプリンタから出る。
 *
 * ジョブには Star Markup / StarPRNT / ePOS-Print XML の3表現を載せる。
 * どれで印字するかは、プリンタがどのエンドポイントを叩いているかで決まる
 * （Star は /api/cloudprnt、EPSON は /api/eposprint）。
 */
export async function generateKitchenJobs(
  admin: ReturnType<typeof createAdminClient>,
  printer: KitchenPrinterRow,
  logPrefix = 'cloudprnt'
): Promise<void> {
  const { data, error } = await admin.rpc('claim_kitchen_items', {
    p_printer: printer.id,
    p_batch_delay_seconds: KITCHEN_BATCH_DELAY_SECONDS,
    p_window_minutes: KITCHEN_WINDOW_MINUTES,
  });
  if (error) {
    console.error(`[${logPrefix}] claim_kitchen_items failed`, printer.id, error.message);
    return;
  }
  const tickets = groupKitchenTickets((data ?? []) as ClaimedKitchenItem[]);
  if (tickets.length === 0) return;

  const stations = (printer.kitchen_stations ?? ['kitchen']) as KitchenStation[];
  const title = `${stations.map((s) => STATION_LABELS[s] ?? s).join('・')} 伝票`;
  // 厨房伝票は英語を主にする（日本語を読まないスタッフが作るため）
  const titleEn = stations.map((s) => STATION_LABELS_EN[s] ?? String(s).toUpperCase()).join(' / ');
  const printedAt = new Date().toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  });
  const paperWidth = printer.paper_width_mm === 58 ? 58 : 80;

  const rows = tickets.map((t) => {
    const lines = layoutKitchenTicket(t, { title, titleEn, printedAt, paperWidth });
    return {
      organization_id: printer.organization_id,
      store_id: printer.store_id,
      printer_config_id: printer.id,
      job_type: 'kitchen',
      order_id: t.orderId,
      target: 'cloudprnt',
      content_type: KITCHEN_JOB_CONTENT_TYPE,
      payload: {
        body: kitchenTicketMarkup(lines),
        starprnt: kitchenTicketStarPrnt(lines).toString('base64'),
        epos: kitchenTicketEposXml(lines),
      },
      status: 'queued',
    };
  });

  const { error: insErr } = await admin.from('print_jobs').insert(rows);
  if (insErr) {
    // 明細は伝達済みに更新済みのため、ここで失敗すると伝票が出ない。KDS画面で確認できるよう記録を残す。
    console.error(`[${logPrefix}] kitchen job insert failed`, printer.id, insErr.message);
  }
}
