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
  reviewInfoSchema,
  translateLegalRuleError,
  DATE_RE,
  RULE_TYPES,
  TAX_TREATMENTS,
  type RuleType,
  type ConsumptionTaxTreatment,
  type ReviewInfoInput,
} from './schema';

function revalidateLegalRulePaths() {
  revalidatePath('/admin/legal-rules');
  revalidatePath('/admin/legal-rules/review');
}

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

  revalidateLegalRulePaths();
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
  /** JSONエディタの生テキスト。ここでzod検証する */
  parametersRaw: string;
  note: string;
  /** 根拠（法令名・通達・公的資料URL等） */
  basis: string;
  /** 確認者（税理士・社労士等。システム外の人物のため氏名で保持） */
  reviewedByName: string;
  /** 確認日（YYYY-MM-DD、空文字列可） */
  reviewedAt: string;
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
  if (input.reviewedAt && !DATE_RE.test(input.reviewedAt)) {
    throw new Error('確認日の形式が不正です');
  }

  const parsed = parseLegalRuleParameters(input.parametersRaw);
  if (!parsed.ok) throw new Error(`parameters: ${parsed.error}`);

  return { version, parameters: parsed.value };
}

/**
 * 法定ルールversionの新規登録。statusは常に'draft'（DBトリガーのINSERT_MUST_BE_DRAFTと一致）。
 * レビュー完了・有効化・差戻・置換は状態遷移専用のServer Action（下記）に一本化する。
 */
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
      note: input.note.trim() || null,
      basis: input.basis.trim() || null,
      reviewed_by_name: input.reviewedByName.trim() || null,
      reviewed_at: input.reviewedAt || null,
    })
    .select('id')
    .single();
  if (error || !created) throw new Error(translateLegalRuleError(error?.message ?? '法定ルールの登録に失敗しました'));

  await supabase.rpc('log_audit', {
    p_org: null,
    p_store: null,
    p_action: 'legal_rule_version.create',
    p_target_table: 'legal_rule_versions',
    p_target_id: created.id,
    p_before: null,
    p_after: { rule_type: input.ruleType, year: input.year, version, status: 'draft' },
    p_note: input.note.trim() || null,
  });

  revalidateLegalRulePaths();
}

/**
 * 法定ルールversionの編集。rule_type・年度・地域・適用期間・version・parameters・根拠・確認者・
 * 確認日・メモを更新する。status（状態）はここでは変更しない（変更するとDBトリガーの状態遷移
 * チェックが発火するため、専用の markLegalRuleReviewed / activateLegalRuleVersion /
 * revertLegalRuleToDraft / supersedeLegalRuleVersion を使う）。有効化・置換済みの行に対して
 * parametersを変更しようとするとDBトリガー（ACTIVE_RULE_IMMUTABLE）が拒否する。
 */
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
      note: input.note.trim() || null,
      basis: input.basis.trim() || null,
      reviewed_by_name: input.reviewedByName.trim() || null,
      reviewed_at: input.reviewedAt || null,
    })
    .eq('id', id);
  if (error) throw new Error(translateLegalRuleError(error.message));

  await supabase.rpc('log_audit', {
    p_org: null,
    p_store: null,
    p_action: 'legal_rule_version.update',
    p_target_table: 'legal_rule_versions',
    p_target_id: id,
    p_before: null,
    p_after: { rule_type: input.ruleType, year: input.year, version },
    p_note: input.note.trim() || null,
  });

  revalidateLegalRulePaths();
}

/**
 * レビュー完了にする（draft→reviewed）。根拠・確認者・確認日を同時に保存する。
 * DBトリガーが3項目の未入力をREVIEW_INFO_REQUIREDで拒否するため、事前にzod
 * （reviewInfoSchema）でも検証しUIへ即時フィードバックする。
 */
export async function markLegalRuleReviewed(id: string, input: ReviewInfoInput) {
  await requireCypressAdmin();
  const parsed = reviewInfoSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? '根拠・確認者・確認日を入力してください');
  }
  const supabase = await createClient();

  const { error } = await supabase
    .from('legal_rule_versions')
    .update({
      status: 'reviewed',
      basis: parsed.data.basis,
      reviewed_by_name: parsed.data.reviewedByName,
      reviewed_at: parsed.data.reviewedAt,
    })
    .eq('id', id);
  if (error) throw new Error(translateLegalRuleError(error.message));

  await supabase.rpc('log_audit', {
    p_org: null,
    p_store: null,
    p_action: 'legal_rule_version.review',
    p_target_table: 'legal_rule_versions',
    p_target_id: id,
    p_before: null,
    p_after: { status: 'reviewed', ...parsed.data },
    p_note: null,
  });

  revalidateLegalRulePaths();
}

/**
 * 有効化する（reviewed→active）。activated_by/activated_atはDBトリガーが自動記録するが、
 * 「実行者が記録される」ことを利用者に明示するため log_audit RPC でも重ねて記録する
 * （p_action: 'legal_rule.activate'）。有効化以降、給与・税計算エンジンからこのルールが
 * 参照可能になる想定（参照フィルタの実装は各計算エンジン側。docs/legal-rule-versioning.md参照）。
 */
export async function activateLegalRuleVersion(id: string) {
  await requireCypressAdmin();
  const supabase = await createClient();

  const { data: current, error: fetchError } = await supabase
    .from('legal_rule_versions')
    .select('rule_type, year, version, status')
    .eq('id', id)
    .single();
  if (fetchError || !current) throw new Error(fetchError?.message ?? 'ルールが見つかりません');

  const { error } = await supabase.from('legal_rule_versions').update({ status: 'active' }).eq('id', id);
  if (error) throw new Error(translateLegalRuleError(error.message));

  await supabase.rpc('log_audit', {
    p_org: null,
    p_store: null,
    p_action: 'legal_rule.activate',
    p_target_table: 'legal_rule_versions',
    p_target_id: id,
    p_before: { status: current.status },
    p_after: { status: 'active', rule_type: current.rule_type, year: current.year, version: current.version },
    p_note: null,
  });

  revalidateLegalRulePaths();
}

/** 差戻す（reviewed→draft）。根拠・確認者・確認日は保持されたまま状態のみ戻す。 */
export async function revertLegalRuleToDraft(id: string) {
  await requireCypressAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from('legal_rule_versions').update({ status: 'draft' }).eq('id', id);
  if (error) throw new Error(translateLegalRuleError(error.message));

  await supabase.rpc('log_audit', {
    p_org: null,
    p_store: null,
    p_action: 'legal_rule_version.revert_to_draft',
    p_target_table: 'legal_rule_versions',
    p_target_id: id,
    p_before: null,
    p_after: { status: 'draft' },
    p_note: null,
  });

  revalidateLegalRulePaths();
}

/**
 * 新versionで置き換え（supersede）。新しいversionをdraftとして登録し、続けて元の有効versionを
 * superseded状態に更新する（DBトリガーはactive→supersededを許可される遷移として定義済み）。
 * 新version登録が失敗した場合は元versionの状態を変更しない。
 */
export async function supersedeLegalRuleVersion(oldId: string, input: LegalRuleVersionInput) {
  await requireCypressAdmin();
  const supabase = await createClient();
  const { version, parameters } = validateLegalRuleInput(input);

  const { data: created, error: insertError } = await supabase
    .from('legal_rule_versions')
    .insert({
      rule_type: input.ruleType,
      year: input.year,
      region: input.region.trim() || null,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo || null,
      parameters,
      version,
      note: input.note.trim() || null,
      basis: input.basis.trim() || null,
      reviewed_by_name: input.reviewedByName.trim() || null,
      reviewed_at: input.reviewedAt || null,
    })
    .select('id')
    .single();
  if (insertError || !created) {
    throw new Error(translateLegalRuleError(insertError?.message ?? '新versionの作成に失敗しました'));
  }

  const { error: supersedeError } = await supabase
    .from('legal_rule_versions')
    .update({ status: 'superseded' })
    .eq('id', oldId);
  if (supersedeError) throw new Error(translateLegalRuleError(supersedeError.message));

  await supabase.rpc('log_audit', {
    p_org: null,
    p_store: null,
    p_action: 'legal_rule_version.supersede',
    p_target_table: 'legal_rule_versions',
    p_target_id: oldId,
    p_before: null,
    p_after: { superseded_id: oldId, new_version_id: created.id, new_version: version },
    p_note: input.note.trim() || null,
  });

  revalidateLegalRulePaths();
}
