import { NextResponse } from 'next/server';
import { serverDirectPrintResponse, parsePrintResultXml } from '@/lib/epos-print';
import {
  claimNextJob,
  expireStaleJobs,
  finishJob,
  generateKitchenJobs,
  reclaimStaleJobs,
  resolvePrinter,
  touchPrinter,
  type JobPayload,
} from '@/lib/print-queue';

/**
 * EPSON Server Direct Print サーバーエンドポイント。
 * TM-m30III-H 等の TM インテリジェントプリンタが、このURL（末尾にプリンタ別トークン）へ
 * 一定間隔でPOSTし、印刷データを受け取って印字する。Star CloudPRNT と同じジョブキューを共有する。
 *
 *   POST ConnectionType=GetRequest  … 印刷要求。ジョブがあれば ePOS-Print XML を返す（無ければ空の応答）。
 *   POST ConnectionType=SetResponse … 印字結果の通知。ResponseFile に結果XMLが入る。
 *
 * 認証はURLパスのトークン（printer_configs.cloudprnt_token）。プリンタ側のID/パスワード（Digest認証）は
 * 使わない（同じトークンでStar機と同様に運用するため）。サービスロールでRLSを跨ぐが、扱うのは
 * 「そのプリンタ宛てのジョブ」だけに限定する。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const XML_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8' };

/** 空の応答（印刷するものが無いとき）。プリンタは次の間隔まで待つ。 */
function emptyResponse() {
  return new NextResponse(serverDirectPrintResponse(null), { status: 200, headers: XML_HEADERS });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });

  // 本文は application/x-www-form-urlencoded（ConnectionType / ID / ResponseFile）。
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    form = new URLSearchParams();
  }
  const connectionType = form.get('ConnectionType') ?? 'GetRequest';

  // 印字結果の通知
  if (connectionType === 'SetResponse') {
    const result = parsePrintResultXml(form.get('ResponseFile') ?? '');
    if (result.jobId) {
      await finishJob(admin, printer.id, result.jobId, result.success, result.code);
    }
    await touchPrinter(admin, printer.id);
    return new NextResponse('', { status: 200 });
  }

  await touchPrinter(admin, printer.id);
  await expireStaleJobs(admin, printer.id);
  await reclaimStaleJobs(admin, printer.id);

  if (printer.usage === 'kitchen') await generateKitchenJobs(admin, printer);

  const job = await claimNextJob(admin, printer.id);
  if (!job) return emptyResponse();

  const xml = (job.payload as JobPayload | null)?.epos;
  if (!xml) {
    // EPSON用の表現を持たないジョブ（Star専用に積まれた古いジョブ）は、このプリンタでは印字できない。
    await finishJob(admin, printer.id, job.id, false, 'EPSON用の印刷データがありません');
    return emptyResponse();
  }

  return new NextResponse(serverDirectPrintResponse({ id: job.id, xml }), { status: 200, headers: XML_HEADERS });
}

/**
 * GET は疎通確認用。プリンタ設定画面の［Access Test］や、ブラウザでURLを開いたときに
 * 「このURLは正しい」と分かるようにしておく（印刷はしない）。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });
  return emptyResponse();
}
