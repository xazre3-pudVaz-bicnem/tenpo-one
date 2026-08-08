'use server';

/**
 * 法定ルール管理（/admin/legal-rules）のServer Action。
 * consumption_tax_rates / legal_rule_versions は00020_native_accounting.sqlのRLSで
 * 書込がCYPRESS運営（app_is_cypress_admin）に限定されている。requireCypressAdmin()に加え、
 * DB側RLSでも二重に保護される（一般企業ユーザーはRLSにより書込不可）。
 */

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  parseLegalRuleParameters,
  RULE_TYPES,
  RULE_STATUSES,
  TAX_TREATMENTS,
  type RuleType,
  type RuleStatus,
  type ConsumptionTaxTreatment,
} from './schema';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ConsumptionTaxRateInput {
  treatment: ConsumptionTaxTreatment;
  /** % 表記（例: 10 / 8） */
  rate: number;
  effectiveFrom: string;
  version: string;
  note: string;
}

/** YYYY-MM-DD の前日を求める（UTC演算・カレンダー日付として扱う）。 */
function previousDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * 消費税率の改正登録: 新行をinsertし、同区分で適用終了日が未設定（現行）の行があれば
 * 新行の適用開始日の前日を適用終了日として設定する（旧行を締める）。過去に確定した仕訳・
 * レシートは journal_entry_lines.tax_treatment のタグと当時の税率行から再現され、この操作では
 * 遡って変更されない。
 */
export async function createConsumptionTaxRate(input: ConsumptionTaxRateInput) {
  await requireCypressAdmin();
  const supabase = await createClient();

  if (!TAX_TREATMENTS.includes(input.treatment)) {
    throw new Error('区分が不正です');
  }
  if (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100) {
    throw new Error('税率は0〜100の数値で入力してください');
  }
  if (!DATE_RE.test(input.effectiveFrom)) {
    throw new Error('適用開始日を入力してください');
  }
  const version = input.version.trim();
  if (!version) throw new Error('versionを入力してください');

  const effectiveToForOld = previousDay(input.effectiveFrom);

  const { error: closeError } = await supabase
    .from('consumption_tax_rates')
    .update({ effective_to: effectiveToForOld })
    .eq('treatment', input.treatment)
    .is('effective_to', null)
    .lt('effective_from', input.effectiveFrom);
  if (closeError) throw new Error(closeError.message);

  const { data: created, error } = await supabase
    .from('consumption_tax_rates')
    .insert({
      treatment: input.treatment,
      rate: input.rate,
      effective_from: input.effectiveFrom,
      version,
      note: input.note.trim() || null,
    })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message ?? '税率の登録に失敗しました');

  await supabase.rpc('log_audit', {
    p_org: null,
    p_store: null,
    p_action: 'consumption_tax_rate.create',
    p_target_table: 'consumption_tax_rates',
    p_target_id: created.id,
    p_before: null,
    p_after: {
      treatment: input.treatment,
      rate: input.rate,
      effective_from: input.effectiveFrom,
      version,
      closed_previous_effective_to: effectiveToForOld,
    },
    p_note: input.note.trim() || null,
  });

  revalidatePath('/admin/legal-rules');
}

export interface LegalRuleVersionInput {
  ruleType: RuleType;
  year: number;
  /** 空文字列 = 全国（region null） */
  region: string;
  effectiveFrom: string;
  /** 空文字列 = 現行（effective_to null） */
  effectiveTo: string;
  version: string;
  status: RuleStatus;
  /** JSONエディタの生テキスト。ここでzod検証する */
  parametersRaw: string;
  note: string;
}

function validateLegalRuleInput(input: LegalRuleVersionInput) {
  if (!RULE_TYPES.includes(input.ruleType)) throw new Error('rule_typeが不正です');
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    throw new Error('年度を正しく入力してください');
  }
  if (!DATE_RE.test(input.effectiveFrom)) throw new Error('適用開始日を入力してください');
  if (input.effectiveTo && !DATE_RE.test(input.effectiveTo)) {
    throw new Error('適用終了日の形式が不正です');
  }
  const version = input.version.trim();
  if (!version) throw new Error('versionを入力してください');
  if (!RULE_STATUSES.includes(input.status)) throw new Error('状態が不正です');

  const parsed = parseLegalRuleParameters(input.parametersRaw);
  if (!parsed.ok) throw new Error(`parameters: ${parsed.error}`);

  return { version, parameters: parsed.value };
}

/** 法定ルールversionの新規登録。既定はstatus='draft'（DB既定と一致）。 */
export async function createLegalRuleVersion(input: LegalRuleVersionInput) {
  await requireCypressAdmin();
  const supabase = await createClient();
  const { version, parameters } = validateLegalRuleInput(input);

  const { data: created, error } = await supabase
    .from('legal_rule_versions')
    .insert({
      rule_type: input.ruleType,
      year: input.year,
      region: input.region.trim() || null,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo || null,
      parameters,
      version,
      status: input.status,
      note: input.note.trim() || null,
    })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message ?? '法定ルールの登録に失敗しました');

  await supabase.rpc('log_audit', {
    p_org: null,
    p_store: null,
    p_action: 'legal_rule_version.create',
    p_target_table: 'legal_rule_versions',
    p_target_id: created.id,
    p_before: null,
    p_after: { rule_type: input.ruleType, year: input.year, version, status: input.status },
    p_note: input.note.trim() || null,
  });

  revalidatePath('/admin/legal-rules');
}

/** 法定ルールversionの編集（状態遷移 draft→reviewed→active→superseded を含む）。 */
export async function updateLegalRuleVersion(id: string, input: LegalRuleVersionInput) {
  await requireCypressAdmin();
  const supabase = await createClient();
  const { version, parameters } = validateLegalRuleInput(input);

  const { error } = await supabase
    .from('legal_rule_versions')
    .update({
      rule_type: input.ruleType,
      year: input.year,
      region: input.region.trim() || null,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo || null,
      parameters,
      version,
      status: input.status,
      note: input.note.trim() || null,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: null,
    p_store: null,
    p_action: 'legal_rule_version.update',
    p_target_table: 'legal_rule_versions',
    p_target_id: id,
    p_before: null,
    p_after: { rule_type: input.ruleType, year: input.year, version, status: input.status },
    p_note: input.note.trim() || null,
  });

  revalidatePath('/admin/legal-rules');
}
