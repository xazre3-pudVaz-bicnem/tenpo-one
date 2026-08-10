import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MapPin, Phone, Clock, Info, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { BookingWizard } from '@/components/booking/booking-wizard';
import type { BookingStore, BookingBusinessHour } from '@/components/booking/types';

interface PageParams {
  params: Promise<{ storeSlug: string }>;
}

const WEEKDAY_LABEL = ['日', '月', '火', '水', '木', '金', '土'];

function hhmm(t: string | null): string {
  return t ? t.slice(0, 5) : '';
}

/** 営業時間を「曜日: 開店〜閉店（L.O. ラスト入店）」の行に整形。定休日は「定休日」。 */
function formatBusinessHours(rows: BookingBusinessHour[]): { label: string; value: string; closed: boolean }[] {
  const byDow = new Map(rows.map((r) => [r.day_of_week, r]));
  return Array.from({ length: 7 }, (_, dow) => {
    const r = byDow.get(dow);
    if (!r || r.is_closed || !r.open_time || !r.close_time) {
      return { label: WEEKDAY_LABEL[dow], value: '定休日', closed: true };
    }
    const lastEntry = r.last_entry_time ? `（最終入店 ${hhmm(r.last_entry_time)}）` : '';
    return { label: WEEKDAY_LABEL[dow], value: `${hhmm(r.open_time)}〜${hhmm(r.close_time)}${lastEntry}`, closed: false };
  });
}

async function fetchStore(storeSlug: string): Promise<BookingStore | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_booking_store', { p_slug: storeSlug });
  return (data as BookingStore | null) ?? null;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { storeSlug } = await params;
  const store = await fetchStore(storeSlug);
  if (!store) return { title: '店舗が見つかりません' };
  return {
    title: `${store.name}のご予約`,
    description: `${store.name}のオンライン予約はこちらから。日時・人数・コースを選んですぐにご予約いただけます。`,
    openGraph: store.photo_url ? { images: [{ url: store.photo_url }] } : undefined,
  };
}

export default async function BookStorePage({ params }: PageParams) {
  const { storeSlug } = await params;
  const store = await fetchStore(storeSlug);
  if (!store) notFound();

  const hours = formatBusinessHours(store.business_hours);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      {/* 店舗写真 */}
      {store.photo_url && (
        <div className="mb-5 overflow-hidden rounded-2xl">
          {/* 公開画像（同一オリジンまたはSupabase Storage）。CSP img-src の許可ホストのみ表示可 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={store.photo_url} alt={store.name} className="h-48 w-full object-cover" />
        </div>
      )}

      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold text-navy">{store.name}</h1>
        <p className="mt-1 text-sm font-medium text-primary">オンラインご予約</p>
        <div className="mt-3 space-y-1 text-xs text-gray-500">
          {store.address && (
            <p className="flex items-center justify-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {store.address}
            </p>
          )}
          {store.phone && (
            <p className="flex items-center justify-center gap-1">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <a href={`tel:${store.phone}`} className="hover:underline">{store.phone}</a>
            </p>
          )}
        </div>
        {store.description && <p className="mt-3 text-sm leading-relaxed text-gray-600">{store.description}</p>}
      </div>

      <BookingWizard store={store} />

      {/* 営業時間 */}
      <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-navy">
          <Clock className="h-4 w-4 text-primary" />
          営業時間
        </h2>
        <dl className="divide-y divide-gray-100 text-sm">
          {hours.map((h) => (
            <div key={h.label} className="flex items-center justify-between py-1.5">
              <dt className="w-8 font-medium text-gray-600">{h.label}</dt>
              <dd className={h.closed ? 'text-gray-400' : 'text-navy'}>{h.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 注意事項 */}
      {store.booking_notes && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy">
            <Info className="h-4 w-4 text-primary" />
            ご予約時の注意事項
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600">{store.booking_notes}</p>
        </section>
      )}

      {/* キャンセルポリシー */}
      {store.cancellation_policy && (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy">
            <AlertCircle className="h-4 w-4 text-warning" />
            キャンセルポリシー
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{store.cancellation_policy}</p>
        </section>
      )}
    </div>
  );
}
