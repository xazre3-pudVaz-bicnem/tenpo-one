import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Star CloudPRNT サーバーエンドポイント。
 * mC-Print3 等のプリンタが、このURL（末尾に店舗別トークン）を定期ポーリングして印刷ジョブを取得する。
 *   POST   … ポーリング。印刷可能ジョブがあれば jobReady:true と対応可能な mediaTypes を返す。
 *   GET    … ジョブ本文を取得。プリンタが ?type= で選んだ形式で返す。
 *   DELETE … 印字完了/失敗の確定。
 * 認証はURLパスの店舗別トークン（printer_configs.cloudprnt_token）。サービスロールでRLSを跨いで
 * 当該店舗のジョブのみを扱う。
 *
 * 形式のネゴシエーション:
 *   Star Document Markup は mC-Print3 でもファームによっては非対応で `510 Incompatible Media Type`
 *   になる（FOGO新宿の実機で確認）。そのため1ジョブに複数表現を持たせ、mediaTypes に列挙して
 *   プリンタ自身に対応形式を選ばせる。プリンタは先頭から対応可能なものを1つ選び ?type= で要求する。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECLAIM_STALE_MS = 60_000; // claimed のまま確定されないジョブを再キュー化する猶予

const MARKUP = 'text/vnd.star.markup';
const STARPRNT = 'application/vnd.star.starprnt';

/** ジョブのpayloadに入っている表現。body=Markup文字列 / starprnt=StarPRNTバイト列のbase64。 */
interface JobPayload {
  body?: string;
  starprnt?: string;
  drawer?: boolean;
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
  const { data: printer } = await admin
    .from('printer_configs')
    .select('id, organization_id, store_id, cloudprnt_enabled, paper_width_mm')
    .eq('cloudprnt_token', token)
    .eq('cloudprnt_enabled', true)
    .eq('status', 'active')
    .maybeSingle();
  return { admin, printer };
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
  await admin
    .from('printer_configs')
    .update({ last_polled_at: new Date().toISOString(), last_connected_at: new Date().toISOString(), ...(mac ? { mac_address: mac } : {}) })
    .eq('id', printer.id);

  // 確定されずに滞留した claimed ジョブを再キュー化（取りこぼし対策）。
  const staleCutoff = new Date(Date.now() - RECLAIM_STALE_MS).toISOString();
  await admin
    .from('print_jobs')
    .update({ status: 'queued', claimed_at: null })
    .eq('store_id', printer.store_id)
    .eq('status', 'claimed')
    .eq('target', 'cloudprnt')
    .lt('claimed_at', staleCutoff);

  // 最古の queued を1件取得
  const { data: job } = await admin
    .from('print_jobs')
    .select('id, content_type, payload')
    .eq('store_id', printer.store_id)
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
    .select('id, store_id, content_type, payload')
    .eq('id', jobToken)
    .eq('store_id', printer.store_id)
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
    .eq('store_id', printer.store_id);

  return new NextResponse('ok', { status: 200 });
}
