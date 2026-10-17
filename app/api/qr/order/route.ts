import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createQrOrderWithOptions, QrOrderError, type QrOrderLineInput } from '@/lib/qr-order-server';

/**
 * お客様QR の注文（選択肢グループつき）。
 * データベースの create_qr_order が選択肢（option_item_ids）を知らない環境でも、レジと同じ検証で
 * 選択肢を明細に残して注文できるようにする（2026-10-17 MEAT CROWN 新横浜）。
 * 呼べるのは卓の QR（slug＋token）を持っているお客様の画面だけ。エラーコードは create_qr_order と同じ。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 20) : [];
}

export async function POST(request: Request) {
  let body: { slug?: unknown; token?: unknown; seatToken?: unknown; items?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_REQUEST' }, { status: 400 });
  }
  const slug = str(body.slug, 120);
  const token = str(body.token, 200);
  const seatToken = str(body.seatToken, 200) || null;
  if (!slug || !token) return NextResponse.json({ ok: false, error: 'TABLE_NOT_FOUND' }, { status: 400 });
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 31) : [];
  const items: QrOrderLineInput[] = rawItems.map((it) => {
    const r = (it ?? {}) as Record<string, unknown>;
    return {
      menu_item_id: str(r.menu_item_id, 64),
      quantity: Number(r.quantity ?? 1),
      memo: str(r.memo, 200) || null,
      modifier_ids: ids(r.modifier_ids),
      option_item_ids: ids(r.option_item_ids),
    };
  });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'ORDER_FAILED' }, { status: 500 });
  }
  try {
    const result = await createQrOrderWithOptions(admin, { slug, token, items, seatToken });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof QrOrderError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    console.error('[api/qr/order]', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'ORDER_FAILED' }, { status: 500 });
  }
}
