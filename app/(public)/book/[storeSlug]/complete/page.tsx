import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarPlus, CheckCircle2, MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import type { BookingStore } from '@/components/booking/types';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { googleCalendarUrl, googleMapsUrl, parseVisitParams } from '@/lib/booking-calendar';

interface PageProps {
  params: Promise<{ storeSlug: string }>;
  /** d・t・m・n は予約の日付・時刻・滞在（分）・人数（カレンダーに追加に使う。2026-10-19） */
  searchParams: Promise<{ code?: string; d?: string; t?: string; m?: string; n?: string }>;
}

export const metadata: Metadata = { title: 'ご予約完了' };

export default async function BookingCompletePage({ params, searchParams }: PageProps) {
  const { storeSlug } = await params;
  const sp = await searchParams;
  const { code } = sp;

  const supabase = await createClient();
  const { data } = await supabase.rpc('get_booking_store', { p_slug: storeSlug });
  const store = (data as BookingStore | null) ?? null;
  if (!store) notFound();

  // カレンダーに追加・Googleマップで見る（2026-10-19 Ronnie「QR から予約したあと、カレンダーに追加と Google マップへ」）
  const visit = parseVisitParams(sp);
  const origin = await resolveSiteOrigin();
  const title = `${store.name} ご予約${visit?.party ? `（${visit.party}名）` : ''}`;
  const details = [
    code ? `予約コード ${code}` : null,
    code ? `ご予約の確認・キャンセル ${origin}/booking/${code}` : null,
    store.phone ? `電話 ${store.phone}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const googleCal = visit ? googleCalendarUrl({ ...visit, title, location: store.address, details }) : null;
  const icsQuery = visit
    ? new URLSearchParams({ code: code ?? '', d: visit.date, t: visit.time, m: String(visit.minutes), ...(visit.party ? { n: String(visit.party) } : {}) }).toString()
    : null;
  const mapUrl = googleMapsUrl(store.name, store.address);
  const btn =
    'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-navy';

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
        <CheckCircle2 className="h-9 w-9 text-success" />
      </div>
      <h1 className="mt-5 text-lg font-bold text-navy">ご予約を承りました</h1>
      <p className="mt-2 text-sm text-gray-600">{store.name}にてお待ちしております。</p>

      {code && (
        <div className="mt-6 w-full rounded-xl border border-gray-200 bg-white px-6 py-5">
          <p className="text-xs font-medium text-gray-500">予約コード</p>
          <p className="mt-1 text-2xl font-bold tracking-wider text-primary-deep tabular-nums">{code}</p>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            予約コードは、ご予約内容の確認・変更・キャンセルの際に必要です。大切に保管してください。
          </p>
        </div>
      )}

      {/* カレンダーに追加（Google／iPhone・Outlook）と Googleマップ */}
      <div className="mt-6 grid w-full gap-2">
        {googleCal && icsQuery && (
          <details className="group w-full">
            <summary className={`${btn} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
              <CalendarPlus className="h-4 w-4" aria-hidden />
              カレンダーに追加
              <span className="text-xs font-medium text-gray-500">Add to Calendar</span>
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a href={googleCal} target="_blank" rel="noopener noreferrer" className={btn}>
                Googleカレンダー
              </a>
              <a href={`/book/${encodeURIComponent(storeSlug)}/calendar?${icsQuery}`} className={btn}>
                iPhone・その他
              </a>
            </div>
          </details>
        )}
        <a href={mapUrl} target="_blank" rel="noopener noreferrer" className={btn}>
          <MapPin className="h-4 w-4" aria-hidden />
          Googleマップで見る
          <span className="text-xs font-medium text-gray-500">Google Maps</span>
        </a>
      </div>

      {code && (
        <Link
          href={`/booking/${encodeURIComponent(code)}`}
          className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg border border-gray-300 text-sm font-semibold text-navy"
        >
          予約内容を確認・キャンセルする
        </Link>
      )}

      <Link href={`/book/${storeSlug}`} className="mt-4 text-xs text-gray-400 underline">
        別の予約をする
      </Link>
    </div>
  );
}
