/**
 * Server Action のエラーを、現場の人が読める日本語で画面に出すための決まりごと。
 *
 * 背景: Next.js は Server Action の中で throw された例外の本文を、本番ビルドでは
 * クライアントへ渡さない。代わりに React の汎用エラー
 * 「An error occurred in the Server Components render...（Minified React error #441）」
 * に差し替えられる。つまりサーバー側でどれだけ丁寧な日本語メッセージを作っても、
 * throw してしまうと店舗の画面にはあの赤い英語の箱しか出ない。
 *
 * 原則: レジ・会計など現場が毎日触る処理は、throw せずに ActionResult を「返す」。
 * この ActionResult はただの値なので、本文がそのままクライアントに届く。
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

export const actionOk = (): ActionResult => ({ ok: true });
export const actionFail = (error: string): ActionResult => ({ ok: false, error });

/** 本番で伏せられたエラー本文の目印（そのまま画面に出すと意味不明な英語になる） */
const REDACTED_MARKERS = [
  'omitted in production builds',
  'An error occurred in the Server Components render',
  'Minified React error',
];

/**
 * まだ throw のままのアクションを拾うための保険。
 * 伏せられた本文はそのまま出さず、画面ごとの日本語フォールバックに置き換える。
 * @param err      catch した値
 * @param fallback その画面での言い回し（例: 'レジの開局に失敗しました'）
 */
export function toUserMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const message = err.message?.trim();
  if (!message) return fallback;
  if (REDACTED_MARKERS.some((marker) => message.includes(marker))) return fallback;
  return message;
}
