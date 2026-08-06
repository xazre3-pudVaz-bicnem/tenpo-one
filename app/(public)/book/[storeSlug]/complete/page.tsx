import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import type { BookingStore } from '@/components/booking/types';

interface PageProps {
  params: Promise<{ storeSlug: string }>;
  searchParams: Promise<{ code?: string }>;
}

export const metadata: Metadata = { title: 'ご予約完了' };

export default async function BookingCompletePage({ params, searchParams }: PageProps) {
  const { storeSlug } = await params;
  const { code } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase.rpc('get_booking_store', { p_slug: storeSlug });
  const store = (data as BookingStore | null) ?? null;
  if (!store) notFound();

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

      {code && (
        <Link
          href={`/booking/${encodeURIComponent(code)}`}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg border border-gray-300 text-sm font-semibold text-navy"
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
