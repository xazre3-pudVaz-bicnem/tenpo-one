'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

export interface CompanyInfoInput {
  name: string;
  nameKana: string;
  postalCode: string;
  address: string;
  phone: string;
  billingName: string;
  billingEmail: string;
  billingNote: string;
}

/** 企業情報（会社名・住所・連絡先・請求情報）の更新。org_owner/hq_admin のみ */
export async function updateCompanyInfo(input: CompanyInfoInput): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');

  const name = input.name.trim();
  if (!name) return { error: '会社名を入力してください' };

  const billingEmail = input.billingEmail.trim();
  if (billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) {
    return { error: '請求先メールアドレスの形式が正しくありません' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('organizations')
    .update({
      name,
      name_kana: input.nameKana.trim() || null,
      postal_code: input.postalCode.trim() || null,
      address: input.address.trim() || null,
      phone: input.phone.trim() || null,
      billing_info: {
        name: input.billingName.trim() || null,
        email: billingEmail || null,
        note: input.billingNote.trim() || null,
      },
      updated_by: ctx.userId,
    })
    .eq('id', ctx.organizationId);
  if (error) return { error: `企業情報の保存に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/company');
  return {};
}
