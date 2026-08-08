/**
 * 専門家レビュー用一覧（/admin/legal-rules/review、#16）の共通データ整形。
 * ページ本体（page.tsx）とCSV出力（export/route.ts）の両方から同じ関数を使うことで、
 * 画面表示とCSVの値が食い違わないようにする。
 *
 * legal_rule_versions（法定ルール）と consumption_tax_rates（消費税率）は別テーブルだが、
 * 「税理士・社労士に見せる確認用一覧」という目的では同じ表にまとめて扱う。
 */

import {
  RULE_TYPE_LABELS,
  TAX_TREATMENT_LABELS,
  RULE_STATUS_LABELS,
  type RuleType,
  type RuleStatus,
  type ConsumptionTaxTreatment,
} from '../schema';

export interface LegalRuleVersionSource {
  id: string;
  rule_type: RuleType;
  year: number;
  region: string | null;
  effective_from: string;
  effective_to: string | null;
  version: string;
  status: RuleStatus;
  parameters: unknown;
  basis: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

export interface ConsumptionTaxRateSource {
  id: string;
  treatment: ConsumptionTaxTreatment;
  rate: number;
  effective_from: string;
  effective_to: string | null;
  version: string;
  note: string | null;
  created_at: string;
}

export interface ReviewRow {
  id: string;
  source: '法定ルール' | '消費税率';
  category: string;
  year: string;
  version: string;
  region: string;
  effectivePeriod: string;
  /** parametersを読みやすく整形した文字列。空文字列 = 未投入（計算エンジン未接続） */
  currentValue: string;
  basis: string;
  status: string;
  reviewedBy: string;
  reviewedAt: string;
  lastUpdated: string;
}

/** legal_rule_versions.parameters（jsonb）を "key: value" の複数行テキストへ整形する。 */
export function formatParametersDisplay(params: unknown): string {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return '';
  const entries = Object.entries(params as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
    .join('\n');
}

function formatPeriod(from: string, to: string | null): string {
  return `${from} 〜 ${to ?? ''}`;
}

export function buildReviewRows(
  ruleVersions: LegalRuleVersionSource[],
  taxRates: ConsumptionTaxRateSource[]
): ReviewRow[] {
  const ruleRows: ReviewRow[] = ruleVersions.map((r) => ({
    id: r.id,
    source: '法定ルール',
    category: RULE_TYPE_LABELS[r.rule_type],
    year: String(r.year),
    version: r.version,
    region: r.region ?? '全国',
    effectivePeriod: formatPeriod(r.effective_from, r.effective_to),
    currentValue: formatParametersDisplay(r.parameters),
    basis: r.basis ?? '',
    status: RULE_STATUS_LABELS[r.status],
    reviewedBy: r.reviewed_by_name ?? '',
    reviewedAt: r.reviewed_at ?? '',
    lastUpdated: r.updated_at,
  }));

  const taxRows: ReviewRow[] = taxRates.map((t) => ({
    id: t.id,
    source: '消費税率',
    category: TAX_TREATMENT_LABELS[t.treatment],
    year: t.effective_from.slice(0, 4),
    version: t.version,
    region: '全国',
    effectivePeriod: formatPeriod(t.effective_from, t.effective_to),
    currentValue: `${t.rate}%`,
    basis: t.note ?? '',
    status: t.effective_to ? '過去' : '現行',
    reviewedBy: '',
    reviewedAt: '',
    lastUpdated: t.created_at,
  }));

  return [...ruleRows, ...taxRows].sort((a, b) => {
    if (a.source !== b.source) return a.source === '法定ルール' ? -1 : 1;
    if (a.category !== b.category) return a.category.localeCompare(b.category, 'ja');
    return b.year.localeCompare(a.year);
  });
}
