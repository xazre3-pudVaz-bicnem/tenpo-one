import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MapPin, Phone } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { BookingWizard } from '@/components/booking/booking-wizard';
import type { BookingStore } from '@/components/booking/types';

interface PageParams {
  params: Promise<{ storeSlug: string }>;
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
    description: `${store.name}のオンライン予約はこちらから。日時・人数を選んですぐにご予約いただけます。`,
  };
}

export default async function BookStorePage({ params }: PageParams) {
  const { storeSlug } = await params;
  const store = await fetchStore(storeSlug);
  if (!store) notFound();

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <div className="mb-6 text-center">
        <h1 className="text-lg font-bold text-navy">{store.name}のご予約</h1>
        <div className="mt-2 space-y-1 text-xs text-gray-500">
          {store.address && (
            <p className="flex items-center justify-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {store.address}
            </p>
          )}
          {store.phone && (
            <p className="flex items-center justify-center gap-1">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              {store.phone}
            </p>
          )}
        </div>
        {store.description && <p className="mt-3 text-sm text-gray-600">{store.description}</p>}
      </div>

      <BookingWizard store={store} />
    </div>
  );
}
