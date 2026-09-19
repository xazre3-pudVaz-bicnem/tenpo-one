import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateKitchenJobs } from '@/lib/kitchen-jobs';
import { parseServerDirectPrintResult, serverDirectPrintEnvelope } from '@/lib/epos-print';

/**
 * EPSON Server Direct Print サーバーエンドポイント。
 * TM-i シリーズ等の EPSON プリンターが、このURL（末尾にプリンタ別トークン）へ定期的に POST し、
 * サーバーが ePOS-Print XML を返すと印字する。Star 用の /api/cloudprnt と同じキュー
 * （print_jobs）を使い、同じトークン（printer_configs.cloudprnt_token）で認証する。
 * どちらのURLをプリンターに設定したかで、Star / EPSON のどちらとしても動く。
 *
 * プロトコル（Server Direct Print User's Manual）:
 *   印字要求  : POST  ConnectionType=GetRequest&ID=<WebConfigのID>
 *               → 200 + text/xml（PrintRequestInfo）／ジョブ無しは 200 + 本文なし
 *   印字結果  : POST  ConnectionType=SetResponse&ID=<ID>&ResponseFile=<XML>
 *               → 200 + 本文なし
 * 本文は application/x-www-form-urlencoded。
 *
 * 1回の GetRequest で返すジョブは1件。プリンターは結果（SetResponse）を返してから次を取りに来るので、
 * ジョブごとの成否を確実に記録できる。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECLAIM_STALE_MS = 60_000;
const TTL_DRAWER_MS = 2 * 60_000;
const TTL_TEST_MS = 10 * 60_000;
const TTL_PRINT_MS = 30 * 60_000;

interface JobPayload {
  body?: string;
  starprnt?: string;
  /** ePOS-Print XML（<epos-print>…</epos-print>） */
  epos?: string;
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

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

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

/** 期限切れジョブを failed にして履歴に残す（復帰した瞬間に古いジョブが一斉に出るのを防ぐ） */
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

const EMPTY_OK = () => new NextResponse(null, { status: 200, headers: { 'Content-Length': '0' } });

/** POST: 印字要求（GetRequest）と印字結果（SetResponse）の両方がここに来る */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    form = new URLSearchParams();
  }
  const connectionType = form.get('ConnectionType') ?? 'GetRequest';
  const printerIdFromDevice = form.get('ID');

  // ポーリングのたびに死活情報を更新（WebConfig の ID を MAC 欄の代わりに控える）
  const now = new Date().toISOString();
  await admin
    .from('printer_configs')
    .update({
      last_polled_at: now,
      last_connected_at: now,
      ...(printerIdFromDevice ? { mac_address: printerIdFromDevice.slice(0, 64) } : {}),
    })
    .eq('id', printer.id);

  if (connectionType === 'SetResponse') {
    return finishJob(admin, printer, form.get('ResponseFile'));
  }

  await expireStaleJobs(admin, printer.id);

  // 確定されずに滞留した claimed ジョブを再キュー化（取りこぼし対策）
  await admin
    .from('print_jobs')
    .update({ status: 'queued', claimed_at: null })
    .eq('printer_config_id', printer.id)
    .eq('status', 'claimed')
    .eq('target', 'cloudprnt')
    .lt('claimed_at', isoAgo(RECLAIM_STALE_MS));

  if (printer.usage === 'kitchen') await generateKitchenJobs(admin, printer, 'eposprint');

  // このプリンタ宛ての最古の queued を1件取得。ePOS 表現を持つものだけが対象
  const { data: job } = await admin
    .from('print_jobs')
    .select('id, payload')
    .eq('printer_config_id', printer.id)
    .eq('status', 'queued')
    .eq('target', 'cloudprnt')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!job) return EMPTY_OK();

  const payload = job.payload as JobPayload | null;
  if (!payload?.epos) {
    // Star 用の表現しか持たない古いジョブ。EPSON では印字できないため失敗として片付け、次を待つ
    await admin
      .from('print_jobs')
      .update({ status: 'failed', error: 'no ePOS-Print payload (EPSON非対応のジョブ)' })
      .eq('id', job.id);
    return EMPTY_OK();
  }

  await admin
    .from('print_jobs')
    .update({ status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', job.id);

  const xml = serverDirectPrintEnvelope(payload.epos, { timeoutMs: 10000 });
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/**
 * 印字結果。SDP の結果には印字要求との対応IDが無い（Ver.1.00）ため、
 * このプリンタの「claimed のうち最新」を対象にする。1回に1件しか渡していないので一意に決まる。
 */
async function finishJob(
  admin: ReturnType<typeof createAdminClient>,
  printer: PrinterRow,
  responseFile: string | null
) {
  const { data: job } = await admin
    .from('print_jobs')
    .select('id')
    .eq('printer_config_id', printer.id)
    .eq('status', 'claimed')
    .eq('target', 'cloudprnt')
    .order('claimed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!job) return EMPTY_OK();

  const result = parseServerDirectPrintResult(responseFile);
  await admin
    .from('print_jobs')
    .update(
      result.success
        ? { status: 'printed', printed_at: new Date().toISOString() }
        : { status: 'failed', error: `printer result ${result.code ?? 'unknown'}` }
    )
    .eq('id', job.id);
  return EMPTY_OK();
}

/** GET: 動作確認用（ブラウザで開いたときに 404 以外を返す）。印字はしない。 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });
  return NextResponse.json({ ok: true, protocol: 'epson-server-direct-print', printer: printer.name });
}
