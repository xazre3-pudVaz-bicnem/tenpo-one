import { describe, expect, it } from 'vitest';
import { matchWithdrawal, readAmount, readDate, readKind, readCategory, readScan, readVendor } from '@/lib/receipt-read';

const TODAY = '2026-10-20';

describe('readAmount（合計金額）', () => {
  it('合計の行を使い、お預り・お釣りは使わない', () => {
    const lines = ['ファミリーマート 新宿店', '2026年10月19日 18:02', 'おにぎり ¥150', 'お茶 ¥160', '合計 ¥310', 'お預り ¥1,000', 'お釣り ¥690'];
    expect(readAmount(lines)).toBe(310);
  });
  it('全角・円・カンマ', () => {
    expect(readAmount(['領収書', '金額　３，２８０円', '合　計　３，２８０円'])).toBe(3280);
  });
  it('合計の金額が次の行にあるとき', () => {
    expect(readAmount(['ご請求金額', '¥ 35,420', '内消費税 ¥3,220'])).toBe(35420);
  });
  it('合計の行が無ければいちばん大きい金額', () => {
    expect(readAmount(['A ¥500', 'B ¥1,200'])).toBe(1200);
  });
  it('金額が無ければ null', () => {
    expect(readAmount(['ありがとうございました'])).toBeNull();
  });
});

describe('readDate（日付）', () => {
  it('西暦・令和・2桁の年', () => {
    expect(readDate(['2026年10月19日'], TODAY)).toBe('2026-10-19');
    expect(readDate(['令和8年10月18日'], TODAY)).toBe('2026-10-18');
    expect(readDate(['R8.10.17 12:00'], TODAY)).toBe('2026-10-17');
    expect(readDate(['26/10/16'], TODAY)).toBe('2026-10-16');
  });
  it('支払期限は使わず、請求日を使う', () => {
    expect(readDate(['お支払期限 2026年10月31日', '請求日 2026年10月05日'], TODAY)).toBe('2026-10-05');
  });
  it('今日より先の日付は使わない', () => {
    expect(readDate(['2026/12/01'], TODAY)).toBeNull();
  });
});

describe('readKind・readCategory（レシートか請求書か・費目）', () => {
  it('レシート', () => {
    expect(readKind(['領収書', 'お預り ¥1,000'])).toBe('receipt');
  });
  it('請求書', () => {
    expect(readKind(['請求書', 'ご請求金額 ¥54,000', '振込先 ○○銀行'])).toBe('bill');
  });
  it('電気・水道・ガス・家賃・仕入先', () => {
    expect(readCategory(['電気ご使用量のお知らせ', '使用量 820kWh'])).toBe('electric');
    expect(readCategory(['上下水道料金'])).toBe('water');
    expect(readCategory(['東京ガス', 'ガス料金'])).toBe('gas');
    expect(readCategory(['10月分 賃料・共益費'])).toBe('rent');
    expect(readCategory(['株式会社 山田青果', '請求書'])).toBe('vendor');
  });
});

describe('readVendor（発行元）', () => {
  it('会社名（宛名の 様・御中 は除く）', () => {
    expect(readVendor(['株式会社D&DREAM 御中', '株式会社 山田⻘果', '請求書'])).toBe('株式会社山田青果');
  });
  it('レシートの1行目の店名', () => {
    expect(readVendor(['業務スーパー 新宿店', '2026/10/19'])).toBe('業務スーパー新宿店');
  });
});

describe('readScan', () => {
  it('請求書（電気）', () => {
    const r = readScan(['東京電力エナジーパートナー株式会社', '電気ご使用量のお知らせ', '請求日 2026年10月05日', 'ご請求金額 ¥48,300'], TODAY);
    expect(r).toEqual({ kind: 'bill', category: 'electric', amount: 48300, date: '2026-10-05', vendorName: '東京電力エナジーパートナー株式会社' });
  });
});

describe('matchWithdrawal（出金との突き合わせ）', () => {
  const c = (id: string, amount: number, businessDate: string) => ({ id, amount, businessDate });
  it('金額ぴったり・日付が近いものを1件', () => {
    expect(matchWithdrawal({ amount: 3280, date: '2026-10-19' }, [c('a', 3280, '2026-10-19'), c('b', 3280, '2026-10-15')], TODAY)?.id).toBe('a');
  });
  it('金額が違えば選ばない', () => {
    expect(matchWithdrawal({ amount: 3281, date: '2026-10-19' }, [c('a', 3280, '2026-10-19')], TODAY)).toBeNull();
  });
  it('同じ近さが2件なら選ばない（要確認）', () => {
    expect(matchWithdrawal({ amount: 500, date: '2026-10-19' }, [c('a', 500, '2026-10-19'), c('b', 500, '2026-10-19')], TODAY)).toBeNull();
  });
  it('日付が読めなければ今日から7日以内', () => {
    expect(matchWithdrawal({ amount: 800, date: null }, [c('a', 800, '2026-10-15')], TODAY)?.id).toBe('a');
    expect(matchWithdrawal({ amount: 800, date: null }, [c('a', 800, '2026-10-01')], TODAY)).toBeNull();
  });
  it('金額が読めなければ選ばない', () => {
    expect(matchWithdrawal({ amount: null, date: '2026-10-19' }, [c('a', 800, '2026-10-19')], TODAY)).toBeNull();
  });
});

describe('PDF・OCR の文字のくせ', () => {
  it('部首の文字（⽉⽇⼒）と OCR の空白を直す', () => {
    const r = readScan(['東京電⼒エナジーパートナー株式会社', '電気ご使⽤量', '請求⽇ 2026年10⽉05⽇', 'ご請求⾦額 ¥48,300'], TODAY);
    expect(r.date).toBe('2026-10-05');
    expect(r.vendorName).toBe('東京電力エナジーパートナー株式会社');
    expect(readVendor(['ドン ・ キ ホー テ 歌舞 伎町 店', '2026/10/18'])).toBe('ドン・キホーテ歌舞伎町店');
  });
});
