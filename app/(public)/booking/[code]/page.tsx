import type { Metadata } from 'next';
import { BookingLookup } from '@/components/booking/booking-lookup';

export const metadata: Metadata = { title: 'ご予約の確認・キャンセル' };

export default async function BookingLookupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <BookingLookup code={decodeURIComponent(code)} />;
}
