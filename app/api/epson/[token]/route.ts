import { NextResponse } from 'next/server';
import { resolvePrinter } from '@/lib/print-queue';
import { printerFinish, printerGetJob, printerPoll } from '@/lib/printing/cloudprnt-handler';
import { emptyServerDirectPrintResponse } from '@/lib/printing/server-direct-print-handler';

/**
 * EPSON Server Direct Print サーバーエンドポイント。
 * TM-m30III-H 等の TM インテリジェントプリンタが、このURL（末尾にプリンタ別トークン）へ
 * 一定間隔でPOSTし、印刷データを受け取って印字する。Star CloudPRNT と同じジョブキューを共有する。
 *
 *   POST ConnectionType=GetRequest  … 印刷要求。ジョブがあれば ePOS-Print XML を返す（無ければ空の応答）。
 *   POST ConnectionType=SetResponse … 印字結果の通知。ResponseFile に結果XMLが入る。
 *
 * Star 機（JSON でポーリング）がこの URL につながれていても、本文で見分けて CloudPRNT として動く
 * （GET ?token=/?type= と DELETE も受ける）。処理は lib/printing/cloudprnt-handler.ts と共有。
 * 認証はURLパスのトークン（printer_configs.cloudprnt_token）。プリンタ側のID/パスワード（Digest認証）は使わない。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });
  return printerPoll(admin, printer, request);
}

/**
 * GET は EPSON では疎通確認用（プリンタ設定画面の［Access Test］やブラウザで開いたとき）。
 * Star 機が ?token= / ?type= 付きでジョブ本文を取りに来たときは CloudPRNT として返す。
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.has('token') || url.searchParams.has('type')) return printerGetJob(admin, printer, request);
  return emptyServerDirectPrintResponse();
}

export async function DELETE(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });
  return printerFinish(admin, printer, request);
}
