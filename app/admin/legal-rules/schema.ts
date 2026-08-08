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

/**
 * 「法定ルール」タブの区分フィルタ（#15）。rule_type（DBのenum）はエンジン実装単位の粒度だが、
 * 税理士・社労士等が探す単位（所得税/健保/厚生年金/介護/雇用保険/割増率/その他）はこれより粗い
 * ため、表示用にRULE_TYPEをRuleCategoryへマッピングする。DB側の変更は不要（表示層のみの分類）。
 */
export const RULE_CATEGORIES = [
  'income_tax',
  'social_insurance_health',
  'social_insurance_pension',
  'care_insurance',
  'employment_insurance',
  'labor_standard',
  'other',
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  income_tax: '所得税',
  social_insurance_health: '健康保険',
  social_insurance_pension: '厚生年金',
  care_insurance: '介護保険',
  employment_insurance: '雇用保険',
  labor_standard: '割増率',
  other: 'その他',
};

/** rule_type（DB enum） → 表示区分。depreciation/consumption_tax は「その他」にまとめる。 */
export const RULE_TYPE_TO_CATEGORY: Record<RuleType, RuleCategory> = {
  income_tax: 'income_tax',
  social_insurance_health: 'social_insurance_health',
  social_insurance_pension: 'social_insurance_pension',
  care_insurance: 'care_insurance',
  employment_insurance: 'employment_insurance',
  labor_standard: 'labor_standard',
  depreciation: 'other',
  consumption_tax: 'other',
};

/** YYYY-MM-DD 形式チェック（actions.ts / コンポーネントで共有） */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * レビュー完了（draft→reviewed）時に必須の3項目。DBトリガー
 * enforce_legal_rule_transition()のREVIEW_INFO_REQUIREDと同じ条件をUI側でも事前検証する
 * （エラーをDB往復させずに即時フィードバックするため。最終防衛はDBトリガー）。
 */
export const reviewInfoSchema = z.object({
  basis: z.string().trim().min(1, '根拠（法令名・通達・公的資料URL等）を入力してください'),
  reviewedByName: z.string().trim().min(1, '確認者を入力してください'),
  reviewedAt: z.string().regex(DATE_RE, '確認日を入力してください'),
});

export type ReviewInfoInput = z.infer<typeof reviewInfoSchema>;

/**
 * DBトリガー（00022_backoffice_hardening.sql）のエラーコードを日本語メッセージへ変換する。
 * 一致しない場合は元のメッセージをそのまま返す（想定外エラーを握りつぶさない）。
 */
const DB_ERROR_LABELS: [pattern: RegExp, label: string][] = [
  [/INVALID_STATUS_TRANSITION/, 'この状態には変更できません（許可されていない遷移です）'],
  [/REVIEW_INFO_REQUIRED/, '根拠・確認者・確認日をすべて入力してからレビュー完了にしてください'],
  [/INSERT_MUST_BE_DRAFT/, '新規登録できるのは「下書き」状態のみです'],
  [
    /ACTIVE_RULE_IMMUTABLE/,
    '有効化済みルールの値（parameters）は変更できません。新しいversionを作成してください',
  ],
];

export function translateLegalRuleError(message: string): string {
  for (const [pattern, label] of DB_ERROR_LABELS) {
    if (pattern.test(message)) return label;
  }
  return message;
}
