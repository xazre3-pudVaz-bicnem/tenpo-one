import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseQrGuestCounts } from '@/lib/qr-visit';
import { applyQrGuests } from '@/lib/qr-visit-server';

/**
 * お客様QRで最初の注文を送ったあと、最初の画面で選んだ人数（女性・男性）を伝票に入れる（2026-10-17 Ronnie）。
 * 伝票はここでは開かない（人数を選んだだけで卓が ¥0 で着席にならないように。伝票は create_qr_order が開く）。
 * 卓の QR（slug＋token）が合っていて、その卓の伝票がお客様の QR で開いたもので、まだ人数の内訳が無いときだけ入れる。
 * 失敗しても注文には影響しない。
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
    const result = await applyQrGuests(createAdminClient(), slug, token, guests);
    if (!result.ok) return NextResponse.json({ ok: false }, { status: 404 });
    return NextResponse.json({ ok: true, applied: result.applied });
  } catch (e) {
    console.error('[qr/start] failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
