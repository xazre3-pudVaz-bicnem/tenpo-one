import type { Metadata } from 'next';
import Link from 'next/link';
import { FileSearch } from 'lucide-react';
import { requireCypressAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { LegalRulesTabs, LegalRuleCategoryFilter, type LegalRulesTab } from '@/components/admin/legal-rules-tabs';
import { ConsumptionTaxRateDialog } from '@/components/admin/consumption-tax-rate-dialog';
import { LegalRuleVersionDialog } from '@/components/admin/legal-rule-version-dialog';
import { LegalRuleStatusActions } from '@/components/admin/legal-rule-status-actions';
import {
  RULE_TYPE_LABELS,
  RULE_STATUS_LABELS,
  TAX_TREATMENT_LABELS,
  RULE_CATEGORIES,
  RULE_TYPE_TO_CATEGORY,
  type RuleStatus,
  type RuleType,
  type RuleCategory,
  type ConsumptionTaxTreatment,
} from './schema';

export const metadata: Metadata = { title: '法定ルール管理' };

const STATUS_TONES: Record<RuleStatus, BadgeTone> = {
  draft: 'gray',
  reviewed: 'warning',
  active: 'success',
  superseded: 'navy',
};

interface TaxRateRow {
  id: string;
  treatment: ConsumptionTaxTreatment;
  rate: number;
  effective_from: string;
  effective_to: string | null;
  version: string;
  note: string | null;
  created_at: string;
}

interface RuleVersionRow {
  id: string;
  rule_type: RuleType;
  year: number;
  region: string | null;
  effective_from: string;
  effective_to: string | null;
  version: string;
  status: RuleStatus;
  parameters: unknown;
  note: string | null;
  updated_at: string;
  basis: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  activated_by: string | null;
  activated_at: string | null;
}

export default async function LegalRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; category?: string }>;
}) {
  await requireCypressAdmin();
  const supabase = await createClient();
  const sp = await searchParams;
  const tab: LegalRulesTab = sp.tab === 'legal' ? 'legal' : 'consumption-tax';
  const category: RuleCategory | 'all' = RULE_CATEGORIES.includes(sp.category as RuleCategory)
    ? (sp.category as RuleCategory)
    : 'all';

  const [{ data: taxRates }, { data: ruleVersions }] = await Promise.all([
    supabase
      .from('consumption_tax_rates')
      .select('id, treatment, rate, effective_from, effective_to, version, note, created_at')
      .order('treatment')
      .order('effective_from', { ascending: false }),
    supabase
      .from('legal_rule_versions')
      .select(
        'id, rule_type, year, region, effective_from, effective_to, version, status, parameters, note, updated_at, basis, reviewed_by_name, reviewed_at, activated_by, activated_at'
      )
      .order('rule_type')
      .order('year', { ascending: false })
      .order('effective_from', { ascending: false }),
  ]);

  const rates = (taxRates ?? []) as TaxRateRow[];
  const rules = (ruleVersions ?? []) as RuleVersionRow[];
  const filteredRules =
    category === 'all' ? rules : rules.filter((r) => RULE_TYPE_TO_CATEGORY[r.rule_type] === category);

  // activated_by（uuid）を管理者名へ解決する。legal_rule_versionsにprofilesへの
  // FK制約が無いため（有効化した運営管理者=cypress側の人物であり企業組織に紐づかない想定）、
  // 表示用に別クエリで名寄せする。
  const activatorIds = [...new Set(rules.map((r) => r.activated_by).filter((v): v is string => !!v))];
  const activatorNames = new Map<string, string>();
  if (activatorIds.length > 0) {
    const { data: activators } = await supabase.from('profiles').select('id, display_name').in('id', activatorIds);
    for (const a of activators ?? []) activatorNames.set(a.id, a.display_name);
  }

  return (
    <div>
      <PageHeader
        title="法定ルール管理"
        description="消費税率・所得税・社会保険等の法定パラメータをバージョン管理します（CYPRESS運営専任）。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/legal-rules/review">
              <Button variant="secondary" size="sm">
                <FileSearch className="h-4 w-4" />
                専門家レビュー用一覧
              </Button>
            </Link>
            {tab === 'consumption-tax' ? <ConsumptionTaxRateDialog /> : <LegalRuleVersionDialog />}
          </div>
        }
      />

      <div className="mb-5 rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-xs text-primary-deep">
        一般企業ユーザーはこの画面にアクセスできず、法定ルールを編集できません（RLSで
        <code className="mx-1 rounded bg-white/60 px-1 font-mono">app_is_cypress_admin()</code>
        のみ書込可に制限。00020_native_accounting.sql）。詳細は
        <code className="mx-1 rounded bg-white/60 px-1 font-mono">docs/legal-rule-versioning.md</code>
        を参照。
      </div>

      <LegalRulesTabs active={tab} />

      {tab === 'consumption-tax' ? (
        <ConsumptionTaxTable rows={rates} />
      ) : (
        <>
          <LegalRuleCategoryFilter active={category} />
          <LegalRuleVersionsTable rows={filteredRules} activatorNames={activatorNames} />
        </>
      )}
    </div>
  );
}

function ConsumptionTaxTable({ rows }: { rows: TaxRateRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="消費税率が登録されていません" description="「税率を追加」から現行税率を登録してください" />;
  }
  return (
    <TableWrap>
      <Table>
        <THead>
          <Tr>
            <Th>区分</Th>
            <Th className="text-right">税率</Th>
            <Th>適用開始</Th>
            <Th>適用終了</Th>
            <Th>version</Th>
            <Th>メモ</Th>
            <Th>状態</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="font-medium text-navy">{TAX_TREATMENT_LABELS[r.treatment]}</Td>
              <Td className="text-right tabular-nums">{r.rate}%</Td>
              <Td className="text-xs text-gray-500">{formatDate(r.effective_from)}</Td>
              <Td className="text-xs text-gray-500">{r.effective_to ? formatDate(r.effective_to) : '—'}</Td>
              <Td className="font-mono text-xs">{r.version}</Td>
              <Td className="max-w-xs truncate text-xs text-gray-500">{r.note ?? '—'}</Td>
              <Td>
                <Badge tone={r.effective_to ? 'gray' : 'success'}>{r.effective_to ? '過去' : '現行'}</Badge>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

function LegalRuleVersionsTable({
  rows,
  activatorNames,
}: {
  rows: RuleVersionRow[];
  activatorNames: Map<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="法定ルールversionが登録されていません"
        description="「法定ルールを追加」から登録してください（値は専門家レビュー後に投入）"
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
        状態が「有効」になるまで、給与・税計算エンジンからこのルールは参照されません
        （参照可否はstatusのみで判定する設計）。draft→reviewed→active→supersededの遷移はDBトリガー
        で強制されます。
      </div>
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>区分</Th>
              <Th className="text-right">年度</Th>
              <Th>地域</Th>
              <Th>適用期間</Th>
              <Th>version</Th>
              <Th>状態</Th>
              <Th>確認</Th>
              <Th>有効化</Th>
              <Th className="text-right">操作</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="font-medium text-navy">{RULE_TYPE_LABELS[r.rule_type]}</Td>
                <Td className="text-right tabular-nums">{r.year}</Td>
                <Td className="text-xs text-gray-500">{r.region ?? '全国'}</Td>
                <Td className="text-xs text-gray-500">
                  {formatDate(r.effective_from)}
                  <br />〜{r.effective_to ? formatDate(r.effective_to) : ''}
                </Td>
                <Td className="font-mono text-xs">{r.version}</Td>
                <Td>
                  <Badge tone={STATUS_TONES[r.status]}>{RULE_STATUS_LABELS[r.status]}</Badge>
                </Td>
                <Td className="text-xs text-gray-500">
                  {r.reviewed_by_name ?? '—'}
                  <br />
                  {r.reviewed_at ? formatDate(r.reviewed_at) : ''}
                </Td>
                <Td className="text-xs text-gray-500">
                  {r.activated_by ? (activatorNames.get(r.activated_by) ?? '—') : '—'}
                  <br />
                  {r.activated_at ? formatDateTime(r.activated_at) : ''}
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    <LegalRuleStatusActions
                      rule={{
                        id: r.id,
                        rule_type: r.rule_type,
                        year: r.year,
                        region: r.region,
                        effective_from: r.effective_from,
                        effective_to: r.effective_to,
                        version: r.version,
                        status: r.status,
                        parameters: r.parameters,
                        note: r.note,
                        basis: r.basis,
                        reviewed_by_name: r.reviewed_by_name,
                        reviewed_at: r.reviewed_at,
                      }}
                    />
                    <LegalRuleVersionDialog
                      rule={{
                        id: r.id,
                        rule_type: r.rule_type,
                        year: r.year,
                        region: r.region,
                        effective_from: r.effective_from,
                        effective_to: r.effective_to,
                        version: r.version,
                        status: r.status,
                        parameters: r.parameters,
                        note: r.note,
                        basis: r.basis,
                        reviewed_by_name: r.reviewed_by_name,
                        reviewed_at: r.reviewed_at,
                      }}
                    />
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </div>
  );
}
