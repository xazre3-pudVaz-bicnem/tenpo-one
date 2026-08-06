'use server';

import { requireCypressAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** サポートアクセスの記録。企業データへのアクセス前に必ず理由とともに記録する */
export async function logSupportAccess(organizationId: string, reason: string) {
  await requireCypressAdmin();
  const supabase = await createClient();

  if (!organizationId) throw new Error('企業を選択してください');
  const note = reason.trim();
  if (!note) throw new Error('アクセス理由を入力してください');

  const { error } = await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: null,
    p_action: 'support_access',
    p_target_table: 'organizations',
    p_target_id: organizationId,
    p_before: null,
    p_after: null,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}
