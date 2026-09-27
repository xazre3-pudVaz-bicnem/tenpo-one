import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendPushToStore, vapidConfigured } from '@/lib/push-server';
import { isFreshCall, serviceCallPushPayload } from '@/lib/service-call-alert';

/**
 * お客様QRの「スタッフ呼び出し／お会計」を、お店の端末（ハンディ iPhone・レジ iPad）へ通知（Push）で送る
 * （2026-09-28 Ronnie「呼び出しでハンディを振動させる」）。iPhone は画面が消えていても通知で震える（ホーム画面に追加した
 * ハンディで通知をオンにしたとき）。呼び出し自体は create_qr_service_call（DB）で済んでいて、ここは知らせるだけ。
 *
 * 呼べるのは QR を持っているお客様の画面なので、卓の QR（slug＋token）と呼び出しの id が合っていて、
 * まだ未対応で、作ってから 90 秒以内のものだけ送る（同じ呼び出しを何度も送らない）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: { slug?: unknown; token?: unknown; callId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 120) : '';
  const token = typeof body.token === 'string' ? body.token.slice(0, 200) : '';
  const callId = typeof body.callId === 'string' ? body.callId : '';
  if (!slug || !token || !UUID.test(callId)) return NextResponse.json({ ok: false }, { status: 400 });
  if (!vapidConfigured()) return NextResponse.json({ ok: true, sent: 0, reason: 'push-not-configured' });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: true, sent: 0 });
  }
  const { data: call } = await admin
    .from('service_calls')
    .select('id, kind, status, created_at, store_id, restaurant_tables!inner(name, qr_token), stores!inner(slug)')
    .eq('id', callId)
    .maybeSingle();
  if (!call) return NextResponse.json({ ok: false }, { status: 404 });
  const table = call.restaurant_tables as unknown as { name: string; qr_token: string | null } | null;
  const store = call.stores as unknown as { slug: string | null } | null;
  if (!table || table.qr_token !== token || !store || store.slug !== slug) return NextResponse.json({ ok: false }, { status: 404 });
  if (call.status !== 'open' || !isFreshCall(call.created_at as string, Date.now())) return NextResponse.json({ ok: true, sent: 0 });

  const result = await sendPushToStore(
    call.store_id as string,
    serviceCallPushPayload({ tableName: table.name, kind: call.kind === 'checkout' ? 'checkout' : 'staff', callId: call.id as string })
  );
  return NextResponse.json({ ok: true, sent: result.sent });
}
