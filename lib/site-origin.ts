import 'server-only';
import { headers } from 'next/headers';

/** リクエストの origin（本番は NEXT_PUBLIC_SITE_URL を優先）。QR など外に出す URL に使う */
export async function resolveSiteOrigin(): Promise<string> {
  const headerList = await headers();
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${headerList.get('x-forwarded-proto') ?? 'https'}://${headerList.get('host')}`
  );
}
