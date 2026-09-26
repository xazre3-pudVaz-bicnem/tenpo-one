import { NextResponse } from 'next/server';
import { resolvePrinter } from '@/lib/print-queue';
import { printerFinish, printerGetJob, printerPoll } from '@/lib/printing/cloudprnt-handler';

/**
 * Star CloudPRNT サーバーエンドポイント。
 * mC-Print3 等のプリンタが、このURL（末尾にプリンタ別トークン）を定期ポーリングして印刷ジョブを取得する。
 * 処理の中身は lib/printing/cloudprnt-handler.ts（EPSON 用 /api/epson/[token] と共有。
 * どちらの URL にどちらのメーカーの機械がつながれても動く）。
 * 認証はURLパスのトークン（printer_configs.cloudprnt_token）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return NextResponse.json({ jobReady: false }, { status: 404 });
  return printerPoll(admin, printer, request);
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });
  return printerGetJob(admin, printer, request);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, printer } = await resolvePrinter(token);
  if (!printer) return new NextResponse('not found', { status: 404 });
  return printerFinish(admin, printer, request);
}
