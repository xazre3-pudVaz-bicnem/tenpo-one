import { describe, it, expect } from 'vitest';
import { validateMenuItemRow, validateOptionGroupRow } from '@/components/import/validators';

describe('validateMenuItemRow（商品CSV）', () => {
  it('英語名を取り込み、価格が空でも通す（登録済み商品の英語名更新用）', () => {
    const r = validateMenuItemRow({ name: 'バターチキンカレー', nameEn: 'Butter Chicken Curry', price: '' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.nameEn).toBe('Butter Chicken Curry');
      expect(r.data.price).toBeNull();
      expect(r.dupKey).toBe('バターチキンカレー');
    }
  });

  it('価格があれば数値として持つ。負の価格はエラー', () => {
    const ok = validateMenuItemRow({ name: 'ナン', price: '420' });
    expect(ok.ok && ok.data.price).toBe(420);
    const ng = validateMenuItemRow({ name: 'ナン', price: '-1' });
    expect(ng.ok).toBe(false);
  });
});

describe('validateOptionGroupRow（選択肢CSV）', () => {
  it('グループ名・選択肢名・英語名・料金・対象商品を読む', () => {
    const r = validateOptionGroupRow({
      groupName: 'カレーを選ぶ',
      optionName: 'バターチキン',
      optionNameEn: 'Butter Chicken',
      price: '0',
      isRequired: '必須',
      minSelect: '1',
      maxSelect: '1',
      targetItems: 'カレーセット; ランチセット',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.isRequired).toBe(true);
      expect(r.data.targetItems).toEqual(['カレーセット', 'ランチセット']);
      expect(r.dupKey).toBe('カレーを選ぶ|バターチキン');
    }
  });

  it('必須・最小・最大が空なら null（グループ作成時に既定の 必須・1〜1 を使う）', () => {
    const r = validateOptionGroupRow({ groupName: 'ドリンクを選ぶ', optionName: 'ラッシー' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.isRequired).toBeNull();
      expect(r.data.minSelect).toBeNull();
      expect(r.data.maxSelect).toBeNull();
      expect(r.data.price).toBe(0);
      expect(r.data.targetItems).toEqual([]);
    }
  });

  it('グループ名・選択肢名が無い／最小＞最大 はエラー', () => {
    expect(validateOptionGroupRow({ groupName: '', optionName: 'x' }).ok).toBe(false);
    expect(validateOptionGroupRow({ groupName: 'g', optionName: '' }).ok).toBe(false);
    expect(validateOptionGroupRow({ groupName: 'g', optionName: 'x', minSelect: '2', maxSelect: '1' }).ok).toBe(false);
  });

  it('最大0はエラー（1つも選べないグループは登録できない）', () => {
    const r = validateOptionGroupRow({ groupName: 'g', optionName: 'x', minSelect: '0', maxSelect: '0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('最大は1以上');
  });

  it('選択肢名が空でも対象商品があれば「紐付けだけの行」として通る（重複判定なし）', () => {
    const r = validateOptionGroupRow({ groupName: 'カレーを選ぶ', optionName: '', targetItems: 'カレーセット' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.optionName).toBe('');
      expect(r.dupKey).toBeNull();
    }
    expect(validateOptionGroupRow({ groupName: 'g', optionName: '', targetItems: '' }).ok).toBe(false);
  });

  it('「いいえ」「任意」は必須でない', () => {
    const r = validateOptionGroupRow({ groupName: 'トッピング', optionName: 'チーズ', isRequired: '任意', price: '200' });
    expect(r.ok && r.data.isRequired).toBe(false);
    expect(r.ok && r.data.price).toBe(200);
  });
});
