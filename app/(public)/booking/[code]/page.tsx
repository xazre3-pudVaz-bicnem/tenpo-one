import type { Metadata } from 'next';
import { BookingLookup } from '@/components/booking/booking-lookup';

export const metadata: Metadata = { title: 'ご予約の確認・キャンセル' };

export default async function BookingLookupPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ paid?: string; payment?: string }>;
}) {
  const { code } = await params;
  const { paid, payment } = await searchParams;
  return (
    <BookingLookup
      code={decodeURIComponent(code)}
      paid={paid === '1'}
      paymentCancelled={payment === 'cancelled'}
    />
  );
}
