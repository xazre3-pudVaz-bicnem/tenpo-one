import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { discardUntouchedOrder } from '@/lib/discard-untouched-order';

/**
 * 注文画面を閉じた（タブを閉じた・ホームへ戻った）ときに navigator.sendBeacon で呼ぶ。
 * 品を入れていない伝票だけ取消して卓を空席に戻す（lib/discard-untouched-order.ts）。
 */
export async function POST(request: Request) {
  let orderId = '';
  try {
    const body = (await request.json()) as { orderId?: string };
    orderId = typeof body.orderId === 'string' ? body.orderId : '';
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!orderId) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const ctx = await requireMember();
    const supabase = await createClient();
    const r = await discardUntouchedOrder(supabase, ctx, orderId);
    return NextResponse.json({ ok: r.discarded });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
