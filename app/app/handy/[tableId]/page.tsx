import { redirect } from 'next/navigation';

/** 旧URL（/app/handy/[tableId]）は全画面ハンディへ送る */
export default async function HandyTableRedirectPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  redirect(`/handy/${tableId}`);
}
