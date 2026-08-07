'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { FEATURE_KEYS, type FeatureKey } from '@/lib/features';

export interface PlanInput {
  code: string;
  name: string;
  monthlyPrice: number;
  description: string;
  sortOrder: number;
  isActive: boolean;
  /** 上限なしは null */
  storeLimit: number | null;
  userLimit: number | null;
  /** false のキーのみ「プラン既定を適用」で企業のfeature_flagsへ反映される */
  features: Partial<Record<FeatureKey, boolean>>;
}

function buildFeaturesJson(input: Pick<PlanInput, 'storeLimit' | 'userLimit' | 'features'>) {
  const features: Partial<Record<FeatureKey, boolean>> = {};
  for (const key of FEATURE_KEYS) {
    if (input.features[key] === false) features[key] = false;
  }
  return {
    store_limit: input.storeLimit,
    user_limit: input.userLimit,
    features,
  };
}

export async function createPlan(input: PlanInput) {
  await requireCypressAdmin();
  const supabase = await createClient();

  const code = input.code.trim();
  const name = input.name.trim();
  if (!code) throw new Error('プランコードを入力してください');
  if (!name) throw new Error('プラン名を入力してください');

  const { error } = await supabase.from('plans').insert({
    code,
    name,
    monthly_price: Math.max(0, Math.floor(input.monthlyPrice) || 0),
    description: input.description.trim() || null,
    sort_order: input.sortOrder,
    is_active: input.isActive,
    features: buildFeaturesJson(input),
  });
  if (error) throw new Error(error.message);

  revalidatePath('/admin/plans');
  revalidatePath('/pricing');
}

export async function updatePlan(id: string, input: PlanInput) {
  await requireCypressAdmin();
  const supabase = await createClient();

  const name = input.name.trim();
  if (!name) throw new Error('プラン名を入力してください');

  const { error } = await supabase
    .from('plans')
    .update({
      name,
      monthly_price: Math.max(0, Math.floor(input.monthlyPrice) || 0),
      description: input.description.trim() || null,
      sort_order: input.sortOrder,
      is_active: input.isActive,
      features: buildFeaturesJson(input),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/admin/plans');
  revalidatePath('/pricing');
  revalidatePath('/admin/organizations');
}
