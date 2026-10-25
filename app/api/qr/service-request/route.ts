import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendPushToStore, vapidConfigured } from '@/lib/push-server';
import { apnsConfigured, sendNativePushToStore } from '@/lib/apns-server';
import { serviceCallPushPayload } from '@/lib/service-call-alert';
import { formatQrServiceRequest, mergeQrServiceNote, qrServiceFrom, visibleQrServiceItems } from '@/lib/qr-service';
import { loadQrOrderFlag } from '@/lib/qr-order-flag-server';

/**
 * お客様QRの「サービス」（お水・お箸・取り皿交換など、無料で頼めるもの）を受ける
 * （2026-10-18 Ronnie「QR の最後に SERVICE ボタン。いまある仕組みで」）。
 *
 * 1. 卓の QR（slug＋token）を確かめ、お店の一覧（store_settings.settings.qrService）にある名前・数だけを
 *    「お水×2・お箸×2」の1行にする（QR から勝手な文字を送らせない）
 * 2. スタッフ呼び出しを作る（create_qr_service_call。利用中の卓か・1分5件までの制限・同じ卓の未対応は1件、はDB側）
 * 3. 呼び出しの note に足す（まだ対応していない呼び出しにもう一度頼まれたら「／」でつなぐ。300文字まで）
 * 4. お店のハンディ・レジへ通知（Push）。画面の鈴・バナーは service_calls の Realtime で出る
 * 注文（伝票・厨房伝票・お会計）には入らない。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  let body: { slug?: unknown; token?: unknown; lines?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'INVALID_REQUEST');
  }
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 120) : '';
  const token = typeof body.token === 'string' ? body.token.slice(0, 200) : '';
  if (!slug || !token) return fail(400, 'INVALID_REQUEST');

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return fail(500, 'UNAVAILABLE');
  }

  const { data: table } = await admin
    .from('restaurant_tables')
    .select('id, name, store_id, stores!inner(slug, organization_id)')
    .eq('qr_token', token)
    .eq('stores.slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  if (!table) return fail(404, 'TABLE_NOT_FOUND');

  // テーブルQR を店舗ごとに止めている（コントロールセンター）店舗は受け付けない
  const orgId = (table.stores as unknown as { organization_id?: string } | null)?.organization_id;
  if (orgId) {
    const flag = await loadQrOrderFlag(orgId, table.store_id as string, admin);
    if (flag.reason === 'store_off') return fail(403, 'QR_DISABLED');
  }

  const { data: settingsRow } = await admin
    .from('store_settings')
    .select('settings')
    .eq('store_id', table.store_id as string)
    .maybeSingle();
  const items = visibleQrServiceItems(qrServiceFrom((settingsRow as { settings?: unknown } | null)?.settings ?? null));
  const text = formatQrServiceRequest(body.lines, items);
  if (!text) return fail(400, 'INVALID_REQUEST');

  // 呼び出しの作成はお客様と同じ RPC（anon でも呼べる。利用中か・連打の制限は DB 側で見る）
  const supabase = await createClient();
  const { data: created, error } = await supabase.rpc('create_qr_service_call', {
    p_slug: slug,
    p_token: token,
    p_kind: 'staff',
  });
  const createdCall = created as { id?: string; created_at?: string } | null;
  if (error || !createdCall?.id) return fail(400, error?.message ?? 'CALL_FAILED');

  const { data: call } = await admin
    .from('service_calls')
    .select('id, note, status, table_id')
    .eq('id', createdCall.id)
    .maybeSingle();
  if (!call || call.table_id !== table.id || call.status !== 'open') return fail(409, 'CALL_FAILED');
  const note = mergeQrServiceNote(call.note as string | null, text);
  if (note === null) return fail(429, 'RATE_LIMITED');
  const { error: updateError } = await admin
    .from('service_calls')
    .update({ note })
    .eq('id', call.id as string)
    .eq('status', 'open');
  if (updateError) return fail(500, 'CALL_FAILED');

  if (vapidConfigured() || apnsConfigured()) {
    const payload = serviceCallPushPayload({
      tableName: table.name as string,
      kind: 'staff',
      callId: call.id as string,
      detail: text,
      seq: note.length,
    });
    try {
      await Promise.all([
        sendPushToStore(table.store_id as string, payload),
        sendNativePushToStore(table.store_id as string, { ...payload, sound: 'bell', timeSensitive: true }, ['regi', 'handy']),
      ]);
    } catch (e) {
      console.error('[qr-service] push failed', e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, call: { id: call.id, created_at: createdCall.created_at ?? '' } });
}
