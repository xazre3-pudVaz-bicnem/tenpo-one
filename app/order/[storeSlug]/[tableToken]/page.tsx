import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { QrOrderApp, type ReservedCourse } from '@/components/qr-order/qr-order-app';
import type { QrMenuData } from '@/components/qr-order/types';
import { filterNestedMenu } from '@/lib/menu-book';
import { jstNowHm, loadQrMenuBook } from '@/lib/menu-book-server';

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
  const [{ data: menu }, { data: reservedCourse }, { book, plan }] = await Promise.all([
    supabase.rpc('get_qr_menu', { p_slug: storeSlug, p_token: tableToken }),
    supabase.rpc('get_qr_reserved_course', { p_slug: storeSlug, p_token: tableToken }),
    loadQrMenuBook(storeSlug, tableToken),
  ]);
  if (!menu) notFound();

  const course = (reservedCourse as ReservedCourse | null) ?? null;
  const qrMenu = menu as QrMenuData;
  // メニューブックで絞る：飲み放題・食べ放題・コースが伝票に無い卓には、その中身（F の0円商品など）を出さない。
  // 予約でコースが決まっている卓は、コースが伝票に入る前からプランありとして扱う
  const categories = filterNestedMenu(qrMenu.categories, book, {
    channel: 'qr',
    plan: course && !plan.hasPlan ? { hasPlan: true, planItemIds: [] } : plan,
    nowHm: jstNowHm(),
  });

  return (
    <QrOrderApp
      storeSlug={storeSlug}
      tableToken={tableToken}
      menu={{ ...qrMenu, categories }}
      reservedCourse={course}
    />
  );
}
