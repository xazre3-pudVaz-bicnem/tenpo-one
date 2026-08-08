import { z } from 'zod';

/**
 * 年末調整申告データのスキーマ（構造のみ）。
 * 税額計算は行わない。専門家レビュー完了後に計算機能を追加する前提のデータ収集用。
 */
export const dependentSchema = z.object({
  name: z.string().min(1, '扶養家族の氏名を入力してください').max(100),
  relation: z.string().min(1, '続柄を入力してください').max(50),
  birthDate: z.string().min(1, '生年月日を入力してください'),
});
export type Dependent = z.infer<typeof dependentSchema>;

export const nenchoDataSchema = z.object({
  dependents: z.array(dependentSchema).max(20),
  hasSpouse: z.boolean(),
  spouseIncome: z.number().min(0).max(100_000_000).nullable(),
  lifeInsurancePremium: z.number().min(0).max(100_000_000),
  earthquakeInsurancePremium: z.number().min(0).max(100_000_000),
  hasHousingLoanDeduction: z.boolean(),
  hasPreviousEmploymentIncome: z.boolean(),
  basicDeductionNote: z.string().max(1000),
});
export type NenchoData = z.infer<typeof nenchoDataSchema>;

export function emptyNenchoData(): NenchoData {
  return {
    dependents: [],
    hasSpouse: false,
    spouseIncome: null,
    lifeInsurancePremium: 0,
    earthquakeInsurancePremium: 0,
    hasHousingLoanDeduction: false,
    hasPreviousEmploymentIncome: false,
    basicDeductionNote: '',
  };
}
