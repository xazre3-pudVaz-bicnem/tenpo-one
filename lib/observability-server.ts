import 'server-only';
import {
  newErrorId,
  logStructuredError,
  sanitizeDetail,
  userFacingError,
  type ErrorContext,
} from '@/lib/observability';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type { ErrorContext };
export { userFacingError };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return '不明なエラー';
  }
}

/**
 * サーバー側エラー捕捉の共通処理。
 * 1) エラーIDを発行する
 * 2) 構造化ログを出力する（lib/observability.ts の logStructuredError。Vercel関数ログへJSON1行）
 * 3) system_errors へ永続化する（log_system_error RPC）
 *
 * log_system_error はSECURITY DEFINERだが auth.uid() が null の呼び出しは何もせず正常終了する
 * （migration 00029参照）。そのため、まずCookie/JWTを持つセッションクライアント
 * （lib/supabase/server の createClient）で呼び出し、それが使えない文脈
 * （セッション外・failしたログイン等）では createAdminClient() でも試みる
 * （ただしservice roleにはauth.uid()が無いため、この経路ではDB行は作られないことがある。
 * その場合も構造化ログには必ず出力済みなのでVercelログから追跡できる）。
 * DB永続化に失敗してもエラーIDは必ず返す（観測性の欠落でユーザー処理を止めない）。
 */
export async function captureServerError(error: unknown, ctx: ErrorContext = {}): Promise<string> {
  const errorId = newErrorId();
  const message = errorMessage(error);
  logStructuredError(errorId, message, ctx);

  const payload = {
    p_error_id: errorId,
    p_request_id: ctx.requestId ?? null,
    p_org: ctx.organizationId ?? null,
    p_store: ctx.storeId ?? null,
    p_route: ctx.route ?? null,
    p_severity: ctx.severity ?? 'error',
    p_message: message.slice(0, 500),
    p_detail: sanitizeDetail(ctx.detail),
  };

  try {
    const supabase = await createClient();
    const { error: rpcError } = await supabase.rpc('log_system_error', payload);
    if (rpcError) throw rpcError;
    return errorId;
  } catch {
    // セッションクライアントで送れなかった場合のみservice roleでも試みる（下記catchで握りつぶす）
  }

  try {
    const admin = createAdminClient();
    await admin.rpc('log_system_error', payload);
  } catch {
    // DB永続化の失敗は握りつぶす（構造化ログには既に出力済みのため追跡は可能）
  }

  return errorId;
}

/**
 * Server Action共通のtry/catchラッパ（任意利用）。
 * fn実行中に投げられた例外だけを捕捉し、captureServerErrorで記録した上で
 * 「エラーID: XXX」を含むユーザー向けメッセージを持つErrorとして再送出する。
 * fnが正常に値を返す場合（あるいはActionResult形の{error:...}を戻り値として返す場合）はそのまま素通しする。
 */
export async function withErrorCapture<T>(ctx: ErrorContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const errorId = await captureServerError(error, ctx);
    throw new Error(userFacingError(errorId, errorMessage(error)));
  }
}
