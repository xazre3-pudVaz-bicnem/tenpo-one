import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * サービスロールクライアント（RLSバイパス）。
 * ユーザー招待・PIN打刻照合など、権限検証を自前で行う処理のみで使用する。
 * 絶対にクライアントへ渡さないこと。
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY が設定されていません');
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
