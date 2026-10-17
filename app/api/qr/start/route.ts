import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseQrGuestCounts } from '@/lib/qr-visit';
import { startQrVisit } from '@/lib/qr-visit-server';

/**
 * お客様QRの最初の画面で「人数を確定して、注文へ進む」を押したとき（2026-10-17 Ronnie）。
 * 卓の QR（slug＋token）が合っていれば伝票を開いて卓を着席にする。すでに伝票がある卓は何もしない。
 * 失敗してもお客様はそのまま注文へ進める（最初の注文で create_qr_order が伝票を開く）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { slug?: unknown; token?: unknown; female?: unknown; male?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 120) : '';
  const token = typeof body.token === 'string' ? body.token.slice(0, 200) : '';
  const guests = parseQrGuestCounts(body.female, body.male);
  if (!slug || !token || !guests) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    const result = await startQrVisit(createAdminClient(), slug, token, guests);
    if (!result.ok) return NextResponse.json({ ok: false }, { status: 404 });
    return NextResponse.json({ ok: true, started: result.started });
  } catch (e) {
    console.error('[qr/start] failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
