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

  it('空白の無い名前は英語の最初の単語と日本語の頭が同じものをまとめる（カクテル）', () => {
    const items = mk([
      ['カシスソーダ', 'Cassis Soda'],
      ['カシスオレンジ', 'Cassis Orange'],
      ['ジンリッキー', 'Gin Rickey'],
      ['ジントニック', 'Gin Tonic'],
      ['ブルドッグ', 'Bulldog'],
      ['モスコミュール', 'Moscow Mule'],
    ]);
    expect(view(groupMenuItems(items, names))).toEqual([
      { head: 'カシス', headEn: 'Cassis', v: ['ソーダ|Soda', 'オレンジ|Orange'] },
      { head: 'ジン', headEn: 'Gin', v: ['リッキー|Rickey', 'トニック|Tonic'] },
      { loose: ['ブルドッグ', 'モスコミュール'] },
    ]);
  });

  it('頭が少し同じでも英語が違えばまとめない（ライムサワー／ライチサワー、青リンゴ／緑茶）', () => {
    const items = mk([
      ['ライムサワー', 'Lime Sour'],
      ['ライチサワー', 'Lychee Sour'],
      ['青リンゴサワー', 'Green Apple Sour'],
      ['緑茶ハイ', 'Green Tea Hi'],
    ]);
    expect(groupMenuItems(items, names)).toBeNull();
  });

  it('英語名が無い（ローマ字1語）空白無しの名前はまとめない', () => {
    const items = mk([['カシスソーダ', 'Kashisusooda'], ['カシスオレンジ', 'Kashisuorenji']]);
    expect(groupMenuItems(items, names)).toBeNull();
    expect(groupMenuItems(mk([['カシスソーダ'], ['カシスオレンジ']]), names)).toBeNull();
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
      ['スパイシーチキン', 'Spicy Chicken'],
      ['やわらか豚角煮', 'Braised Pork Belly'],
      ['スパイシーポーク', 'Spicy Pork'],
      ['黒豚ロースステーキ', 'Black Pork Loin Steak'],
    ]);
    expect(view(groupMenuItems(items, names))).toEqual([
      { head: 'スパイシー', headEn: 'Spicy', v: ['チキン|Chicken', 'ポーク|Pork'] },
      { loose: ['やわらか豚角煮', '黒豚ロースステーキ'] },
    ]);
  });

  it('数字の途中で見出しを切らない（10貫／12貫）・「の」を種類の頭に残さない', () => {
    const sushi = mk([
      ['肉寿司10種盛り', 'Assorted Meat Sushi 10 Kinds'],
      ['肉寿司12種盛り', 'Assorted Meat Sushi 12 Kinds'],
    ]);
    expect(view(groupMenuItems(sushi, names))).toEqual([
      { head: '肉寿司', headEn: 'Assorted Meat Sushi', v: ['10種盛り|10 Kinds', '12種盛り|12 Kinds'] },
    ]);
    const shrimp = mk([['エビのアヒージョ', 'Shrimp Ajillo'], ['エビマヨ', 'Shrimp Mayo']]);
    expect(view(groupMenuItems(shrimp, names))).toEqual([
      { head: 'エビ', headEn: 'Shrimp', v: ['アヒージョ|Ajillo', 'マヨ|Mayo'] },
    ]);
  });

  it('英語の頭がそろわないときは見出しは日本語だけ、種類は英語名まるごと', () => {
    const items = mk([
      ['飲み放題 Aプラン（2時間）', 'All-You-Can-Drink Plan A (2h)'],
      ['飲み放題 A→B 変更', 'Upgrade A→B'],
    ]);
    expect(view(groupMenuItems(items, names))).toEqual([
      {
        head: '飲み放題',
        headEn: null,
        v: ['Aプラン（2時間）|All-You-Can-Drink Plan A (2h)', 'A→B 変更|Upgrade A→B'],
      },
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
