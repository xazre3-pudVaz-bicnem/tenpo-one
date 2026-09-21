import { redirect } from 'next/navigation';

/** 旧URL（/app/handy/[tableId]/order?order=…）は全画面ハンディへ送る */
export default async function HandyOrderRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  const { tableId } = await params;
  const { order } = await searchParams;
  redirect(order ? `/handy/${tableId}/order?order=${encodeURIComponent(order)}` : `/handy/${tableId}`);
}
