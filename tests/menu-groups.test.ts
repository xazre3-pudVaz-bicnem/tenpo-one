import { describe, it, expect } from 'vitest';
import { groupMenuItems, type MenuGroupSection } from '@/lib/menu-groups';

type Item = { id: string; name: string; nameEn?: string | null; image?: string };
const names = (i: Item) => ({ name: i.name, nameEn: i.nameEn ?? null });
const mk = (rows: [string, string?][]): Item[] => rows.map(([name, nameEn], i) => ({ id: `i${i}`, name, nameEn }));

/** テストで読みやすい形にする */
function view(sections: MenuGroupSection<Item>[] | null) {
  if (!sections) return null;
  return sections.map((s) =>
    s.kind === 'group'
      ? { head: s.label, headEn: s.labelEn, v: s.members.map((m) => `${m.label}|${m.labelEn ?? '-'}`) }
      : { loose: s.items.map((i) => i.name) }
  );
}

describe('groupMenuItems', () => {
  it('空白で区切った名前は最初の言葉で見出しにまとめる（ウイスキー）', () => {
    const items = mk([
      ['ホワイトホース ハイボール', 'White Horse Highball'],
      ['ホワイトホース ロック', 'White Horse Rock'],
      ['ホワイトホース 水割り', 'White Horse with Water'],
      ['陸 ハイボール', 'Kirin Riku Highball'],
      ['陸 ボトル（700ml）', 'Kirin Riku Bottle 700ml'],
      ['ジョニーウォーカー黒 ロック', 'Johnnie Walker Black Rock'],
      ['ジョニーウォーカー黒 コークハイボール', 'Johnnie Walker Black Coke Highball'],
    ]);
    expect(view(groupMenuItems(items, names))).toEqual([
      { head: 'ホワイトホース', headEn: 'White Horse', v: ['ハイボール|Highball', 'ロック|Rock', '水割り|with Water'] },
      { head: '陸', headEn: 'Kirin Riku', v: ['ハイボール|Highball', 'ボトル（700ml）|Bottle 700ml'] },
      {
        head: 'ジョニーウォーカー黒',
        headEn: 'Johnnie Walker Black',
        v: ['ロック|Rock', 'コークハイボール|Coke Highball'],
      },
    ]);
  });

  it('空白の無い名前は頭が同じでもまとめない（別々の料理・飲み物。2026-10-18 Ronnie「Shrimp の下に Ajillo・Mayo はおかしい」）', () => {
    const items = mk([
      ['エビのアヒージョ', 'Shrimp Ajillo'],
      ['エビマヨ', 'Shrimp Mayo'],
      ['カシスソーダ', 'Cassis Soda'],
      ['カシスオレンジ', 'Cassis Orange'],
      ['スパイシーチキン', 'Spicy Chicken'],
      ['スパイシーポーク', 'Spicy Pork'],
    ]);
    expect(groupMenuItems(items, names)).toBeNull();
  });

  it('英語名が無くても空白の名前はまとめる（見出しは日本語だけ）', () => {
    const items = mk([['銀盤 熱燗'], ['銀盤 冷'], ['八海山 熱燗']]);
    expect(view(groupMenuItems(items, names))).toEqual([
      { head: '銀盤', headEn: null, v: ['熱燗|-', '冷|-'] },
      { loose: ['八海山 熱燗'] },
    ]);
  });

  it('飲み放題の印「F. 」は無視してまとめる（名前そのものは変えない）', () => {
    const items = mk([
      ['F. 焼酎 ロック', 'F. Shochu Rock'],
      ['F. 焼酎 水割り', 'F. Shochu with Water'],
      ['F. 梅酒 ロック', 'F. Umeshu Rock'],
      ['F. 梅酒 水割り', 'F. Umeshu with Water'],
    ]);
    const sections = groupMenuItems(items, names);
    expect(view(sections)).toEqual([
      { head: '焼酎', headEn: 'Shochu', v: ['ロック|Rock', '水割り|with Water'] },
      { head: '梅酒', headEn: 'Umeshu', v: ['ロック|Rock', '水割り|with Water'] },
    ]);
    // カートに入るのは元の商品
    expect(sections?.[0].kind === 'group' && sections[0].members[0].item.name).toBe('F. 焼酎 ロック');
  });

  it('離れた位置にある同じ見出しは最初の位置にそろえ、間の商品の順番は変えない', () => {
    const items = mk([
      ['和牛炙り寿司 4貫', 'Seared Wagyu Sushi 4pcs'],
      ['生ハム寿司 4貫', 'Prosciutto Sushi 4pcs'],
      ['和牛炙り寿司 10貫', 'Seared Wagyu Sushi 10pcs'],
      ['馬刺し寿司 4貫', 'Horse Sashimi Sushi 4pcs'],
    ]);
    expect(view(groupMenuItems(items, names))).toEqual([
      { head: '和牛炙り寿司', headEn: 'Seared Wagyu Sushi', v: ['4貫|4pcs', '10貫|10pcs'] },
      { loose: ['生ハム寿司 4貫', '馬刺し寿司 4貫'] },
    ]);
  });

  it('英語名が全員にあるのに頭がそろわないものはまとめない（飲み放題のプラン）', () => {
    const items = mk([
      ['飲み放題 Aプラン（2時間）', 'All-You-Can-Drink Plan A (2h)'],
      ['飲み放題 A→B 変更', 'Upgrade A→B'],
      ['枝豆', 'Edamame'],
    ]);
    expect(groupMenuItems(items, names)).toBeNull();
  });

  it('カテゴリ全部が1つの見出しになるときはまとめない（2026-10-18「飲み放題だけボタンが小さい」）', () => {
    const items = mk([
      ['梅酒 グラス', 'Plum Wine Glass'],
      ['梅酒 デキャンタ', 'Plum Wine Decanter'],
    ]);
    expect(groupMenuItems(items, names)).toBeNull();
  });

  it('英語名の無い商品が混ざるときは 見出しは日本語だけ・英語のある商品は英語名まるごと', () => {
    const items = mk([
      ['陸 ハイボール', 'Kirin Riku Highball'],
      ['陸 ロック'],
      ['枝豆', 'Edamame'],
    ]);
    expect(view(groupMenuItems(items, names))).toEqual([
      { head: '陸', headEn: null, v: ['ハイボール|Kirin Riku Highball', 'ロック|-'] },
      { loose: ['枝豆'] },
    ]);
  });

  it('1つもまとまらなければ null（今までどおりのタイル）', () => {
    expect(groupMenuItems(mk([['枝豆', 'Edamame'], ['カプレーゼ', 'Caprese']]), names)).toBeNull();
    expect(groupMenuItems(mk([['ホワイトホース ロック', 'White Horse Rock']]), names)).toBeNull();
    expect(groupMenuItems([], names)).toBeNull();
  });

  it('まとめない商品（写真のある商品など）はそのまま出す', () => {
    const items: Item[] = [
      { id: 'a', name: '生ビール 中', nameEn: 'Draft Beer Medium', image: 'x.jpg' },
      { id: 'b', name: '生ビール 大', nameEn: 'Draft Beer Large' },
      { id: 'c', name: 'ハイボール 中', nameEn: 'Highball Medium' },
      { id: 'd', name: 'ハイボール 大', nameEn: 'Highball Large' },
    ];
    expect(view(groupMenuItems(items, names, { groupable: (i) => !i.image }))).toEqual([
      { loose: ['生ビール 中', '生ビール 大'] },
      { head: 'ハイボール', headEn: 'Highball', v: ['中|Medium', '大|Large'] },
    ]);
  });
});
