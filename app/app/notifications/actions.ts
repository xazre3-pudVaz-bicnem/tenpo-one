'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** 自分宛の未読通知をすべて既読にする */
export async function markAllRead() {
  const ctx = await requireSession();
  const supabase = await createClient();
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', ctx.userId)
    .is('read_at', null);
  revalidatePath('/app', 'layout');
}
