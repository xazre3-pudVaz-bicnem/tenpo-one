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
  kitchenTicketSettingsFrom,
  rotateLines180,
  layoutKitchenTicket,
  STATION_LABELS,
  STATION_LABELS_EN,
  ticketSlips,
  type ClaimedKitchenItem,
  type KitchenStation,
  type KitchenTicketSettings,
} from '@/lib/kitchen-ticket';
import { courseStepsFrom, expandCourseRows, type CourseDish, type CourseSteps } from '@/lib/course-steps';
import { kitchenTicketsMarkup } from '@/lib/receipt-markup';
import { colsFor, STAR_WIDTH_OPTIONS } from '@/lib/receipt-layout';
import { kitchenTicketsStarPrnt } from '@/lib/starprnt';
import { kitchenTicketsEpos, eposCols } from '@/lib/epos-print';

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
  /** レジ機: 会計のあとレシートを自動で印字する（設定 > プリンター「自動印刷」）。お会計伝票の自動印字は無い（2026-09-28 Ronnie「自動はオフ」） */
  auto_print?: boolean;
  /** 担当フロア（floors.id）。空＝既定プリンター（lib/printer-floors.ts） */
  floor_ids?: string[] | null;
  /** 厨房（ドリンク）機から会計伝票も出す */
  bill_slips?: boolean;
  /** プリンターを上下さかさまに付けているとき true（印字を180度回して出す） */
  upside_down?: boolean;
  /** メーカー（'EPSON' / 'Star' 等）。接続方式の判定に使う */
  maker?: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/** URLのトークンから、有効なプリンタ設定を引く。 */
export async function resolvePrinter(token: string): Promise<{ admin: Admin; printer: PrinterRow | null }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('printer_configs')
    .select('id, organization_id, store_id, name, usage, paper_width_mm, kitchen_stations, auto_print, floor_ids, bill_slips, upside_down, maker')
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
    base().in('job_type', ['receipt', 'ryoshusho', 'kitchen', 'order_slip', 'register_report']).lt('created_at', isoAgo(TTL_PRINT_MS)),
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
 * 店舗の「厨房伝票の分け方・文字の大きさ・商品名の言語」（設定 > レジ・プリンター）。読めなければ既定（種類ごと・大きめ・英語と日本語）。
 * 伝票が1枚も無いポーリングでは呼ばない（毎回の問い合わせを増やさない）。
 */
async function kitchenTicketSettingsForStore(
  admin: Admin,
  storeId: string
): Promise<KitchenTicketSettings & { courseSteps: CourseSteps }> {
  const { data, error } = await admin.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  if (error) {
    console.error('[print-queue] store_settings read failed', storeId, error.message);
    return { ...kitchenTicketSettingsFrom(null), courseSteps: {} };
  }
  const settings = data?.settings ?? null;
  return { ...kitchenTicketSettingsFrom(settings), courseSteps: courseStepsFrom(settings) };
}

/**
 * コースの注文を「料理の行（1st, 2nd…）」に置き換える（lib/course-steps.ts）。
 * その店でコースの料理を決めていなければ何もしない。調べられなくても伝票は止めず、これまでどおりコース名で出す。
 */
async function expandCourseItems(admin: Admin, rows: ClaimedKitchenItem[], steps: CourseSteps): Promise<ClaimedKitchenItem[]> {
  if (Object.keys(steps).length === 0) return rows;
  const orderItemIds = rows.map((r) => r.order_item_id).filter((id): id is string => !!id);
  if (orderItemIds.length === 0) return rows;
  const { data: oi, error } = await admin.from('order_items').select('id, menu_item_id').in('id', orderItemIds);
  if (error) {
    console.error('[print-queue] course expand: order_items read failed', error.message);
    return rows;
  }
  const menuItemIdByOrderItem = new Map<string, string | null>((oi ?? []).map((x) => [x.id as string, (x.menu_item_id as string | null) ?? null]));
  const dishIds = new Set<string>();
  for (const id of menuItemIdByOrderItem.values()) {
    if (id && steps[id]) for (const d of steps[id]) dishIds.add(d);
  }
  if (dishIds.size === 0) return rows;
  const { data: items, error: dErr } = await admin
    .from('menu_items')
    .select('id, name, name_en, name_kana')
    .in('id', [...dishIds])
    .neq('status', 'deleted');
  if (dErr) {
    console.error('[print-queue] course expand: menu_items read failed', dErr.message);
    return rows;
  }
  const dishes = new Map<string, CourseDish>(
    (items ?? []).map((m) => [
      m.id as string,
      { id: m.id as string, name: m.name as string, nameEn: (m.name_en as string | null) ?? null, nameKana: (m.name_kana as string | null) ?? null },
    ])
  );
  return expandCourseRows(rows, menuItemIdByOrderItem, steps, dishes);
}

/**
 * キッチン機のポーリング時に、担当ステーションの注文差分を確定して伝票ジョブにする。
 * 端末（iPad等）が起動していなくても、QR注文の伝票がプリンタから出る。
 * 店舗設定が「商品の種類ごと」なら1商品1枚に分け、1回の注文ぶんを1つのジョブ（1枚ごとにカット）にする。
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
  const claimed = (data ?? []) as ClaimedKitchenItem[];
  if (claimed.length === 0) return;
  const { split, textSize, language, buzzer, courseSteps } = await kitchenTicketSettingsForStore(admin, printer.store_id);
  // コースの注文は、その店で決めた料理の順（1st, 2nd…）に置き換えて伝票にする
  const tickets = groupKitchenTickets(await expandCourseItems(admin, claimed, courseSteps));
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
    const slips = ticketSlips(t, split);
    // Star 機向け: 全角がわずかに広い分を見込んで桁揃え（STAR_WIDTH_OPTIONS）
    const starSlips = slips.map((slip) => {
      const lines = layoutKitchenTicket(slip, { title, titleEn, printedAt, paperWidth, textSize, language, ...STAR_WIDTH_OPTIONS });
      // プリンターを上下さかさまに付けている店舗は、印字を180度回して出す
      return printer.upside_down ? rotateLines180(lines, colsFor(paperWidth)) : lines;
    });
    // EPSON機は1行の桁数が少ないため、専用の桁数で組み直す（Star用の行をそのまま渡すと折り返す）
    const eposSlips = slips.map((slip) => {
      const cols = eposCols(paperWidth);
      const lines = layoutKitchenTicket(slip, { title, titleEn, printedAt, columns: cols, textSize, language });
      return printer.upside_down ? rotateLines180(lines, cols) : lines;
    });
    return {
      organization_id: printer.organization_id,
      store_id: printer.store_id,
      printer_config_id: printer.id,
      job_type: 'kitchen',
      order_id: t.orderId,
      target: 'cloudprnt',
      content_type: MARKUP,
      payload: {
        body: kitchenTicketsMarkup(starSlips, { buzzer }),
        starprnt: kitchenTicketsStarPrnt(starSlips, { buzzer }).toString('base64'),
        epos: kitchenTicketsEpos(eposSlips, { buzzer }),
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
  const queued = () =>
    admin
      .from('print_jobs')
      .select('id, content_type, payload')
      .eq('printer_config_id', printerId)
      .eq('status', 'queued')
      .eq('target', 'cloudprnt');

  // ドロアは会計のたびに「すぐ」開かないとお釣りが出せず現場が止まるので、伝票より先に出す。
  // （これまでは古い順だったため、前のレシートや厨房伝票が詰まると数分待たされることがあった。
  //   2026-09-25 店舗報告「会計してもドロアが5分後に開く」）
  const { data: drawer } = await queued()
    .eq('job_type', 'test')
    .eq('payload->>drawer', 'true')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const job = drawer ?? (await queued().order('created_at', { ascending: true }).limit(1).maybeSingle()).data;
  if (!job) return null;

  await admin
    .from('print_jobs')
    .update({ status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', job.id);
  return job as { id: string; content_type: string | null; payload: JobPayload | null };
}

/**
 * このプリンタが現在取りかかっている（claimed の）ジョブのうち最も古いもの。
 * jobToken 非対応の旧ファーム（mC-Print3 3.2 未満、IFBD-HI01X/HI02X 1.8 未満）は GET/DELETE に
 * ?token= を付けてこないため、POST で払い出した直後のジョブをこれで特定する。
 * 「最も古い claimed」を GET と DELETE の両方で使えば、途中で次のジョブが claimed になっても
 * 取得と確定が同じジョブを指す。
 */
export async function currentClaimedJob(admin: Admin, printerId: string) {
  const { data: job } = await admin
    .from('print_jobs')
    .select('id, content_type, payload')
    .eq('printer_config_id', printerId)
    .eq('status', 'claimed')
    .eq('target', 'cloudprnt')
    .order('claimed_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (job as { id: string; content_type: string | null; payload: JobPayload | null } | null) ?? null;
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
