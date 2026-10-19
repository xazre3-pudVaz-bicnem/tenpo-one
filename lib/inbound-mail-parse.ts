import type { InboundMail } from '@/lib/gourmet-mail-server';

/**
 * メール受信サービスごとの形の違いをそろえる（グルメサイトの予約メールの受け口 /api/inbound/gourmet-mail）。
 *   - Postmark：FromFull.Email / ToFull[].Email / Subject / TextBody / HtmlBody / MessageID
 *   - SendGrid・Mailgun：フォーム形式（to / from / subject / text / html / recipient / body-plain …）
 *   - Forward Email（無料。2026-10-19 Ronnie「お金のかからない方法」）：mailparser の JSON
 *       from / to / cc は { value: [{ address, name }], text }、宛先は session.recipient / recipients
 *   - 汎用：{ to, from, subject, text, html }
 */

type Obj = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** 文字・{ value: [{ address }] }・{ text }・それらの配列 → メールアドレスの並び */
export function addressList(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === 'string') return v.trim() ? [v] : [];
  if (Array.isArray(v)) return v.flatMap((x) => addressList(x));
  if (typeof v === 'object') {
    const o = v as Obj;
    if (typeof o.address === 'string') return o.address ? [o.address] : [];
    if (typeof o.Email === 'string') return o.Email ? [o.Email] : [];
    if (Array.isArray(o.value)) return addressList(o.value);
    if (typeof o.text === 'string') return o.text ? [o.text] : [];
  }
  return [];
}

function pick(o: Obj, keys: string[]): string | null {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return null;
}

export function toInbound(o: Obj): InboundMail {
  const session = (o.session && typeof o.session === 'object' ? (o.session as Obj) : {}) as Obj;
  const recipients = [
    ...addressList(o.ToFull),
    ...addressList(o.CcFull),
    ...addressList(session.recipient),
    ...addressList(o.recipients),
    ...addressList(o.to),
    ...addressList(o.To),
    ...addressList(o.cc),
    ...[pick(o, ['recipient', 'envelope_to', 'OriginalRecipient', 'delivered_to', 'Delivered-To'])].filter((x): x is string => !!x),
  ];
  const uniqueRecipients = [...new Set(recipients)];
  const from = addressList(o.FromFull)[0] ?? addressList(o.from)[0] ?? pick(o, ['From', 'sender', 'Sender']);
  return {
    to: uniqueRecipients.length > 0 ? uniqueRecipients : '',
    from: from ?? null,
    subject: pick(o, ['subject', 'Subject']),
    text: pick(o, ['text', 'TextBody', 'body-plain', 'stripped-text', 'plain']),
    // Forward Email は html が false のことがある（テキストだけのメール）
    html: pick(o, ['html', 'HtmlBody', 'body-html', 'stripped-html', 'textAsHtml']),
    messageId: pick(o, ['MessageID', 'messageId', 'message_id', 'Message-Id', 'Message-ID']),
    receivedAt: null,
  };
}
