import { NextResponse } from 'next/server';
import { ingestGourmetMail, type InboundMail } from '@/lib/gourmet-mail-server';

/**
 * グルメサイトの予約通知メールの受け口（2026-09-27 Ronnie）。
 *
 * メール受信サービス（Postmark Inbound / SendGrid Inbound Parse / Mailgun Routes / Cloudflare Email Worker など）が
 * rsv-<token>@<INBOUND_MAIL_DOMAIN> に届いたメールをここへ POST する。
 *   認証: ヘッダー x-inbound-secret（または ?secret=）が INBOUND_MAIL_SECRET と一致すること
 *   形式: JSON（Postmark 形式・汎用 {to, from, subject, text, html}）か multipart/form-data（SendGrid・Mailgun）
 * 取り込みの成否にかかわらず 200 を返す（受信サービスに再送させない。中身は gourmet_mail_imports に残る）。
 */
export const runtime = 'nodejs';

function authorized(request: Request): boolean {
  const secret = process.env.INBOUND_MAIL_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const given = request.headers.get('x-inbound-secret') ?? url.searchParams.get('secret') ?? '';
  return given === secret;
}

function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/** 受信サービスごとの形の違いを吸収する */
function toInbound(o: Record<string, unknown>): InboundMail {
  // Postmark: FromFull.Email / ToFull[].Email / Subject / TextBody / HtmlBody / MessageID / Date
  const toFull = Array.isArray(o.ToFull) ? (o.ToFull as { Email?: string }[]).map((t) => t.Email ?? '') : [];
  const ccFull = Array.isArray(o.CcFull) ? (o.CcFull as { Email?: string }[]).map((t) => t.Email ?? '') : [];
  const fromFull = (o.FromFull as { Email?: string; Name?: string } | undefined)?.Email;
  const recipients = [
    ...toFull,
    ...ccFull,
    pick(o, ['to', 'To', 'recipient', 'envelope_to', 'OriginalRecipient', 'delivered_to', 'Delivered-To']) ?? '',
  ].filter(Boolean);
  return {
    to: recipients.length ? recipients : (pick(o, ['to', 'To']) ?? ''),
    from: fromFull ?? pick(o, ['from', 'From', 'sender', 'Sender']),
    subject: pick(o, ['subject', 'Subject']),
    text: pick(o, ['text', 'TextBody', 'body-plain', 'stripped-text', 'plain']),
    html: pick(o, ['html', 'HtmlBody', 'body-html', 'stripped-html']),
    messageId: pick(o, ['MessageID', 'message_id', 'Message-Id', 'messageId', 'Message-ID']),
    receivedAt: null,
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
