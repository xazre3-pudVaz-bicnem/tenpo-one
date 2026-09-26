import { describe, expect, it } from 'vitest';
import {
  detectKind,
  detectSite,
  extractDateTime,
  gourmetImportAddress,
  jstToIso,
  parseGourmetMail,
  tokenFromRecipient,
} from '@/lib/gourmet-mail';

const NOW = new Date('2026-09-27T03:00:00Z'); // JST 12:00

const TABELOG_NEW = `
【食べログ】ネット予約が入りました

FULLMOoN 新宿 様

以下の内容でネット予約を受け付けました。

予約番号：TB-20261003-123456
来店日時：2026年10月3日（土） 19:00
人数：4名
お名前：山田 太郎 様
電話番号：090-1234-5678
コース：【2.5時間飲み放題付】プライムリブコース
ご要望：窓側の席を希望
`;

const HOTPEPPER_CANCEL = `
件名: 【ホットペッパーグルメ】予約がキャンセルされました

ご予約がキャンセルされました。

予約番号 : HPG987654
ご来店日 : 2026/10/05
ご来店時間 : 18:30
ご人数 : 2名
ご予約者名 : 佐藤 花子
電話番号 : 08012345678
`;

const GNAVI_CHANGE = `
ぐるなび 予約内容が変更されました

受付番号 G-55555
来店日時 10月12日 20時30分
来店人数 6名様
お名前 鈴木 一郎
TEL 03-1234-5678
コース なし
`;

describe('グルメサイト メール取り込み（2026-09-27 Ronnie）', () => {
  it('宛先から token を取り出す', () => {
    expect(tokenFromRecipient('FULLMOoN <rsv-a1b2c3d4e5f6g7h8@in.tenpo-one.com>')).toBe('a1b2c3d4e5f6g7h8');
    expect(tokenFromRecipient(['staff@example.com', 'rsv-ABCDEF0123456789@in.tenpo-one.com'])).toBe('abcdef0123456789');
    expect(tokenFromRecipient('nobody@example.com')).toBeNull();
    expect(gourmetImportAddress('abc123abc123', 'in.tenpo-one.com')).toBe('rsv-abc123abc123@in.tenpo-one.com');
  });

  it('サイトの判定（From → 件名/本文）', () => {
    expect(detectSite('食べログ <noreply@tabelog.com>', '', '')).toBe('tabelog');
    expect(detectSite('reserve@hotpepper.jp', '', '')).toBe('hotpepper');
    expect(detectSite('forward@gmail.com', '【ぐるなび】予約通知', '')).toBe('gurunavi');
    expect(detectSite('forward@gmail.com', 'ご予約', 'こんにちは')).toBe('other');
  });

  it('食べログの新規予約を読む', () => {
    const p = parseGourmetMail({ from: 'noreply@tabelog.com', subject: '【食べログ】ネット予約が入りました', text: TABELOG_NEW }, NOW);
    expect(p.site).toBe('tabelog');
    expect(p.kind).toBe('new');
    expect(p.externalId).toBe('TB-20261003-123456');
    expect(p.date).toBe('2026-10-03');
    expect(p.time).toBe('19:00');
    expect(p.partySize).toBe(4);
    expect(p.guestName).toBe('山田 太郎');
    expect(p.phone).toBe('090-1234-5678');
    expect(p.course).toContain('プライムリブコース');
    expect(p.request).toBe('窓側の席を希望');
    expect(p.complete).toBe(true);
  });

  it('ホットペッパーのキャンセル（日付と時刻が別の行）', () => {
    const p = parseGourmetMail({ from: 'reserve@hotpepper.jp', subject: '【ホットペッパーグルメ】予約がキャンセルされました', text: HOTPEPPER_CANCEL }, NOW);
    expect(p.site).toBe('hotpepper');
    expect(p.kind).toBe('cancel');
    expect(p.externalId).toBe('HPG987654');
    expect(p.date).toBe('2026-10-05');
    expect(p.partySize).toBe(2);
    expect(p.guestName).toBe('佐藤 花子');
    expect(p.phone).toBe('08012345678');
  });

  it('ぐるなびの変更（年なし・「時分」表記・コースなし）', () => {
    const p = parseGourmetMail({ from: 'info@gnavi.co.jp', subject: '予約内容が変更されました', text: GNAVI_CHANGE }, NOW);
    expect(p.site).toBe('gurunavi');
    expect(p.kind).toBe('change');
    expect(p.externalId).toBe('G-55555');
    expect(p.date).toBe('2026-10-12');
    expect(p.time).toBe('20:30');
    expect(p.partySize).toBe(6);
    expect(p.guestName).toBe('鈴木 一郎');
    expect(p.phone).toBe('03-1234-5678');
    expect(p.course).toBeNull();
  });

  it('年なしの日付は今日より前なら来年', () => {
    expect(extractDateTime('来店日 1月5日 18:00', NOW)?.date).toBe('2027-01-05');
    expect(extractDateTime('来店日 9月27日 18:00', NOW)?.date).toBe('2026-09-27');
  });

  it('種類の判定・認証メール', () => {
    expect(detectKind('【食べログ】メールアドレスの確認', 'このメールアドレスを登録します')).toBe('verify');
    expect(detectKind('お知らせ', '来店日時 2026年10月1日 18:00\n人数 2名')).toBe('new');
    expect(detectKind('お知らせ', 'こんにちは')).toBe('unknown');
  });

  it('HTML だけのメールも読める', () => {
    const html = '<html><body><p>【食べログ】ネット予約が入りました</p><table><tr><td>来店日時</td><td>2026年11月1日 18:00</td></tr><tr><td>人数</td><td>３名</td></tr><tr><td>お名前</td><td>田中 様</td></tr></table></body></html>';
    const p = parseGourmetMail({ from: 'noreply@tabelog.com', subject: 'ネット予約が入りました', html }, NOW);
    expect(p.date).toBe('2026-11-01');
    expect(p.time).toBe('18:00');
    expect(p.partySize).toBe(3);
    expect(p.guestName).toBe('田中');
  });

  it('日本時間 → ISO', () => {
    expect(jstToIso('2026-10-03', '19:00')).toBe('2026-10-03T10:00:00.000Z');
    expect(jstToIso('2026-10-03', '25:00')).toBe('2026-10-03T16:00:00.000Z');
  });
});
