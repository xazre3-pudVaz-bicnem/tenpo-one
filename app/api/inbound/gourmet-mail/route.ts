import { NextResponse } from 'next/server';
import { ingestGourmetMail } from '@/lib/gourmet-mail-server';
import { toInbound } from '@/lib/inbound-mail-parse';
import { clientIp, isForwardEmailIp } from '@/lib/forwardemail-verify';

/**
 * グルメサイトの予約通知メールの受け口（2026-09-27 Ronnie）。
 *
 * メール受信サービス（Forward Email〔無料〕/ Postmark Inbound / SendGrid Inbound Parse / Mailgun Routes / Cloudflare Email Worker など）が
 * rsv-<token>@<INBOUND_MAIL_DOMAIN> に届いたメールをここへ POST する。
 *   認証: authorized()（合言葉、または Forward Email の送り元 IP）
 *   形式: JSON（Postmark 形式・Forward Email の mailparser 形式・汎用 {to, from, subject, text, html}）か multipart/form-data（SendGrid・Mailgun）。
 *         形の違いは lib/inbound-mail-parse.ts でそろえる
 * 取り込みの成否にかかわらず 200 を返す（受信サービスに再送させない。中身は gourmet_mail_imports に残る）。
 */
export const runtime = 'nodejs';

/**
 * 受け取ってよい送り元か。
 *   - 合言葉：ヘッダー x-inbound-secret（または ?secret=）が INBOUND_MAIL_SECRET と一致
 *   - Forward Email（無料。?via=forwardemail）：送り元の IP が forwardemail.net（逆引き＋引き直し）。
 *     無料プランは URL が DNS で誰でも見えるので合言葉は使わず IP で確かめる（2026-10-19 Ronnie「お金のかからない方法」）
 */
async function authorized(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  const secret = process.env.INBOUND_MAIL_SECRET;
  const given = request.headers.get('x-inbound-secret') ?? url.searchParams.get('secret') ?? '';
  if (secret && given === secret) return true;
  if (url.searchParams.get('via') === 'forwardemail') return isForwardEmailIp(clientIp(request));
  return false;
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let payload: Record<string, unknown> = {};
  const ct = request.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) {
      payload = (await request.json()) as Record<string, unknown>;
    } else if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      for (const [k, v] of form.entries()) if (typeof v === 'string') payload[k] = v;
      // SendGrid の envelope（JSON 文字列）に宛先が入る
      if (typeof payload.envelope === 'string') {
        try {
          const env = JSON.parse(payload.envelope) as { to?: string[] };
          if (Array.isArray(env.to)) payload.ToFull = env.to.map((e) => ({ Email: e }));
        } catch {
          /* 無視 */
        }
      }
    } else {
      payload = { text: await request.text() };
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad body' }, { status: 200 });
  }

  const result = await ingestGourmetMail(toInbound(payload));
  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'gourmet-mail inbound' });
}
