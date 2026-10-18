/**
 * 店舗名を「店名」と「支店名」の2行に分ける（印刷物の店舗名。2026-10-19 Ronnie「店名が途中で折り返して上下に
 * 分かれるのはダメ。1行目に店名、2行目に支店」）。
 *   「ORIENTAL ELEPHANT 高田馬場店」→ ORIENTAL ELEPHANT ／ 高田馬場店
 *   「MEAT CROWN 新横浜」→ MEAT CROWN ／ 新横浜
 *   「MEAT CROWN新横浜」（スペースなし）→ MEAT CROWN ／ 新横浜（英字のあとに日本語が続くところ）
 *   「ORIENTAL ELEPHANT」「しゅんか」→ 1行のまま
 * 最後の区切り（半角・全角スペース）のあとが日本語（漢字・かな）で始まるときだけ分ける。
 */
const JP = /[぀-ヿ㐀-鿿豈-﫿]/;

export function splitStoreName(name: string): { brand: string; branch: string | null } {
  const s = name.trim().replace(/\s+/g, ' ').replace(/　+/g, ' ');
  const m = /^(.*\S)\s+(\S+)$/.exec(s);
  if (m && JP.test(m[2].charAt(0)) && m[1].trim()) return { brand: m[1].trim(), branch: m[2] };
  // スペースなし：英字・記号の店名のあとに日本語の支店名
  const m2 = /^([A-Za-z0-9][A-Za-z0-9&＆'’.・\-\s]*[A-Za-z0-9.])\s*([぀-ヿ㐀-鿿].*)$/.exec(s);
  if (m2) return { brand: m2[1].trim(), branch: m2[2].trim() };
  return { brand: s, branch: null };
}

/**
 * 1行に収まる文字の大きさ（pt）。日本語は1文字1em、英数字は約0.66em（太字・字間込み）として、
 * 幅 maxMm に入る大きさを maxPt〜minPt の間で選ぶ（折り返さない）。
 */
export function fitPt(text: string, maxMm: number, maxPt: number, minPt: number): number {
  let em = 0;
  for (const ch of text) em += JP.test(ch) || /[！-～]/.test(ch) ? 1.04 : ch === ' ' ? 0.3 : 0.68;
  if (em === 0) return maxPt;
  const pt = maxMm / (em * 0.3528);
  return Math.round(Math.min(maxPt, Math.max(minPt, pt)) * 10) / 10;
}
