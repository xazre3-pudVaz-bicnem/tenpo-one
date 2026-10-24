import { describe, expect, it } from 'vitest';
import { DEFAULT_RESERVATION_KEYWORDS, KEYWORD_MAX_COUNT, KEYWORD_MAX_LENGTH, hasCustomKeywords, reservationKeywordsFrom, sanitizeKeywords } from '@/lib/reservation-entry';
import { DEFAULT_RESERVATION_TAG_GROUPS, reservationTagGroupsFrom, sanitizeTagGroups, tagIconMap } from '@/lib/reservation-tags';
import { parseNativeLedgerAction } from '@/lib/native-ledger';

// 2026-10-24 Ronnie：キーワードは 1 店舗 10 個・1 つ 15 文字まで。空白だけ・重複は登録しない・前後の空白は削る。サーバーでも確かめる
describe('店舗のキーワード', () => {
  it('前後の空白を削り、空白だけ・重複は落とす', () => {
    expect(sanitizeKeywords([' 個室希望 ', '個室希望', '   ', '', '幹事無料'])).toEqual({ ok: true, keywords: ['個室希望', '幹事無料'] });
  });
  it('10 個まで・15 文字まで（超えたらエラー）', () => {
    const ten = Array.from({ length: KEYWORD_MAX_COUNT }, (_, i) => `K${i}`);
    expect(sanitizeKeywords(ten).ok).toBe(true);
    expect(sanitizeKeywords([...ten, 'K10'])).toEqual({ ok: false, error: 'キーワードは 10 個までです' });
    expect(sanitizeKeywords(['あ'.repeat(KEYWORD_MAX_LENGTH)]).ok).toBe(true);
    expect(sanitizeKeywords(['あ'.repeat(KEYWORD_MAX_LENGTH + 1)])).toEqual({ ok: false, error: 'キーワードは 15 文字までです' });
    expect(sanitizeKeywords('x').ok).toBe(false);
  });
  it('登録が無ければ初期値（10 個以内）、登録があればそれ（空も「無し」）', () => {
    expect(reservationKeywordsFrom(null)).toEqual([...DEFAULT_RESERVATION_KEYWORDS]);
    expect(DEFAULT_RESERVATION_KEYWORDS.length).toBeLessThanOrEqual(KEYWORD_MAX_COUNT);
    expect(reservationKeywordsFrom({ reservation_keywords: [] })).toEqual([]);
    expect(hasCustomKeywords({ reservation_keywords: [] })).toBe(true);
    expect(hasCustomKeywords({})).toBe(false);
    // 前に多く保存されていても 10 個・15 文字までに収める
    const many = Array.from({ length: 14 }, (_, i) => `W${i}`);
    expect(reservationKeywordsFrom({ reservation_keywords: [...many, 'あ'.repeat(16)] })).toHaveLength(10);
  });
  it('iPad の保存（ledgerKeywordsSave）は形だけ確かめ、上限はサーバーの sanitizeKeywords', () => {
    expect(parseNativeLedgerAction({ type: 'ledgerKeywordsSave', keywords: ['a', 'b'] }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerKeywordsSave', keywords: 'a' }).ok).toBe(false);
    expect(parseNativeLedgerAction({ type: 'ledgerTagGroupsSave', groups: null }).ok).toBe(true);
    expect(parseNativeLedgerAction({ type: 'ledgerTagGroupsSave', groups: 'x' }).ok).toBe(false);
  });
});

describe('お客様・予約のタグ（区分）', () => {
  it('既定の区分：お客様の特徴・食事の制限・客単価・利用目的・席の希望', () => {
    expect(DEFAULT_RESERVATION_TAG_GROUPS.map((g) => g.label)).toEqual(['お客様の特徴', '食事の制限', '客単価', '利用目的', '席の希望']);
    expect(DEFAULT_RESERVATION_TAG_GROUPS[0].tags.map((t) => t.label)).toEqual(['VIP', '要注意', 'ワイン好き', 'ペット同伴', '遅刻が多い']);
    expect(DEFAULT_RESERVATION_TAG_GROUPS[1].tags.slice(0, 6).map((t) => t.label)).toEqual(['ヴィーガン', 'ベジタリアン', 'グルテン不耐', 'セリアック', '乳糖不耐', 'ナッツアレルギー']);
    expect(DEFAULT_RESERVATION_TAG_GROUPS[1].visible).toBe(6);
    expect(DEFAULT_RESERVATION_TAG_GROUPS[3].tags.slice(0, 6).map((t) => t.label)).toEqual(['誕生日', '記念日', 'デート', '接待／会食', 'お祝い', '特別な日']);
    expect(DEFAULT_RESERVATION_TAG_GROUPS[4].tags.map((t) => t.label)).toEqual(['子供用いす', '車いす対応', 'ベビーカー', 'ペット可の席']);
    // どれも 15 文字以内
    for (const g of DEFAULT_RESERVATION_TAG_GROUPS) for (const t of g.tags) expect(Array.from(t.label).length).toBeLessThanOrEqual(15);
    expect(sanitizeTagGroups(DEFAULT_RESERVATION_TAG_GROUPS).ok).toBe(true);
  });
  it('保存：空白を削り、重複・空は落とし、長すぎはエラー。知らないアイコンは tag', () => {
    const r = sanitizeTagGroups([{ key: 'guest', label: ' お客様 ', visible: 3, tags: [{ label: ' VIP ', icon: 'star' }, { label: 'VIP', icon: 'star' }, { label: ' ', icon: 'x' }, { label: '常連', icon: 'nope' }] }]);
    expect(r).toEqual({ ok: true, groups: [{ key: 'guest', label: 'お客様', visible: 3, tags: [{ label: 'VIP', icon: 'star' }, { label: '常連', icon: 'tag' }] }] });
    expect(sanitizeTagGroups([{ label: 'A', tags: [{ label: 'あ'.repeat(16) }] }]).ok).toBe(false);
    expect(sanitizeTagGroups([{ label: '', tags: [] }]).ok).toBe(false);
  });
  it('設定が無ければ既定・タグの名前からアイコン', () => {
    expect(reservationTagGroupsFrom(null)).toEqual(DEFAULT_RESERVATION_TAG_GROUPS);
    expect(tagIconMap(DEFAULT_RESERVATION_TAG_GROUPS)['誕生日']).toBe('gift');
  });
});

describe('人数の範囲（4〜6 名）', () => {
  const base = { date: '2026-10-24', time: '18:30', name: '山田', phone: '09012345678' };
  it('最小人数は最大人数（大人＋子ども）以下。同じなら範囲なし', () => {
    const r = parseNativeLedgerAction({ type: 'ledgerCreate', input: { ...base, adults: 5, children: 1, partySizeMin: 4 } });
    expect(r.ok && r.action.type === 'ledgerCreate' && r.action.input.partySizeMin).toBe(4);
    const same = parseNativeLedgerAction({ type: 'ledgerCreate', input: { ...base, adults: 4, children: 0, partySizeMin: 4 } });
    expect(same.ok && same.action.type === 'ledgerCreate' && same.action.input.partySizeMin).toBe(null);
    expect(parseNativeLedgerAction({ type: 'ledgerCreate', input: { ...base, adults: 3, children: 0, partySizeMin: 5 } }).ok).toBe(false);
  });
});
