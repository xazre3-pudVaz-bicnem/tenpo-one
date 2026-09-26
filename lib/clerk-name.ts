/**
 * 担当者名の表記（2026-09-27 Ronnie「英語で入れたら Ronnie のように先頭だけ大文字・あとは小文字に。大文字で入れても」）。
 * - 英字だけの単語（XITRI・miyazaki・rONNIE）→ 先頭だけ大文字・あとは小文字（Xitri・Miyazaki・Ronnie）
 * - 日本語・数字・記号の混ざった単語はそのまま（例: 田中・Staff-2・O'Brien は触らない）
 * - 前後の空白を除き、続いた空白は 1 つに
 */
export function normalizeClerkName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => (/^[A-Za-z]+$/.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}
