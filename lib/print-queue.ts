/**
 * プリンタ側からのポーリングで動く印刷キューの共通処理。
 * Star CloudPRNT（app/api/cloudprnt/[token]）と EPSON Server Direct Print（app/api/epson/[token]）が共有する。
 *
 * どちらの方式も「プリンタが定期的にサーバへ問い合わせ、ジョブがあれば受け取って印字し、結果を返す」ため、
 * ジョブの期限切れ・取りこぼし回収・厨房伝票の生成は同じロジックでよい。表現（Markup / StarPRNT / ePOS-Print XML）
 * だけが方式ごとに異なり、payload に3種とも載せてプリンタ側に選ばせる。
 */
import { createAdminClient } from '@/lib/supabase/admin';
import {
  groupKitchenTickets,
  layoutKitchenTicket,
  STATION_LABELS,
  type ClaimedKitchenItem,
  type KitchenStation,
} from '@/lib/kitchen-ticket';
import { kitchenTicketMarkup } from '@/lib/receipt-markup';
import { kitchenTicketStarPrnt } from '@/lib/starprnt';
import { kitchenTicketEpos } from '@/lib/epos-print';

export const MARKUP = 'text/vnd.star.markup';
export const STARPRNT = 'application/vnd.star.starprnt';

export const RECLAIM_STALE_MS = 60_000; // claimed のまま確定されないジョブを再キュー化する猶予

/**
 * 未処理のまま古くなったジョブの有効期限。プリンタがオフラインの間に溜まったジョブが、
 * 復帰した瞬間に一斉に実行されるのを防ぐ（例: ドロアが何度も開く、昔のテスト印刷が大量に出る）。
 */
export const TTL_DRAWER_MS = 2 * 60_000; // 会計時のドロア開放は数分遅れたら意味がない
export const TTL_TEST_MS = 10 * 60_000;
export const TTL_PRINT_MS = 30 * 60_000; // レシート・厨房伝票（必要ならレシート画面から再印刷できる）

/** キッチン伝票の生成パラメータ（claim_kitchen_items） */
const KITCHEN_BATCH_DELAY_SECONDS = 3; // 連続タップを1枚にまとめる待ち
const KITCHEN_WINDOW_MINUTES = 30; // これより古い変更は伝票にしない（TTL_PRINT_MS と揃える）

/** ジョブのpayloadに入っている表現。body=Markup文字列 / starprnt=StarPRNTバイト列のbase64 / epos=ePOS-Print XML。 */
export interface JobPayload {
  body?: string;
  starprnt?: string;
  epos?: string;
  drawer?: boolean;
}

export interface PrinterRow {
  id: string;
  organization_id: string;
  store_id: string;
  name: string;
  usage: string;
  paper_width_mm: number;
  kitchen_stations: string[] | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/** URLのトークンから、有効なプリンタ設定を引く。 */
export async function resolvePrinter(token: string): Promise<{ admin: Admin; printer: PrinterRow | null }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('printer_configs')
    .select('id, organization_id, store_id, name, usage, paper_width_mm, kitchen_stations')
    .eq('cloudprnt_token', token)
    .eq('cloudprnt_enabled', true)
    .eq('status', 'active')
    .maybeSingle();
  return { admin, printer: (data as PrinterRow | null) ?? null };
}

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

/** 死活情報の更新（ポーリングのたびに呼ぶ）。 */
export async function touchPrinter(admin: Admin, printerId: string, mac?: string | null) {
  const now = new Date().toISOString();
  await admin
    .from('printer_configs')
    .update({ last_polled_at: now, last_connected_at: now, ...(mac ? { mac_address: mac } : {}) })
    .eq('id', printerId);
}

/** このプリンタ宛ての期限切れジョブを破棄する（削除せず failed として履歴に残す）。 */
export async function expireStaleJobs(admin: Admin, printerId: string) {
  const base = () =>
    admin
      .from('print_jobs')
      .update({ status: 'failed', error: 'expired: プリンタ未接続の間に有効期限切れ' })
      .eq('printer_config_id', printerId)
      .eq('target', 'cloudprnt')
      .eq('status', 'queued');

  await Promise.all([
    base().eq('job_type', 'test').eq('payload->>drawer', 'true').lt('created_at', isoAgo(TTL_DRAWER_MS)),
    base().eq('job_type', 'test').lt('created_at', isoAgo(TTL_TEST_MS)),
    base().in('job_type', ['receipt', 'ryoshusho', 'kitchen', 'order_slip']).lt('created_at', isoAgo(TTL_PRINT_MS)),
  ]);
}

/** 確定されずに滞留した claimed ジョブを再キュー化（取りこぼし対策）。 */
export async function reclaimStaleJobs(admin: Admin, printerId: string) {
  await admin
    .from('print_jobs')
    .update({ status: 'queued', claimed_at: null })
    .eq('printer_config_id', printerId)
    .eq('status', 'claimed')
    .eq('target', 'cloudprnt')
    .lt('claimed_at', isoAgo(RECLAIM_STALE_MS));
}

/**
 * キッチン機のポーリング時に、担当ステーションの注文差分を確定して伝票ジョブにする。
 * 端末（iPad等）が起動していなくても、QR注文の伝票がプリンタから出る。
 */
export async function generateKitchenJobs(admin: Admin, printer: PrinterRow) {
  const { data, error } = await admin.rpc('claim_kitchen_items', {
    p_printer: printer.id,
    p_batch_delay_seconds: KITCHEN_BATCH_DELAY_SECONDS,
    p_window_minutes: KITCHEN_WINDOW_MINUTES,
  });
  if (error) {
    console.error('[print-queue] claim_kitchen_items failed', printer.id, error.message);
    return;
  }
  const tickets = groupKitchenTickets((data ?? []) as ClaimedKitchenItem[]);
  if (tickets.length === 0) return;

  const stations = (printer.kitchen_stations ?? ['kitchen']) as KitchenStation[];
  const title = `${stations.map((s) => STATION_LABELS[s] ?? s).join('・')} 伝票`;
  const printedAt = new Date().toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  });
  const paperWidth = printer.paper_width_mm === 58 ? 58 : 80;

  const rows = tickets.map((t) => {
    const lines = layoutKitchenTicket(t, { title, printedAt, paperWidth });
    return {
      organization_id: printer.organization_id,
      store_id: printer.store_id,
      printer_config_id: printer.id,
      job_type: 'kitchen',
      order_id: t.orderId,
      target: 'cloudprnt',
      content_type: MARKUP,
      payload: {
        body: kitchenTicketMarkup(lines),
        starprnt: kitchenTicketStarPrnt(lines).toString('base64'),
        epos: kitchenTicketEpos(lines),
      },
      status: 'queued',
    };
  });

  const { error: insErr } = await admin.from('print_jobs').insert(rows);
  if (insErr) {
    // 明細は伝達済みに更新済みのため、ここで失敗すると伝票が出ない。KDS画面で確認できるよう記録を残す。
    console.error('[print-queue] kitchen job insert failed', printer.id, insErr.message);
  }
}

/** このプリンタ宛ての最古の queued を1件取り出し、claimed にする。 */
export async function claimNextJob(admin: Admin, printerId: string) {
  const { data: job } = await admin
    .from('print_jobs')
    .select('id, content_type, payload')
    .eq('printer_config_id', printerId)
    .eq('status', 'queued')
    .eq('target', 'cloudprnt')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!job) return null;

  await admin
    .from('print_jobs')
    .update({ status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', job.id);
  return job as { id: string; content_type: string | null; payload: JobPayload | null };
}

/** 印字結果の確定。 */
export async function finishJob(
  admin: Admin,
  printerId: string,
  jobId: string,
  success: boolean,
  detail?: string | null
) {
  await admin
    .from('print_jobs')
    .update(
      success
        ? { status: 'printed', printed_at: new Date().toISOString() }
        : { status: 'failed', error: detail ? `printer: ${detail}` : 'printer error' }
    )
    .eq('id', jobId)
    .eq('printer_config_id', printerId);
}
