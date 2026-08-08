'use server';

import { revalidatePath } from 'next/cache';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { canWriteAccounting } from '@/components/accounting/roles';
import type { DepreciationMethod } from '@/components/accounting/labels';

export interface ActionResult {
  error?: string;
}

const LIST_PATH = '/app/accounting/assets';

export interface FixedAssetInput {
  id?: string;
  name: string;
  acquiredOn: string;
  acquisitionCost: number;
  usefulLifeYears: number | null;
  depreciationMethod: DepreciationMethod;
  storeId: string | null;
  note: string | null;
}

async function requireAccountingWrite() {
  const ctx = await requireFeature('accounting');
  if (!canWriteAccounting(ctx.role)) throw new Error('この操作を行う権限がありません');
  return ctx;
}

/** 固定資産の追加・更新（減価償却の自動計算は未実装。台帳としての登録・管理のみ） */
export async function saveFixedAsset(input: FixedAssetInput): Promise<ActionResult> {
  const ctx = await requireAccountingWrite();
  const name = input.name.trim();
  if (!name) return { error: '名称を入力してください' };
  if (!input.acquiredOn) return { error: '取得日を入力してください' };
  if (!Number.isFinite(input.acquisitionCost) || input.acquisitionCost < 0) return { error: '取得価額を正しく入力してください' };
  if (input.storeId && !ctx.stores.some((s) => s.id === input.storeId)) return { error: '対象店舗にアクセス権がありません' };

  const supabase = await createClient();
  const payload = {
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    name,
    acquired_on: input.acquiredOn,
    acquisition_cost: Math.round(input.acquisitionCost),
    useful_life_years: input.usefulLifeYears,
    depreciation_method: input.depreciationMethod,
    note: input.note,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await supabase.from('fixed_assets').update(payload).eq('id', input.id).eq('organization_id', ctx.organizationId);
    if (error) return { error: `固定資産の更新に失敗しました: ${error.message}` };
  } else {
    const { error } = await supabase.from('fixed_assets').insert({ ...payload, created_by: ctx.userId });
    if (error) return { error: `固定資産の登録に失敗しました: ${error.message}` };
  }

  revalidatePath(LIST_PATH);
  return {};
}

/** 除却・売却・取消（状態と日付を更新するのみ。仕訳の自動計上は行わない） */
export async function changeFixedAssetStatus(
  id: string,
  status: 'in_use' | 'disposed' | 'sold',
  disposedOn: string | null
): Promise<ActionResult> {
  const ctx = await requireAccountingWrite();
  const supabase = await createClient();
  const { error } = await supabase
    .from('fixed_assets')
    .update({ status, disposed_on: status === 'in_use' ? null : disposedOn, updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `状態の更新に失敗しました: ${error.message}` };

  revalidatePath(LIST_PATH);
  return {};
}

/** 固定資産の削除（論理削除） */
export async function deleteFixedAsset(id: string): Promise<ActionResult> {
  const ctx = await requireAccountingWrite();
  const supabase = await createClient();
  const { error } = await supabase
    .from('fixed_assets')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `削除に失敗しました: ${error.message}` };

  revalidatePath(LIST_PATH);
  return {};
}
