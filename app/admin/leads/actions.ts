'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

const STATUSES = ['new', 'contacted', 'closed'] as const;
type LeadStatus = (typeof STATUSES)[number];

/** 問い合わせ（リード）のステータスを更新する（CYPRESS運営のみ） */
export async function updateLeadStatus(id: string, status: string): Promise<{ error?: string }> {
  await requireCypressAdmin();
  if (!STATUSES.includes(status as LeadStatus)) return { error: '不正なステータスです' };

  const admin = createAdminClient();
  const { error } = await admin.from('contact_requests').update({ status }).eq('id', id);
  if (error) return { error: '更新に失敗しました' };

  revalidatePath('/admin/leads');
  return {};
}
