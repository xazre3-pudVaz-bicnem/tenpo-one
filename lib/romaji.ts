/**
 * かな → ローマ字（ヘボン式ベース）変換。純関数・テスト対象。
 *
 * 用途: 厨房伝票（キッチンプリンター）に日本語を読まないスタッフ向けのローマ字を印字する。
 * - ひらがな・カタカナを変換する。ASCII（英数字・記号）はそのまま残す。
 * - 漢字は読みが分からないため変換できない。呼び出し側は `hasUnromanizable()` で判定し、
 *   変換できない場合は日本語名をそのまま出す（＝黙って情報を落とさない）。
 */

/** 拗音（2文字）テーブル。長いキーから先に照合する。 */
const DIGRAPHS: Record<string, string> = {
  キャ: 'kya', キュ: 'kyu', キョ: 'kyo', キェ: 'kye',
  シャ: 'sha', シュ: 'shu', ショ: 'sho', シェ: 'she',
  チャ: 'cha', チュ: 'chu', チョ: 'cho', チェ: 'che',
  ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo',
  ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo',
  ミャ: 'mya', ミュ: 'myu', ミョ: 'myo',
  リャ: 'rya', リュ: 'ryu', リョ: 'ryo',
  ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo',
  ジャ: 'ja', ジュ: 'ju', ジョ: 'jo', ジェ: 'je',
  ヂャ: 'ja', ヂュ: 'ju', ヂョ: 'jo',
  ビャ: 'bya', ビュ: 'byu', ビョ: 'byo',
  ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo',
  ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', フュ: 'fyu',
  ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo', ヴュ: 'vyu',
  ティ: 'ti', トゥ: 'tu', テュ: 'tyu',
  ディ: 'di', ドゥ: 'du', デュ: 'dyu',
  ウィ: 'wi', ウェ: 'we', ウォ: 'wo',
  ツァ: 'tsa', ツィ: 'tsi', ツェ: 'tse', ツォ: 'tso',
  シィ: 'shi', チィ: 'chi',
  クァ: 'kwa', クィ: 'kwi', クェ: 'kwe', クォ: 'kwo',
  グァ: 'gwa',
};

/** 単音テーブル（カタカナ）。 */
const MONOGRAPHS: Record<string, string> = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
  カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
  タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
  ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
  ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro',
  ワ: 'wa', ヲ: 'o', ン: 'n',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
  ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
  バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
  ヴ: 'vu',
  ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o',
  ャ: 'ya', ュ: 'yu', ョ: 'yo', ヮ: 'wa',
  '　': ' ', '・': ' ', '、': ', ', '。': '. ',
};

const SMALL_TSU = 'ッ';
const LONG_MARK = 'ー';

/** ひらがな → カタカナ（変換表をカタカナに一本化するため）。 */
function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** 変換できない文字（漢字・全角記号など）が残っているか。 */
export function hasUnromanizable(s: string): boolean {
  // CJK統合漢字・CJK互換漢字・ハングル等が残っていれば true
  return /[㐀-䶿一-鿿豈-﫿々〆]/.test(s);
}

/**
 * かな（ひらがな・カタカナ）をローマ字に変換する。
 * ASCII・数字・記号はそのまま。漢字は変換できないためそのまま残る。
 */
export function toRomaji(input: string): string {
  if (!input) return '';
  const src = toKatakana(input);
  let out = '';
  let i = 0;

  while (i < src.length) {
    const two = src.slice(i, i + 2);
    const one = src[i];

    // 促音: 次の音の子音を重ねる（ッチ は tch ではなく cch を避け tch とする慣例に合わせる）
    if (one === SMALL_TSU) {
      const rest = toRomaji(src.slice(i + 1));
      const m = rest.match(/^([a-z])/);
      if (!m) { i += 1; continue; }
      const c = m[1];
      out += rest.startsWith('ch') ? 't' : c;
      out += rest;
      return out;
    }

    // 長音符: 直前の母音を伸ばす（例: ラーメン → raamen）
    if (one === LONG_MARK) {
      const last = out.slice(-1);
      if (/[aiueo]/.test(last)) out += last;
      i += 1;
      continue;
    }

    if (DIGRAPHS[two]) {
      out += DIGRAPHS[two];
      i += 2;
      continue;
    }

    if (MONOGRAPHS[one]) {
      // 撥音「ン」の後に母音・y が続く場合は n' で切る（例: シンイチ → shin'ichi）
      if (one === 'ン') {
        const nextRomaji = src[i + 1] ? toRomaji(src[i + 1]) : '';
        out += /^[aiueoy]/.test(nextRomaji) ? "n'" : 'n';
      } else {
        out += MONOGRAPHS[one];
      }
      i += 1;
      continue;
    }

    // 変換表に無い文字（ASCII・漢字・記号）はそのまま
    out += one;
    i += 1;
  }

  return out;
}

/**
 * よく使う日本語の言い方 → 正しい英語（2026-09-24 店舗要望「Dorinku・Fuudo は英語が間違い」）。
 * カナのローマ字より先にこちらを使う。完全一致だけを見る（部分一致で誤訳しないため）。
 */
const COMMON_EN: Record<string, string> = {
  ドリンク: 'Drink',
  'ドリンク類': 'Drinks',
  お飲み物: 'Drinks',
  飲み物: 'Drinks',
  フード: 'Food',
  料理: 'Food',
  お食事: 'Food',
  食事: 'Food',
  コース: 'Course',
  コース料理: 'Course',
  おすすめ: 'Picks',
  オススメ: 'Picks',
  本日のおすすめ: "Today's picks",
  人気: 'Popular',
  売れ筋: 'Popular',
  ランチ: 'Lunch',
  ディナー: 'Dinner',
  モーニング: 'Morning',
  サービス: 'Service',
  オプション: 'Options',
  トッピング: 'Toppings',
  サイド: 'Sides',
  サイドメニュー: 'Sides',
  前菜: 'Appetizer',
  サラダ: 'Salad',
  スープ: 'Soup',
  メイン: 'Main',
  デザート: 'Dessert',
  ドルチェ: 'Dessert',
  アルコール: 'Alcohol',
  ソフトドリンク: 'Soft drinks',
  ビール: 'Beer',
  ワイン: 'Wine',
  日本酒: 'Sake',
  焼酎: 'Shochu',
  ウイスキー: 'Whisky',
  カクテル: 'Cocktails',
  サワー: 'Sour',
  ハイボール: 'Highball',
  ノンアルコール: 'Non-alcoholic',
  飲み放題: 'All you can drink',
  食べ放題: 'All you can eat',
  食べ飲み放題: 'All you can eat & drink',
  テイクアウト: 'Takeout',
  お持ち帰り: 'Takeout',
  持ち帰り: 'Takeout',
  その他: 'Other',
  セット: 'Set',
  単品: 'A la carte',
  アラカルト: 'A la carte',
  カレー: 'Curry',
  ナン: 'Naan',
  ライス: 'Rice',
  ご飯: 'Rice',
  麺: 'Noodles',
  丼: 'Rice bowl',
  鍋: 'Hot pot',
  寿司: 'Sushi',
  刺身: 'Sashimi',
  焼き鳥: 'Yakitori',
  揚げ物: 'Fried',
  デリバリー: 'Delivery',
  // 2026-10-18 SHUNKA「Sawaa hai・Uisukii haibooru・梅酒 のカテゴリ名を正しい英語に」
  ハイ: 'Hi',
  酎ハイ: 'Chuhai',
  チューハイ: 'Chuhai',
  レモンサワー: 'Lemon sour',
  梅酒: 'Umeshu',
  果実酒: 'Fruit liqueur',
  プレミアムカクテル: 'Premium cocktails',
  赤ワイン: 'Red wine',
  白ワイン: 'White wine',
  スパークリング: 'Sparkling',
  シャンパン: 'Champagne',
  紹興酒: 'Shaoxing wine',
  マッコリ: 'Makgeolli',
  ボトル: 'Bottle',
  ジュース: 'Juice',
  お茶: 'Tea',
  ティー: 'Tea',
  コーヒー: 'Coffee',
  おつまみ: 'Snacks',
  つまみ: 'Snacks',
  一品料理: 'A la carte',
  焼き物: 'Grilled',
  焼物: 'Grilled',
  串焼き: 'Skewers',
  串: 'Skewers',
  炭火焼き: 'Charcoal grill',
  焼肉: 'Yakiniku',
  ホルモン: 'Offal',
  肉料理: 'Meat dishes',
  魚料理: 'Fish dishes',
  海鮮: 'Seafood',
  肉寿司: 'Meat sushi',
  お鍋: 'Hot pot',
  鍋料理: 'Hot pot',
  鍋単品: 'Hot pot add-ons',
  おでん: 'Oden',
  餃子: 'Gyoza',
  ご飯物: 'Rice dishes',
  ごはんもの: 'Rice dishes',
  ご飯もの: 'Rice dishes',
  麺類: 'Noodles',
  特別メニュー: 'Special menu',
  延長: 'Extension',
  席料: 'Table charge',
  お通し: 'Otoshi',
};

/**
 * 「サワー・ハイ」「ウイスキー・ハイボール」「(A) 飲み放題 サワー・ハイ」のような組み合わせの名前は、
 * 区切り（・／/&、と空白）ごとに上の表で英語にする（全部の言葉が表にあるときだけ。1つでも無ければ null）。
 * 「(A)」のような括弧は残す。ほかの言葉と組み合わさった飲み放題・食べ放題は短く Nomihodai・Tabehodai、
 * 「(A)」が付いていれば飲み放題の言葉は省く（飲み放題のタブの中なので「(A) SOUR / HI」で分かる。左の一覧が長くならない）。
 */
const COMPOUND_SHORT_EN: Record<string, string> = {
  飲み放題: 'Nomihodai',
  食べ放題: 'Tabehodai',
  食べ飲み放題: 'Tabenomihodai',
};

function compoundEnglishName(name: string): string | null {
  const tokens = name.trim().split(/[\s\u3000]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const words = tokens.map((t) => t.split(/[・／/&＆、]+/).filter(Boolean));
  const many = words.flat().length > 1;
  if (!many) return null;
  const isPrefix = (t: string) => /^[(（][^()（）]{1,6}[)）]$/.test(t);
  const hasPrefix = tokens.some(isPrefix);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (hasPrefix && COMPOUND_SHORT_EN[token]) continue;
    if (isPrefix(token)) {
      out.push(token.replace('（', '(').replace('）', ')'));
      continue;
    }
    const parts: string[] = [];
    for (const w of words[i]) {
      const en = COMPOUND_SHORT_EN[w] ?? COMMON_EN[w];
      if (!en) return null;
      parts.push(en);
    }
    out.push(parts.join(' / '));
  }
  return out.join(' ');
}

/** よく使う言い方の英語（完全一致のみ）。無ければ null */
export function commonEnglishName(name: string): string | null {
  const key = name.trim().replace(/\s+/g, '');
  return COMMON_EN[key] ?? null;
}

/**
 * 厨房伝票に出すローマ字名を決める。
 * @param name  商品名（日本語のことが多い）
 * @param kana  カナ名（tenpo-one の「カナ」欄。英語名を入れている店舗もある）
 * @returns 印字するローマ字名。作れない場合は null（呼び出し側は日本語名のみ印字する）
 */
export function romanItemName(name: string, kana?: string | null): string | null {
  const source = (kana && kana.trim()) || name;
  if (!source) return null;
  // すでに英数字だけ（英語名が入っている）ならそのまま使う
  if (!/[^ -~]/.test(source)) {
    return source.trim() === name.trim() ? null : source.trim();
  }
  if (hasUnromanizable(source)) return null;
  const romaji = toRomaji(source).replace(/\s+/g, ' ').trim();
  if (!romaji || hasUnromanizable(romaji)) return null;
  // 先頭だけ大文字（読みやすさ優先。全大文字は横幅を食うため避ける）
  return romaji.charAt(0).toUpperCase() + romaji.slice(1);
}

/**
 * 画面・伝票に出す英語名を決める。
 * 1) 設定 > メニュー の「英語名（name_en）」を最優先する（店舗が手で入れた正しい英語）
 * 2) 無ければカナからローマ字を作る（データ入力ゼロで、とりあえず読めるようにするため）
 * 3) それも作れなければ null（呼び出し側は日本語のみ表示する。情報は落とさない）
 * @param name    商品・カテゴリ名（日本語のことが多い）
 * @param nameKana カナ名
 * @param nameEn  手入力の英語名
 */
export function englishName(
  name: string,
  nameKana?: string | null,
  nameEn?: string | null
): string | null {
  const manual = (nameEn ?? '').trim();
  // 日本語名と同じ文字列を英語名欄に入れている場合は「英語なし」と同じ扱いにする
  if (manual && manual !== name.trim()) return manual;
  // 「ドリンク→Dorinku」のようなローマ字にならないよう、よく使う言い方は先に英語にする
  const common = commonEnglishName(name);
  if (common) return common;
  // 「サワー・ハイ → Sawaa hai」にならないよう、組み合わせの名前も言葉ごとに英語にする
  const compound = compoundEnglishName(name);
  if (compound) return compound;
  return romanItemName(name, nameKana ?? null);
}

/**
 * カテゴリの英語名（レジ・ハンディ・お客様QRのカテゴリ一覧・見出し）。全部大文字にそろえる
 * （2026-10-18 Ronnie「カテゴリ名は自動で CAPITAL LETTER」。手で入れた英語名も大文字で出す）。
 * 英語名が作れなければ null（日本語だけ出す）
 */
export function categoryEnglishName(name: string, nameEn?: string | null): string | null {
  const en = englishName(name, null, nameEn);
  return en ? en.toUpperCase() : null;
}
