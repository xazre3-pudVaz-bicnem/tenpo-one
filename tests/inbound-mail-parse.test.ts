import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { toInbound, addressList } from '@/lib/inbound-mail-parse';

/** グルメサイトのメールの受け口：受信サービスごとの形をそろえる（Forward Email は無料。2026-10-19 Ronnie） */
describe('メールの受け口：受信サービスの形', () => {
  it('Forward Email（mailparser の JSON）：宛先は session.recipient・本文・件名', () => {
    const m = toInbound({
      from: { value: [{ address: 'noreply@tabelog.com', name: '食べログ' }], text: '食べログ <noreply@tabelog.com>' },
      to: { value: [{ address: 'rsv-abc123@in.tenpo-one.com', name: '' }], text: 'rsv-abc123@in.tenpo-one.com' },
      subject: '【食べログ】ネット予約が入りました',
      text: '来店日時 2026年10月24日 19:00',
      html: false,
      messageId: '<x@tabelog.com>',
      session: { recipient: 'rsv-abc123@in.tenpo-one.com', sender: 'bounce@tabelog.com' },
      recipients: ['rsv-abc123@in.tenpo-one.com'],
    });
    expect(m.to).toEqual(['rsv-abc123@in.tenpo-one.com']);
    expect(m.from).toBe('noreply@tabelog.com');
    expect(m.subject).toBe('【食べログ】ネット予約が入りました');
    expect(m.text).toContain('2026年10月24日');
    expect(m.html).toBeNull();
    expect(m.messageId).toBe('<x@tabelog.com>');
  });

  it('Postmark と 汎用', () => {
    const p = toInbound({ FromFull: { Email: 'a@hotpepper.jp' }, ToFull: [{ Email: 'rsv-x@in.tenpo-one.com' }], Subject: 'S', TextBody: 'T', MessageID: 'id1' });
    expect(p).toMatchObject({ to: ['rsv-x@in.tenpo-one.com'], from: 'a@hotpepper.jp', subject: 'S', text: 'T', messageId: 'id1' });
    const g = toInbound({ to: 'rsv-y@in.tenpo-one.com', from: 'b@gnavi.co.jp', subject: 'S2', text: 'T2' });
    expect(g).toMatchObject({ to: ['rsv-y@in.tenpo-one.com'], from: 'b@gnavi.co.jp', subject: 'S2', text: 'T2' });
  });

  it('アドレスの並び', () => {
    expect(addressList([{ value: [{ address: 'a@x' }, { address: 'b@x' }] }, 'c@x'])).toEqual(['a@x', 'b@x', 'c@x']);
    expect(addressList(null)).toEqual([]);
  });
});
