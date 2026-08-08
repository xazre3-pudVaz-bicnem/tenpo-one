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

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'org.settings.update',
    p_target_table: 'organizations',
    p_target_id: ctx.organizationId,
    p_before: null,
    p_after: { name, billing_email: billingEmail || null },
    p_note: null,
  });

  revalidatePath('/app/settings/company');
  return {};
}

export interface KpiSettings {
  /** テイクアウト・デリバリー・事前注文の客数を客数KPIに含めるか（省略時true。lib/metrics.ts参照） */
  includeTakeoutGuests?: boolean;
}

/** 客数KPI設定の更新（organizations.kpi_settings）。org_owner/hq_admin のみ */
export async function updateKpiSettings(includeTakeoutGuests: boolean): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('kpi_settings')
    .eq('id', ctx.organizationId)
    .single();
  const before = (org?.kpi_settings ?? {}) as KpiSettings;
  const next: KpiSettings = { ...before, includeTakeoutGuests };

  const { error } = await supabase
    .from('organizations')
    .update({ kpi_settings: next, updated_by: ctx.userId })
    .eq('id', ctx.organizationId);
  if (error) return { error: `KPI設定の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'org.settings.kpi_update',
    p_target_table: 'organizations',
    p_target_id: ctx.organizationId,
    p_before: before,
    p_after: next,
    p_note: null,
  });

  revalidatePath('/app/settings/company');
  revalidatePath('/app/dashboard');
  revalidatePath('/app/reports');
  revalidatePath('/app/budgets');
  revalidatePath('/app/daily-reports');
  return {};
}
