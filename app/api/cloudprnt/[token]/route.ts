import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Star CloudPRNT サーバーエンドポイント。
 * mC-Print3 等のプリンタが、このURL（末尾に店舗別トークン）を定期ポーリングして印刷ジョブを取得する。
 *   POST   … ポーリング。印刷可能ジョブがあれば jobReady:true と jobToken を返す。
 *   GET    … ジョブ本文（Star Document Markup）を取得。
 *   DELETE … 印字完了/失敗の確定。
 * 認証はURLパスの店舗別トークン（printer_configs.cloudprnt_token）。サービスロールでRLSを跨いで
 * 当該店舗のジョブのみを扱う。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECLAIM_STALE_MS = 60_000; // claimed のまま確定されないジョブを再キュー化する猶予

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
    .select('id, content_type')
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
    mediaTypes: [job.content_type ?? 'text/vnd.star.markup'],
    jobToken: job.id,
    deleteMethod: 'DELETE',
  });
}

/** GET: ジョブ本文を返す（プリンタが jobToken を指定して取得）。 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });

  const jobToken = new URL(request.url).searchParams.get('token');
  if (!jobToken) return new NextResponse('missing job token', { status: 400 });

  const { data: job } = await admin
    .from('print_jobs')
    .select('id, store_id, content_type, payload')
    .eq('id', jobToken)
    .eq('store_id', printer.store_id)
    .maybeSingle();
  if (!job) return new NextResponse('job not found', { status: 404 });

  const body = ((job.payload as { body?: string } | null)?.body) ?? '';
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': `${job.content_type ?? 'text/vnd.star.markup'}; charset=utf-8` },
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
