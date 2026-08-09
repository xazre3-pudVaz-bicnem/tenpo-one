'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limit';

/** IPベースのレート制限キー（x-forwarded-for優先） */
async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

const schema = z.object({
  companyName: z.string().trim().max(120).optional(),
  storeName: z.string().trim().max(120).optional(),
  contactName: z.string().trim().min(1, 'お名前を入力してください').max(80),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email('メールアドレスの形式が正しくありません').max(160),
  storeCount: z.enum(['1', '2-5', '6-10', '11-30', '31+']).optional(),
  currentTools: z.string().trim().max(300).optional(),
  message: z.string().trim().max(2000).optional(),
});

export interface ContactResult {
  ok: boolean;
  error?: string;
}

/**
 * 問い合わせ（リード）を contact_requests へ保存する。
 * メール送信APIは未接続のため、保存された内容はCYPRESS運営が /admin/leads で確認する。
 * 保存が成功した場合のみ ok:true を返す（見せかけの成功にしない）。
 */
export async function submitContact(input: unknown): Promise<ContactResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' };
  }

  const ip = await requestIp();
  if (!rateLimiter.check(`contact:${ip}`, RATE_LIMITS.contact.limit, RATE_LIMITS.contact.windowMs)) {
    return { ok: false, error: '短時間に送信が集中しています。しばらくしてからお試しください' };
  }

  const d = parsed.data;
  const admin = createAdminClient();
  const { error } = await admin.from('contact_requests').insert({
    company_name: d.companyName || null,
    store_name: d.storeName || null,
    contact_name: d.contactName,
    phone: d.phone || null,
    email: d.email,
    store_count: d.storeCount || null,
    current_tools: d.currentTools || null,
    message: d.message || null,
    source: 'contact_page',
  });
  if (error) {
    return { ok: false, error: '送信に失敗しました。時間をおいて再度お試しください' };
  }
  return { ok: true };
}
