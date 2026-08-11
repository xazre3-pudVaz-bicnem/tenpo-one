import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { QrOrderApp, type ReservedCourse } from '@/components/qr-order/qr-order-app';
import type { QrMenuData } from '@/components/qr-order/types';

interface PageParams {
  params: Promise<{ storeSlug: string; tableToken: string }>;
}

async function fetchMenu(storeSlug: string, tableToken: string): Promise<QrMenuData | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_qr_menu', { p_slug: storeSlug, p_token: tableToken });
  return (data as QrMenuData | null) ?? null;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { storeSlug, tableToken } = await params;
  const menu = await fetchMenu(storeSlug, tableToken);
  return {
    title: menu ? `${menu.store_name}｜${menu.table_name}のご注文` : 'ご注文',
    // テーブル固有の非公開URLのため検索エンジンには出さない
    robots: { index: false, follow: false },
  };
}

export default async function QrOrderPage({ params }: PageParams) {
  const { storeSlug, tableToken } = await params;
  const supabase = await createClient();
  const [{ data: menu }, { data: reservedCourse }] = await Promise.all([
    supabase.rpc('get_qr_menu', { p_slug: storeSlug, p_token: tableToken }),
    supabase.rpc('get_qr_reserved_course', { p_slug: storeSlug, p_token: tableToken }),
  ]);
  if (!menu) notFound();

  return (
    <QrOrderApp
      storeSlug={storeSlug}
      tableToken={tableToken}
      menu={menu as QrMenuData}
      reservedCourse={(reservedCourse as ReservedCourse | null) ?? null}
    />
  );
}
