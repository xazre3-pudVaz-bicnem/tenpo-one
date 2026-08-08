import { requireCypressAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { buildReviewRows, type LegalRuleVersionSource, type ConsumptionTaxRateSource } from '../shared';

/**
 * 専門家レビュー用一覧（#16）のCSV出力。/admin/legal-rules/review と同じbuildReviewRows()で
 * 整形するため、画面表示とCSVの値は常に一致する。
 */
export async function GET() {
  await requireCypressAdmin();
  const supabase = await createClient();

  const [{ data: ruleVersions }, { data: taxRates }] = await Promise.all([
    supabase
      .from('legal_rule_versions')
      .select(
        'id, rule_type, year, region, effective_from, effective_to, version, status, parameters, basis, reviewed_by_name, reviewed_at, updated_at'
      )
      .order('rule_type')
      .order('year', { ascending: false }),
    supabase
      .from('consumption_tax_rates')
      .select('id, treatment, rate, effective_from, effective_to, version, note, created_at')
      .order('treatment')
      .order('effective_from', { ascending: false }),
  ]);

  const rows = buildReviewRows(
    (ruleVersions ?? []) as LegalRuleVersionSource[],
    (taxRates ?? []) as ConsumptionTaxRateSource[]
  );

  const csv = toCsv(
    ['種別', '区分', '年度', '地域', 'version', '適用期間', '現在値', '根拠', '状態', '確認者', '確認日', '最終更新'],
    rows.map((r) => [
      r.source,
      r.category,
      r.year,
      r.region,
      r.version,
      r.effectivePeriod,
      r.currentValue,
      r.basis,
      r.status,
      r.reviewedBy,
      r.reviewedAt,
      r.lastUpdated,
    ])
  );
  return csvResponse(`legal_rules_review_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
