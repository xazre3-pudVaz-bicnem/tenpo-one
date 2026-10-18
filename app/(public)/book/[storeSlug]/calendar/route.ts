import { createClient } from '@/lib/supabase/server';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { icsText, parseVisitParams } from '@/lib/booking-calendar';
import type { BookingStore } from '@/components/booking/types';

/**
 * ご予約完了ページの「iPhone・Outlook のカレンダーに追加」（.ics）。2026-10-19 Ronnie。
 * 予約の中身は URL（code・d・t・m・n）から作る（お客様が見ている完了ページと同じ値）。お店の名前・住所はサーバーから。
 */
export async function GET(request: Request, { params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;
  const sp = new URL(request.url).searchParams;
  const visit = parseVisitParams({ d: sp.get('d') ?? undefined, t: sp.get('t') ?? undefined, m: sp.get('m') ?? undefined, n: sp.get('n') ?? undefined });
  const code = (sp.get('code') ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 32);
  if (!visit) return new Response('日時が正しくありません', { status: 400 });

  const supabase = await createClient();
  const { data } = await supabase.rpc('get_booking_store', { p_slug: storeSlug });
  const store = (data as BookingStore | null) ?? null;
  if (!store) return new Response('お店が見つかりません', { status: 404 });

  const origin = await resolveSiteOrigin();
  const body = icsText({
    ...visit,
    uid: `${code || `${visit.date}-${visit.time}`}@${storeSlug}.tenpo-one.com`,
    title: `${store.name} ご予約${visit.party ? `（${visit.party}名）` : ''}`,
    location: store.address,
    details: [
      code ? `予約コード ${code}` : null,
      code ? `ご予約の確認・キャンセル ${origin}/booking/${code}` : null,
      store.phone ? `電話 ${store.phone}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="reservation-${code || visit.date}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
