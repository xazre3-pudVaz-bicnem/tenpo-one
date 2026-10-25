import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { cloudprntPollSeconds, cloudprntServerSetting, isCloudprntToken } from '@/lib/cloudprnt-setting';

/**
 * Star CloudPRNT の「サーバー設定情報」（GET /api/cloudprnt/cloudprnt-setting.json?mac=...&replaced_path=<token>）。
 * 対応機は電源を入れたとき・10 分ごとにここを見て、問い合わせ間隔（設定 › プリンター の「問い合わせ間隔（秒）」、標準 1 秒）を使う。
 * 印刷のやり取り（POST/GET/DELETE）は今まで通り app/api/cloudprnt/[token]（ここは間隔を渡すだけで、印刷には触らない）。
 * 知らないトークンは 404 ＝プリンターは「HTTP だけのサーバー」として、今までの自分の設定のまま動く。
 * 詳しくは lib/cloudprnt-setting.ts。2026-10-25 Ronnie「aba bata default nai 1 sec」
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('replaced_path')?.trim();
  if (!isCloudprntToken(token)) return new NextResponse('not found', { status: 404 });

  const admin = createAdminClient();
  const { data } = await admin
    .from('printer_configs')
    .select('id, poll_interval_seconds')
    .eq('cloudprnt_token', token)
    .eq('cloudprnt_enabled', true)
    .eq('status', 'active')
    .maybeSingle();
  if (!data) return new NextResponse('not found', { status: 404 });

  const row = data as { id: string; poll_interval_seconds: number | null };
  return NextResponse.json(cloudprntServerSetting(cloudprntPollSeconds(row.poll_interval_seconds)), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
