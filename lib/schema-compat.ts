/**
 * DB の migration より先にコードが本番に出たときの保険。
 *
 * 本番 DB（CYPRESS 管理）への SQL 適用と Vercel へのデプロイは別の人・別のタイミングで行われるため、
 * 「新しい列やRPC引数をまだ DB が知らない」期間ができる。その間も注文・会計・締めが止まらないよう、
 * 列が無いことによるエラーだけを見分けて、旧スキーマ向けの処理に切り替えるための判定。
 *
 * PostgREST のエラー例:
 *   column order_items.kitchen_sent_at does not exist（42703）
 *   Could not find the 'kitchen_sent_at' column of 'order_items' in the schema cache（PGRST204）
 *   Could not find the function public.open_register_session(p_opening_denominations, ...)（PGRST202）
 */
export function isMissingColumnError(message: string | null | undefined, column: string): boolean {
  if (!message) return false;
  return message.includes(column) && /column|schema cache|does not exist/i.test(message);
}

/** check 制約違反（例: print_jobs.job_type にまだ無い値を入れた） */
export function isCheckViolation(message: string | null | undefined, constraint?: string): boolean {
  if (!message) return false;
  if (constraint && !message.includes(constraint)) return false;
  return /check constraint|violates check/i.test(message);
}
