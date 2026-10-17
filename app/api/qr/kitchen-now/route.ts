import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateKitchenJobsForStore } from '@/lib/print-queue';

/**
 * お客様QRの注文が入った直後に、キッチン機の伝票ジョブをその場で作る（2026-10-17 Ronnie「印刷が遅い。0秒で出るように」）。
 * 注文そのものは create_qr_order（DB）で済んでいて、ここは「待たずに伝票を作る」だけ。
 * 呼べるのは卓の QR を持っているお客様の画面なので、卓の QR（slug＋token）が合っていて、
 * その卓に今の注文（未会計）があるときだけ動く。失敗・不正でも注文には影響しない（プリンターの問い合わせで作られる）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { slug?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 120) : '';
  const token = typeof body.token === 'string' ? body.token.slice(0, 200) : '';
  if (!slug || !token) return NextResponse.json({ ok: false }, { status: 400 });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: true, made: 0 });
  }
  const { data: table } = await admin
    .from('restaurant_tables')
    .select('id, store_id, qr_token, stores!inner(slug)')
    .eq('qr_token', token)
    .eq('status', 'active')
    .maybeSingle();
  const store = (table?.stores ?? null) as unknown as { slug: string | null } | null;
  if (!table || !store || store.slug !== slug) return NextResponse.json({ ok: false }, { status: 404 });

  // その卓に今の注文があるときだけ（関係のない呼び出しで動かさない）
  const { data: open } = await admin
    .from('orders')
    .select('id')
    .eq('table_id', table.id)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();
  if (!open) return NextResponse.json({ ok: true, made: 0 });

  const made = await generateKitchenJobsForStore(admin, table.store_id as string);
  return NextResponse.json({ ok: true, made });
}
