import 'server-only';
import { NextResponse } from 'next/server';
import { serverDirectPrintResponse, parsePrintResultXml, jobIdFromSdp } from '@/lib/epos-print';
import {
  claimNextJob,
  expireStaleJobs,
  finishJob,
  generateKitchenJobs,
  generateQrBillJobs,
  reclaimStaleJobs,
  touchPrinter,
  type JobPayload,
  type PrinterRow,
} from '@/lib/print-queue';
import type { createAdminClient } from '@/lib/supabase/admin';

export { looksLikeServerDirectPrint } from '@/lib/printing/server-direct-print-detect';

type Admin = ReturnType<typeof createAdminClient>;

const XML_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8' };

/** 空の応答（印刷するものが無いとき＝本文なし・Content-Length: 0）。プリンタは次の間隔まで待つ。 */
export function emptyServerDirectPrintResponse() {
  return new NextResponse('', { status: 200, headers: { ...XML_HEADERS, 'Content-Length': '0' } });
}

/**
 * EPSON Server Direct Print の1回分の処理。
 * /api/epson/[token] から呼ぶほか、EPSON機が誤って Star 用の /api/cloudprnt/[token] に
 * つながれたときも（本文で見分けて）ここで受ける。2026-09-26 FOGO 新宿のドリンク機で、
 * ジョブが「払い出し済み」のまま印字されない原因がこれだった。
 */
export async function handleServerDirectPrint(admin: Admin, printer: PrinterRow, bodyText: string): Promise<NextResponse> {
  const form = new URLSearchParams(bodyText);
  const connectionType = form.get('ConnectionType') ?? 'GetRequest';

  // 印字結果の通知
  if (connectionType === 'SetResponse') {
    const result = parsePrintResultXml(form.get('ResponseFile') ?? '');
    const jobId = jobIdFromSdp(result.jobId);
    if (jobId) {
      await finishJob(admin, printer.id, jobId, result.success, result.code);
    }
    await touchPrinter(admin, printer.id);
    return new NextResponse('', { status: 200 });
  }

  await touchPrinter(admin, printer.id);
  await expireStaleJobs(admin, printer.id);
  await reclaimStaleJobs(admin, printer.id);

  if (printer.usage === 'kitchen') await generateKitchenJobs(admin, printer);
  // レシート機と「会計伝票も出す」厨房（ドリンク）機（関数の中で判定する）
  await generateQrBillJobs(admin, printer);

  const job = await claimNextJob(admin, printer.id);
  if (!job) return emptyServerDirectPrintResponse();

  const xml = (job.payload as JobPayload | null)?.epos;
  if (!xml) {
    // EPSON用の表現を持たないジョブ（Star専用に積まれた古いジョブ）は、このプリンタでは印字できない。
    await finishJob(admin, printer.id, job.id, false, 'EPSON用の印刷データがありません');
    return emptyServerDirectPrintResponse();
  }

  const body = serverDirectPrintResponse({ id: job.id, xml });
  return new NextResponse(body, {
    status: 200,
    headers: { ...XML_HEADERS, 'Content-Length': String(Buffer.byteLength(body, 'utf8')) },
  });
}
