/**
 * ログイン後などのリダイレクト先を検証する。
 * オープンリダイレクト（`//evil.com`, `/\evil.com`, `https://evil.com`,
 * バックスラッシュ・制御文字によるスキーム偽装）を排除し、
 * 自サイト内の絶対パスのみを許可する。該当しない場合は fallback を返す。
 */
export function safeNextPath(next: string | null | undefined, fallback = '/app/dashboard'): string {
  if (!next) return fallback;
  // 単一スラッシュ始まりのパスのみ許可
  if (next[0] !== '/') return fallback;
  // プロトコル相対 `//host` / バックスラッシュ経由 `/\host` を拒否
  if (next[1] === '/' || next[1] === '\\') return fallback;
  // 制御文字・空白（改行・タブ・スペースによる回避）を拒否
  if (/[\x00-\x20\x7f]/.test(next)) return fallback;
  // 明示スキーム混入を拒否（保険）: 最初のパスセグメントにコロンを含まない
  if (/^\/[^/]*:/.test(next)) return fallback;
  return next;
}
