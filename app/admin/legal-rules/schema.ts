/**
 * 法定ルール管理（/admin/legal-rules）の型・ラベル・parameters JSON検証。
 * legal_rule_versions.parameters は「所得税額表・社会保険料率」等の法定数値を保持するjsonb列
 * （00020_native_accounting.sql）。ここでは値そのものの法令適合性は検証しない（推測で法定数値を
 * 埋めない方針。専門家レビューで担保する）。検証するのは「有効なJSONオブジェクトであること」のみ。
 */

import { z } from 'zod';

export const legalRuleParametersSchema = z.record(z.string(), z.unknown());

export type ParseLegalRuleParametersResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/** JSONエディタ（textarea）の生テキストを検証する。構文エラー・非オブジェクトを弾く。 */
export function parseLegalRuleParameters(raw: string): ParseLegalRuleParametersResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'JSONを入力してください（空の場合は {} ）' };

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'JSONとして解析できません（構文エラー）' };
  }

  const parsed = legalRuleParametersSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: 'JSONオブジェクト（{ "key": ... } の形式）である必要があります' };
  }
  return { ok: true, value: parsed.data };
}

export const RULE_TYPES = [
  'income_tax',
  'social_insurance_health',
  'social_insurance_pension',
  'employment_insurance',
  'care_insurance',
  'labor_standard',
  'depreciation',
  'consumption_tax',
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  income_tax: '所得税',
  social_insurance_health: '社会保険（健康保険）',
  social_insurance_pension: '社会保険（厚生年金）',
  employment_insurance: '雇用保険',
  care_insurance: '介護保険',
  labor_standard: '労働基準',
  depreciation: '減価償却',
  consumption_tax: '消費税',
};

export const RULE_STATUSES = ['draft', 'reviewed', 'active', 'superseded'] as const;

export type RuleStatus = (typeof RULE_STATUSES)[number];

export const RULE_STATUS_LABELS: Record<RuleStatus, string> = {
  draft: '下書き',
  reviewed: 'レビュー済み',
  active: '有効',
  superseded: '置換済み',
};

export const TAX_TREATMENTS = ['taxable_standard', 'taxable_reduced'] as const;

export type ConsumptionTaxTreatment = (typeof TAX_TREATMENTS)[number];

export const TAX_TREATMENT_LABELS: Record<ConsumptionTaxTreatment, string> = {
  taxable_standard: '課税（標準）',
  taxable_reduced: '課税（軽減）',
};
