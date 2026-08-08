import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import { requireCypressAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { PrintButton } from './print-button';
import { buildReviewRows, type LegalRuleVersionSource, type ConsumptionTaxRateSource } from './shared';

export const metadata: Metadata = { title: '法定ルール確認一覧 | 専門家レビュー用' };

/**
 * 専門家レビュー用画面（#16）。税理士・社労士にソースコードやDB管理画面を見せず、この一覧だけで
 * TENPO ONEに登録済みの法定パラメータを確認してもらうための資料。CSV出力（/review/export）と
 * 印刷（window.print、.print-areaのみ出力）に対応する。
 */
export default async function LegalRulesReviewPage() {
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
  const generatedAt = formatDateTime(new Date());

  return (
    <div className="print-area">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <Link href="/admin/legal-rules" className="mb-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-navy">
            <ArrowLeft className="h-3.5 w-3.5" />
            法定ルール管理へ戻る
          </Link>
          <h1 className="text-xl font-bold text-navy">法定ルール確認一覧</h1>
          <p className="mt-1 text-sm text-gray-500">
            税理士・社労士等の専門家レビュー用資料です。ソースコードやDB管理画面を見せずに、この
            一覧だけで登録済みの法定パラメータを確認できます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/admin/legal-rules/review/export">
            <Button variant="secondary" size="sm">
              <Download className="h-4 w-4" />
              CSV出力
            </Button>
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-xs text-primary-deep print:border-black print:bg-white print:text-black">
        本資料はTENPO ONEに登録された法定パラメータの確認用資料です。値が空欄のルールは未投入
        （計算エンジン未接続）を意味します。
      </div>
      <p className="mb-4 hidden text-xs text-gray-500 print:block">出力日時: {generatedAt}</p>

      {rows.length === 0 ? (
        <EmptyState title="登録されている法定パラメータがありません" />
      ) : (
        <TableWrap className="print:overflow-visible print:rounded-none print:border-0">
          <Table className="print:text-[10px]">
            <THead>
              <Tr>
                <Th>種別</Th>
                <Th>区分</Th>
                <Th className="text-right">年度</Th>
                <Th>地域</Th>
                <Th>version</Th>
                <Th>適用期間</Th>
                <Th>現在値</Th>
                <Th>根拠</Th>
                <Th>状態</Th>
                <Th>確認者</Th>
                <Th>確認日</Th>
                <Th>最終更新</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={`${r.source}-${r.id}`}>
                  <Td className="text-xs text-gray-500">{r.source}</Td>
                  <Td className="font-medium text-navy">{r.category}</Td>
                  <Td className="text-right tabular-nums">{r.year}</Td>
                  <Td className="text-xs text-gray-500">{r.region}</Td>
                  <Td className="font-mono text-xs">{r.version}</Td>
                  <Td className="text-xs text-gray-500 whitespace-nowrap">{r.effectivePeriod}</Td>
                  <Td className="max-w-xs whitespace-pre-wrap text-xs">
                    {r.currentValue || <span className="text-gray-400">（未投入）</span>}
                  </Td>
                  <Td className="max-w-xs whitespace-pre-wrap text-xs text-gray-500">{r.basis || '—'}</Td>
                  <Td className="text-xs text-gray-500">{r.status}</Td>
                  <Td className="text-xs text-gray-500">{r.reviewedBy || '—'}</Td>
                  <Td className="text-xs text-gray-500">{r.reviewedAt ? formatDate(r.reviewedAt) : '—'}</Td>
                  <Td className="text-xs text-gray-500">{formatDateTime(r.lastUpdated)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
