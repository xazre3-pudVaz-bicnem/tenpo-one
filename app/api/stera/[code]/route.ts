import { NextResponse } from 'next/server';
import { claimNextSteraRequest, recordSteraResult, resolveSteraTerminal } from '@/lib/stera-server';

/**
 * stera 端末の「TENPO ONE 連携」アプリ（android/stera-link）用の API。
 * 認証は URL のリンクコード（stera_terminals.link_code。設定 > 決済・端末 で発行）。
 *   GET  … 1〜2秒ごとのポーリング。待っている決済依頼があれば1件返す（無ければ request: null）
 *   POST … 決済アプリの結果を返す { id, outcome: SUCCESS|FAIL|CANCEL, resultCode, extras }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { admin, terminal } = await resolveSteraTerminal(code);
  if (!terminal) return NextResponse.json({ ok: false, error: 'TERMINAL_NOT_FOUND' }, { status: 404, headers: noStore });

  const version = new URL(request.url).searchParams.get('v');
  const req = await claimNextSteraRequest(admin, terminal, version);
  const { data: store } = await admin.from('stores').select('name').eq('id', terminal.store_id).maybeSingle();

  return NextResponse.json(
    {
      ok: true,
      terminal: { name: terminal.name, storeName: (store?.name as string | undefined) ?? null },
      request: req
        ? {
            id: req.id,
            // Intent の extras はすべて文字列（公開仕様）
            transactionMode: '1',
            transactionType: '1',
            amount: String(req.amount),
            tax: String(req.tax),
            paymentType: req.payment_type,
            slipNumber: req.slip_number,
          }
        : null,
    },
    { headers: noStore }
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { admin, terminal } = await resolveSteraTerminal(code);
  if (!terminal) return NextResponse.json({ ok: false, error: 'TERMINAL_NOT_FOUND' }, { status: 404, headers: noStore });

  let body: { id?: unknown; outcome?: unknown; resultCode?: unknown; extras?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400, headers: noStore });
  }
  const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ ok: false, error: 'BAD_ID' }, { status: 400, headers: noStore });

  const extras = body.extras && typeof body.extras === 'object' ? (body.extras as Record<string, unknown>) : {};
  const resultCode = typeof body.resultCode === 'number' || typeof body.resultCode === 'string' ? body.resultCode : null;
  const saved = await recordSteraResult(admin, terminal, id, {
    outcome: typeof body.outcome === 'string' ? body.outcome : '',
    resultCode,
    extras,
  });
  return NextResponse.json(saved, { status: saved.ok ? 200 : 400, headers: noStore });
}
