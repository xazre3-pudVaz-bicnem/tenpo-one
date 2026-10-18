/**
 * メニューの写真・PDFから読み取った文字（行の並び）を「カテゴリ・商品名・英語名・価格」に分ける。
 * 2026-10-18 Ronnie「メニューの PDF・写真をアップロードして自動でメニューに入るように。お金がかからないもので」
 * → 文字の読み取りはブラウザの中（Tesseract・PDF の文字）。ここは読み取った行を商品に分けるだけ（AI は使わない）。
 *
 * 決め方（確実ではないので、画面で必ず確認・修正してから登録する）:
 * - 価格は「¥1,200」「1,200円」「1200円」「1,200」や、前後が空白の3〜5桁の数字（100〜99,999）
 * - 「580円（税込638円）」のように税込が書いてあれば税込の金額
 * - 価格の前の文字が商品名。1行に価格が2つ以上（2列のメニュー）なら、それぞれ別の商品
 * - 名前だけの行の次に価格だけの行が来たら、その2行で1商品
 * - 価格の無い短い行の次に商品が来たら、その行はカテゴリ（見出し）
 * - 長い説明文（25文字以上・「。」入り）は飛ばす。電話番号・時間・日付・〒 は価格にしない
 */

export interface MenuOcrRow {
  categoryName: string;
  name: string;
  nameEn: string;
  price: number;
  itemType: 'food' | 'drink';
}

const CJK = '\\u3005\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f';
const CJK_SPACE = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g');
const HAS_WORD = new RegExp(`[A-Za-z${CJK}]`);
const HAS_CJK = new RegExp(`[${CJK}]`);

/** 価格（¥・円・カンマ付き・前後が空白の3〜5桁） */
const PRICE_RE =
  /(?:¥\s*\d{1,3}(?:,\d{3})+|\d{1,3}(?:,\d{3})+\s*円?|¥\s*\d{2,6}|\d{2,6}\s*円|(?<=\s|^)\d{3,5}(?=\s|$))/g;

const DRINK_WORDS = /ドリンク|ビール|酒|ワイン|サワー|ハイボール|カクテル|ソフト|焼酎|梅酒|ウイスキー|ジュース|コーヒー|ティー|茶|drink|beer|wine|cocktail|sake|soft/i;

/** 全角→半角・余分な空白・漢字かなの間の空白（OCR は1文字ずつ空ける）を整える */
export function normalizeOcrLine(line: string): string {
  let s = line.normalize('NFKC').replace(/\\/g, '¥').replace(/[　\t]/g, ' ');
  s = s.replace(CJK_SPACE, '$1');
  // 写真の読み取りで「1,280円」のカンマが空白・点になる（「1 280円」「1.280円」）→ 1,280
  s = s.replace(/(^|[^\d,])(\d{1,2})[ .](\d{3})(?=\s*円|\s*$)/g, '$1$2,$3');
  // 「580円（税込638円）」→ 税込の金額にする
  s = s.replace(/(?:¥\s*)?[\d,]+\s*円?\s*\(\s*税込\s*¥?\s*([\d,]+)\s*円?\s*\)/g, '¥$1');
  // （税込）（税抜）などの印は消す
  s = s.replace(/\(\s*税(?:込|抜|別)\s*\)/g, ' ');
  // 価格にしない数字：電話番号・時間・日付・郵便番号
  s = s
    .replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, ' ')
    .replace(/〒?\s*\d{3}-\d{4}/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/\d{4}\s*[/年.]\s*\d{1,2}/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function priceValue(token: string): number | null {
  const n = Number(token.replace(/[¥円,\s]/g, ''));
  if (!Number.isFinite(n) || n < 10 || n > 999999) return null;
  return n;
}

/** 商品名の前後の飾り（点線・記号・番号）を取る */
function cleanName(raw: string): string {
  return raw
    .replace(/^[\s\-・•●○◎■□◆◇★☆※*#>]+/, '')
    .replace(/^\d{1,2}[.)]\s*/, '')
    .replace(/[\s.…‥・·_:：]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 「生ビール Draft Beer」→ 日本語名と英語名に分ける */
function splitEnglish(name: string): { name: string; nameEn: string } {
  const m = name.match(new RegExp(`^(.*[${CJK}].*?)\\s+([A-Za-z][A-Za-z0-9 '&./-]*)$`));
  if (m && HAS_CJK.test(m[1])) return { name: m[1].trim(), nameEn: m[2].trim() };
  return { name, nameEn: '' };
}

function isDescription(line: string): boolean {
  return line.length >= 25 || /[。、]/.test(line);
}

function isAsciiOnly(line: string): boolean {
  return /^[\x20-\x7e]+$/.test(line);
}

function looksLikeHeading(line: string): boolean {
  if (!HAS_WORD.test(line) || line.length > 16) return false;
  // 数字ばかりの行（ページ番号など）は見出しにしない
  return (line.match(/\d/g)?.length ?? 0) <= 2;
}

/** 読み取った行の並び → 商品の行 */
export function parseMenuLines(lines: string[], defaultCategory = 'メニュー'): MenuOcrRow[] {
  const out: MenuOcrRow[] = [];
  const seen = new Set<string>();
  let category = '';
  let pending: { name: string; nameEn: string } | null = null;

  const push = (rawName: string, nameEnHint: string, price: number) => {
    const cleaned = cleanName(rawName);
    if (!cleaned || !HAS_WORD.test(cleaned) || cleaned.length > 40) return;
    const split = nameEnHint ? { name: cleaned, nameEn: nameEnHint } : splitEnglish(cleaned);
    const categoryName = category || defaultCategory;
    const key = `${categoryName}|${split.name}|${price}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      categoryName,
      name: split.name,
      nameEn: split.nameEn,
      price,
      itemType: DRINK_WORDS.test(categoryName) || DRINK_WORDS.test(split.name) ? 'drink' : 'food',
    });
  };

  for (const rawLine of lines) {
    const line = normalizeOcrLine(rawLine);
    if (!line) continue;

    const matches = [...line.matchAll(PRICE_RE)].filter((m) => priceValue(m[0]) !== null);
    if (matches.length === 0) {
      if (isDescription(line)) continue;
      const nameLike = cleanName(line);
      if (!nameLike) continue;
      // 日本語名の次の英語だけの行は、その英語名
      if (pending && isAsciiOnly(nameLike) && HAS_CJK.test(pending.name) && !pending.nameEn) {
        pending.nameEn = nameLike;
        continue;
      }
      // 価格の無い行が続いたら、前の行は見出し（カテゴリ）
      if (pending && looksLikeHeading(pending.name)) category = pending.name;
      pending = { name: nameLike, nameEn: '' };
      continue;
    }

    let cursor = 0;
    for (const m of matches) {
      const price = priceValue(m[0]) as number;
      const before = line.slice(cursor, m.index).trim();
      cursor = (m.index ?? 0) + m[0].length;
      if (cleanName(before)) {
        // 名前と価格が同じ行。前に価格の無い行があれば、それは見出し
        if (pending && looksLikeHeading(pending.name)) category = pending.name;
        pending = null;
        push(before, '', price);
      } else if (pending) {
        // 価格だけの行 → 前の名前の行と合わせて1商品
        push(pending.name, pending.nameEn, price);
        pending = null;
      }
    }
    // 価格の後ろに残った文字（次の行の価格の名前のことがある）
    const rest = cleanName(line.slice(cursor));
    pending = rest && !isDescription(rest) && HAS_WORD.test(rest) ? { name: rest, nameEn: '' } : null;
  }
  return out;
}

/** PDF の文字（pdf.js の getTextContent の items）。使うのは文字と位置だけ */
export interface PdfTextItem {
  str: string;
  /** [a, b, c, d, x, y]（y は下から上へ） */
  transform: number[];
  width?: number;
  height?: number;
}

/**
 * PDF の文字の並び → 行（上から下・左から右）。同じ高さ（文字の高さの半分以内）は同じ行。
 * 離れている文字（文字の高さの 1/4 より広いすき間）のあいだは空白を入れる（「生ビール 580」の区切り）。
 */
export function pdfTextLines(items: PdfTextItem[]): string[] {
  const pieces = items
    .filter((it) => typeof it.str === 'string' && it.str.trim() !== '' && Array.isArray(it.transform))
    .map((it) => {
      const h = Math.abs(it.height || it.transform[3] || it.transform[0] || 10);
      return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? it.str.length * h * 0.6, h };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: { y: number; h: number; parts: typeof pieces }[] = [];
  for (const p of pieces) {
    const row = rows.find((r) => Math.abs(r.y - p.y) <= Math.max(r.h, p.h) * 0.5);
    if (row) row.parts.push(p);
    else rows.push({ y: p.y, h: p.h, parts: [p] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    const parts = r.parts.sort((a, b) => a.x - b.x);
    let line = '';
    let end: number | null = null;
    for (const p of parts) {
      if (end !== null && p.x - end > p.h * 0.25) line += ' ';
      line += p.str;
      end = p.x + p.w;
    }
    return line.trim();
  });
}
