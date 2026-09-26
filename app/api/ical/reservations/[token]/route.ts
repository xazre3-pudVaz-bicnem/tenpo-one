import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildReservationsIcs, type IcalReservation } from '@/lib/reservation-book';

/**
 * 予約台帳の iCal 配信（Google カレンダー連携。2026-09-28 Ronnie）。
 * URL: /api/ical/reservations/<token>.ics — token は 設定 > 予約台帳設定 > Google連携 で発行（store_settings.settings.reservationBook.icalToken）。
 * 30 日前〜90 日先の予約（キャンセルも【取消】として残す）を返す。Google は 12〜24 時間ごとに読みに来る。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, '');
  if (!/^[a-f0-9]{16,64}$/i.test(token)) return new NextResponse('not found', { status: 404 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('store_settings')
    .select('store_id, stores(name)')
    .eq('settings->reservationBook->>icalToken', token)
    .maybeSingle();
  if (!row) return new NextResponse('not found', { status: 404 });
  const storeId = row.store_id as string;
  const storeRel = row.stores as { name: string } | { name: string }[] | null;
  const storeName = (Array.isArray(storeRel) ? storeRel[0]?.name : storeRel?.name) ?? 'TENPO ONE';

  const from = new Date(Date.now() - 30 * 86400000).toISOString();
  const to = new Date(Date.now() + 90 * 86400000).toISOString();
  const { data: rows } = await admin
    .from('reservations')
    .select('id, code, guest_name, party_size, start_at, end_at, status, memo, updated_at, reservation_sources(name), reservation_tables(restaurant_tables(name))')
    .eq('store_id', storeId)
    .gte('start_at', from)
    .lte('start_at', to)
    .order('start_at')
    .limit(2000);

  const items: IcalReservation[] = (rows ?? []).map((r) => {
    const src = r.reservation_sources as { name: string } | { name: string }[] | null;
    const tables = ((r.reservation_tables as { restaurant_tables: { name: string } | { name: string }[] | null }[] | null) ?? [])
      .map((t) => (Array.isArray(t.restaurant_tables) ? t.restaurant_tables[0]?.name : t.restaurant_tables?.name))
      .filter((n): n is string => !!n);
    return {
      id: r.id as string,
      code: r.code as string,
      guestName: r.guest_name as string,
      partySize: r.party_size as number,
      startAt: r.start_at as string,
      endAt: r.end_at as string,
      status: r.status as string,
      tableNames: tables,
      sourceName: (Array.isArray(src) ? src[0]?.name : src?.name) ?? null,
      note: (r.memo as string | null) ?? null,
      updatedAt: (r.updated_at as string | null) ?? null,
    };
  });

  return new NextResponse(buildReservationsIcs(storeName, items), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="reservations.ics"',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
