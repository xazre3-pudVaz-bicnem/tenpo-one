import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
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

/**
 * Star CloudPRNT サーバーエンドポイント。
 * mC-Print3 等のプリンタが、このURL（末尾にプリンタ別トークン）を定期ポーリングして印刷ジョブを取得する。
 *   POST   … ポーリング。印刷可能ジョブがあれば jobReady:true と対応可能な mediaTypes を返す。
 *   GET    … ジョブ本文を取得。プリンタが ?type= で選んだ形式で返す。
 *   DELETE … 印字完了/失敗の確定。
 * 認証はURLパスのトークン（printer_configs.cloudprnt_token）。サービスロールでRLSを跨ぐが、
 * 扱うのは「そのプリンタ宛てのジョブ」だけに限定する（同じ店舗のレシート機とキッチン機が
 * 互いのジョブを取らないように）。
 *
 * 形式のネゴシエーション:
 *   Star Document Markup は mC-Print3 でもファームによっては非対応で `510 Incompatible Media Type`
 *   になる（FOGO新宿の実機で確認）。そのため1ジョブに複数表現を持たせ、mediaTypes に列挙して
 *   プリンタ自身に対応形式を選ばせる。プリンタは先頭から対応可能なものを1つ選び ?type= で要求する。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECLAIM_STALE_MS = 60_000; // claimed のまま確定されないジョブを再キュー化する猶予

/**
 * 未処理のまま古くなったジョブの有効期限。プリンタがオフラインの間に溜まったジョブが、
 * 復帰した瞬間に一斉に実行されるのを防ぐ（例: ドロアが何度も開く、昔のテスト印刷が大量に出る）。
 */
const TTL_DRAWER_MS = 2 * 60_000; // 会計時のドロア開放は数分遅れたら意味がない
const TTL_TEST_MS = 10 * 60_000;
const TTL_PRINT_MS = 30 * 60_000; // レシート・厨房伝票（必要ならレシート画面から再印刷できる）

/** キッチン伝票の生成パラメータ（claim_kitchen_items） */
const KITCHEN_BATCH_DELAY_SECONDS = 3; // 連続タップを1枚にまとめる待ち
const KITCHEN_WINDOW_MINUTES = 30; // これより古い変更は伝票にしない（TTL_PRINT_MS と揃える）

const MARKUP = 'text/vnd.star.markup';
const STARPRNT = 'application/vnd.star.starprnt';

/** ジョブのpayloadに入っている表現。body=Markup文字列 / starprnt=StarPRNTバイト列のbase64。 */
interface JobPayload {
  body?: string;
  starprnt?: string;
  drawer?: boolean;
}

interface PrinterRow {
  id: string;
  organization_id: string;
  store_id: string;
  name: string;
  usage: string;
  paper_width_mm: number;
  kitchen_stations: string[] | null;
}

/**
 * このジョブで提示できる形式を、優先順に返す。
 * Markup を先頭に置くのは、対応機なら文字コードをプリンタ任せにできて安全なため。
 * 非対応機はこれを飛ばして starprnt を選ぶので、両対応が1つのキューで成立する。
 */
function availableMediaTypes(payload: JobPayload | null, fallback: string | null): string[] {
  const types: string[] = [];
  if (payload?.body) types.push(MARKUP);
  if (payload?.starprnt) types.push(STARPRNT);
  if (types.length === 0) types.push(fallback ?? MARKUP);
  return types;
}

/** プリンタが要求した形式に対応する本文バイト列を取り出す。 */
function bodyForType(payload: JobPayload | null, type: string | null): Buffer | null {
  if (type === STARPRNT && payload?.starprnt) return Buffer.from(payload.starprnt, 'base64');
  if (type === MARKUP && payload?.body != null) return Buffer.from(payload.body, 'utf8');
  // ?type= 未指定/未知の場合は持っている表現を優先順で返す
  if (payload?.body != null) return Buffer.from(payload.body, 'utf8');
  if (payload?.starprnt) return Buffer.from(payload.starprnt, 'base64');
  return null;
}

async function resolvePrinter(token: string) {
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

/** このプリンタ宛ての期限切れジョブを破棄する（削除せず failed として履歴に残す）。 */
async function expireStaleJobs(admin: ReturnType<typeof createAdminClient>, printerId: string) {
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

/**
 * キッチン機のポーリング時に、担当ステーションの注文差分を確定して伝票ジョブにする。
 * 端末（iPad等）が起動していなくても、QR注文の伝票がプリンタから出る。
 */
async function generateKitchenJobs(admin: ReturnType<typeof createAdminClient>, printer: PrinterRow) {
  const { data, error } = await admin.rpc('claim_kitchen_items', {
    p_printer: printer.id,
    p_batch_delay_seconds: KITCHEN_BATCH_DELAY_SECONDS,
    p_window_minutes: KITCHEN_WINDOW_MINUTES,
  });
  if (error) {
    console.error('[cloudprnt] claim_kitchen_items failed', printer.id, error.message);
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
      content_type: MARKUP,
      payload: {
        body: kitchenTicketMarkup(lines),
        starprnt: kitchenTicketStarPrnt(lines).toString('base64'),
      },
      status: 'queued',
    };
  });

  const { error: insErr } = await admin.from('print_jobs').insert(rows);
  if (insErr) {
    // 明細は伝達済みに更新済みのため、ここで失敗すると伝票が出ない。KDS画面で確認できるよう記録を残す。
    console.error('[cloudprnt] kitchen job insert failed', printer.id, insErr.message);
  }
}

/** POST: ポーリング。印刷可能ジョブの有無を返す。 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return NextResponse.json({ jobReady: false }, { status: 404 });

  // ポーリングのたびに死活情報を更新。POST本文はプリンタのMAC/状態を含む（欠損許容）。
  let mac: string | null = null;
  try {
    const body = (await request.json()) as { printerMAC?: string };
    mac = body?.printerMAC ?? null;
  } catch {
    /* 本文なし/非JSONは許容 */
  }
  const now = new Date().toISOString();
  await admin
    .from('printer_configs')
    .update({ last_polled_at: now, last_connected_at: now, ...(mac ? { mac_address: mac } : {}) })
    .eq('id', printer.id);

  await expireStaleJobs(admin, printer.id);

  // 確定されずに滞留した claimed ジョブを再キュー化（取りこぼし対策）。
  await admin
    .from('print_jobs')
    .update({ status: 'queued', claimed_at: null })
    .eq('printer_config_id', printer.id)
    .eq('status', 'claimed')
    .eq('target', 'cloudprnt')
    .lt('claimed_at', isoAgo(RECLAIM_STALE_MS));

  if (printer.usage === 'kitchen') await generateKitchenJobs(admin, printer);

  // このプリンタ宛ての最古の queued を1件取得
  const { data: job } = await admin
    .from('print_jobs')
    .select('id, content_type, payload')
    .eq('printer_config_id', printer.id)
    .eq('status', 'queued')
    .eq('target', 'cloudprnt')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!job) return NextResponse.json({ jobReady: false });

  await admin
    .from('print_jobs')
    .update({ status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', job.id);

  return NextResponse.json({
    jobReady: true,
    mediaTypes: availableMediaTypes(job.payload as JobPayload | null, job.content_type),
    jobToken: job.id,
    deleteMethod: 'DELETE',
  });
}

/** GET: ジョブ本文を返す（プリンタが jobToken と ?type= を指定して取得）。 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });

  const url = new URL(request.url);
  const jobToken = url.searchParams.get('token');
  const requestedType = url.searchParams.get('type');
  if (!jobToken) return new NextResponse('missing job token', { status: 400 });

  const { data: job } = await admin
    .from('print_jobs')
    .select('id, content_type, payload')
    .eq('id', jobToken)
    .eq('printer_config_id', printer.id)
    .maybeSingle();
  if (!job) return new NextResponse('job not found', { status: 404 });

  const payload = job.payload as JobPayload | null;
  const body = bodyForType(payload, requestedType);
  if (!body) return new NextResponse('empty job', { status: 404 });

  // Content-Type はプリンタが要求した型をそのまま返す。charset 等のパラメータは付けない
  // （厳密一致でしか受け付けないファームがあるため）。
  const served = requestedType ?? job.content_type ?? MARKUP;
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: { 'Content-Type': served, 'Content-Length': String(body.length) },
  });
}

/** DELETE: 印字完了/失敗の確定。code が成功系ならprinted、それ以外はfailed。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });

  const url = new URL(request.url);
  const jobToken = url.searchParams.get('token');
  const code = url.searchParams.get('code') ?? '';
  if (!jobToken) return new NextResponse('missing job token', { status: 400 });

  // code は HTTP風の結果コード（"200" 等が成功）。数値化して2xxを成功とみなす。
  const numeric = parseInt(code, 10);
  const success = !code || (numeric >= 200 && numeric < 300);

  await admin
    .from('print_jobs')
    .update(
      success
        ? { status: 'printed', printed_at: new Date().toISOString() }
        : { status: 'failed', error: `printer code ${code}` }
    )
    .eq('id', jobToken)
    .eq('printer_config_id', printer.id);

  return new NextResponse('ok', { status: 200 });
}
