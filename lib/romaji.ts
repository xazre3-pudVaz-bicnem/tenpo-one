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
