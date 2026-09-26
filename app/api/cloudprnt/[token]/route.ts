import { NextResponse } from 'next/server';
import {
  claimNextJob,
  currentClaimedJob,
  expireStaleJobs,
  finishJob,
  generateKitchenJobs,
  generateQrBillJobs,
  reclaimStaleJobs,
  resolvePrinter,
  touchPrinter,
  MARKUP,
  STARPRNT,
  type JobPayload,
} from '@/lib/print-queue';
import { handleServerDirectPrint, looksLikeServerDirectPrint } from '@/lib/printing/server-direct-print-handler';

/**
 * Star CloudPRNT サーバーエンドポイント。
 * mC-Print3 等のプリンタが、このURL（末尾にプリンタ別トークン）を定期ポーリングして印刷ジョブを取得する。
 *   POST   … ポーリング。印刷可能ジョブがあれば jobReady:true と対応可能な mediaTypes を返す。
 *   GET    … ジョブ本文を取得。プリンタが ?type= で選んだ形式で返す。
 *   DELETE … 印字完了/失敗の確定。
 * 認証はURLパスのトークン（printer_configs.cloudprnt_token）。サービスロールでRLSを跨ぐが、
 * 扱うのは「そのプリンタ宛てのジョブ」だけに限定する（同じ店舗のレシート機とキッチン機が
 * 互いのジョブを取らないように）。ジョブキューの共通処理は lib/print-queue.ts にあり、
 * EPSON Server Direct Print（app/api/epson/[token]）と共有する。
 *
 * 形式のネゴシエーション:
 *   Star Document Markup は mC-Print3 でもファームによっては非対応で `510 Incompatible Media Type`
 *   になる（FOGO新宿の実機で確認）。そのため1ジョブに複数表現を持たせ、mediaTypes に列挙して
 *   プリンタ自身に対応形式を選ばせる。プリンタは先頭から対応可能なものを1つ選び ?type= で要求する。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

/** POST: ポーリング。印刷可能ジョブの有無を返す。 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return NextResponse.json({ jobReady: false }, { status: 404 });

  // ポーリングのたびに死活情報を更新。POST本文はプリンタのMAC/状態を含む（欠損許容）。
  let bodyText = '';
  try {
    bodyText = await request.text();
  } catch {
    bodyText = '';
  }

  // EPSON（Server Direct Print）機が Star 用のこのURLにつながれているときは、EPSON として受ける。
  // （設定画面でメーカーを Star にしたまま EPSON 機に URL を入れると、JSON を返しても印字されず
  //   ジョブが「払い出し済み」のまま残る。2026-09-26 FOGO 新宿のドリンク機で発生）
  if (looksLikeServerDirectPrint(bodyText, request.headers.get('content-type'))) {
    await recordPollDiag(admin, printer.store_id, printer.id, request, bodyText, 'sdp');
    return handleServerDirectPrint(admin, printer, bodyText);
  }

  let mac: string | null = null;
  try {
    const body = JSON.parse(bodyText) as { printerMAC?: string };
    mac = body?.printerMAC ?? null;
  } catch {
    /* 本文なし/非JSONは許容 */
    await recordPollDiag(admin, printer.store_id, printer.id, request, bodyText, 'non-json');
  }
  await touchPrinter(admin, printer.id, mac);

  await expireStaleJobs(admin, printer.id);
  await reclaimStaleJobs(admin, printer.id);

  if (printer.usage === 'kitchen') await generateKitchenJobs(admin, printer);
  // レシート機と「会計伝票も出す」厨房（ドリンク）機（関数の中で判定する）
  await generateQrBillJobs(admin, printer);

  const job = await claimNextJob(admin, printer.id);
  if (!job) return NextResponse.json({ jobReady: false });

  return NextResponse.json({
    jobReady: true,
    mediaTypes: availableMediaTypes(job.payload, job.content_type),
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

  // token 付き（3.2 以降）はそのジョブ、token 無し（旧ファーム）は払い出し済みの最も古いジョブ
  const job = jobToken
    ? (
        await admin
          .from('print_jobs')
          .select('id, content_type, payload')
          .eq('id', jobToken)
          .eq('printer_config_id', printer.id)
          .maybeSingle()
      ).data
    : await currentClaimedJob(admin, printer.id);
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
  const code = url.searchParams.get('code') ?? '';
  // token 無し（旧ファーム）は GET で渡した「最も古い claimed ジョブ」を確定する
  const jobToken = url.searchParams.get('token') ?? (await currentClaimedJob(admin, printer.id))?.id ?? null;
  if (!jobToken) return new NextResponse('no job to confirm', { status: 404 });

  // code は HTTP風の結果コード（"200" 等が成功）。数値化して2xxを成功とみなす。
  const numeric = parseInt(code, 10);
  const success = !code || (numeric >= 200 && numeric < 300);

  await finishJob(admin, printer.id, jobToken, success, success ? null : `code ${code}`);

  return new NextResponse('ok', { status: 200 });
}

/**
 * 何が来ているか分からないプリンタ（JSON でない本文）の直近の POST を店舗設定に残す（診断用・最大1件/プリンタ）。
 * 本文は 400 文字まで。個人情報は含まれない（プリンタの状態と ID だけ）。
 */
async function recordPollDiag(
  admin: Awaited<ReturnType<typeof resolvePrinter>>['admin'],
  storeId: string,
  printerId: string,
  request: Request,
  bodyText: string,
  kind: 'sdp' | 'non-json'
) {
  try {
    const { data } = await admin.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
    const settings = ((data?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const diag = ((settings.printerDiag as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
    diag[printerId] = {
      at: new Date().toISOString(),
      kind,
      method: request.method,
      contentType: request.headers.get('content-type'),
      userAgent: request.headers.get('user-agent'),
      body: bodyText.slice(0, 400),
    };
    await admin.from('store_settings').update({ settings: { ...settings, printerDiag: diag } }).eq('store_id', storeId);
  } catch {
    /* 診断だけなので失敗しても印刷には影響させない */
  }
}
