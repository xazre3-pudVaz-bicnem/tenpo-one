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

/**
 * 表がまだ無い（migration 未適用）ことによるエラーか。
 *   relation "public.display_devices" does not exist（42P01）
 *   Could not find the table 'public.display_devices' in the schema cache（PGRST205）
 */
export function isMissingTableError(error: { message?: string | null; code?: string | null } | null | undefined, table: string): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  // コードが「表が無い」でも、文に別の表の名前が出ているときはその表のこと（例: 埋め込みの相手の表）
  if ((error.code === '42P01' || error.code === 'PGRST205') && (!message || message.includes(table))) return true;
  return message.includes(table) && /does not exist|schema cache|could not find the table/i.test(message);
}
