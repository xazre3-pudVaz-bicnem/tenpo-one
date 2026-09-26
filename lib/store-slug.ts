/**
 * 公開予約URLのスラッグ（stores.slug）の決まり。店舗設定と CYPRESS 運営画面で共通。
 * 2026-09-27 Ronnie「予約URLは店舗から変えられないように。CYPRESS からだけ」
 */
export const RESERVED_SLUGS = new Set(['book', 'booking', 'order', 'admin', 'app', 'api', 'login', 'www', 'assets', 'public']);
// 3〜50文字・英小文字/数字/ハイフン・先頭末尾は英数字・連続ハイフン不可
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 店舗から予約URLを変えようとしたときのメッセージ */
export const SLUG_CHANGE_BY_CYPRESS_ONLY = '予約URL（スラッグ）の変更は運営（CYPRESS）だけが行えます。変更したいときは運営にご連絡ください';

/** 正規化（小文字・前後の空白除去）。問題があれば日本語の理由を返す */
export function normalizeStoreSlug(raw: string): { slug: string; error?: string } {
  const slug = raw.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 50) return { slug, error: 'スラッグは3〜50文字で入力してください' };
  if (!SLUG_RE.test(slug)) return { slug, error: '英小文字・数字・ハイフンのみ使用できます（先頭末尾は英数字、ハイフンの連続不可）' };
  if (RESERVED_SLUGS.has(slug)) return { slug, error: 'このスラッグは使用できません。別の文字列を指定してください' };
  return { slug };
}
