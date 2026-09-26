import { NextResponse } from 'next/server';
import { resolvePrinter } from '@/lib/print-queue';
import { emptyServerDirectPrintResponse, handleServerDirectPrint } from '@/lib/printing/server-direct-print-handler';

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
 * 1回分の処理は lib/printing/server-direct-print-handler.ts（/api/cloudprnt と共有）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });

  // 本文は application/x-www-form-urlencoded（ConnectionType / ID / ResponseFile）。
  let bodyText = '';
  try {
    bodyText = await request.text();
  } catch {
    bodyText = '';
  }
  return handleServerDirectPrint(admin, printer, bodyText);
}

/**
 * GET は疎通確認用。プリンタ設定画面の［Access Test］や、ブラウザでURLを開いたときに
 * 「このURLは正しい」と分かるようにしておく（印刷はしない）。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });
  return emptyServerDirectPrintResponse();
}
