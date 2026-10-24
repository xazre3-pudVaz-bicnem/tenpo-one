import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadDailyReportsPage } from '@/lib/daily-reports-server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Input, Select, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { GenerateButton } from './generate-button';
import { ReportDetailDialog } from './report-detail-dialog';

export const metadata: Metadata = { title: '日報' };

const STATUS_LABEL: Record<string, string> = { draft: '下書き', submitted: '提出済み', approved: '承認済み' };
const STATUS_TONE: Record<string, BadgeTone> = { draft: 'gray', submitted: 'warning', approved: 'success' };

export default async function DailyReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; from?: string; to?: string; store?: string; status?: string }>;
}) {
  const ctx = await requirePermission('dashboard.view');
  const supabase = await createClient();
  const sp = await searchParams;
  // 読み込みは lib/daily-reports-server.ts（iPad ネイティブと同じ。2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）
  const { today, date, targetStores, canWrite, canApprove, rows, histFrom, histTo, history } = await loadDailyReportsPage(ctx, supabase, sp);

  return (
    <div>
      <PageHeader title="日報" description="店舗ごとの当日集計をスナップショットし、店長の提出・本社の承認を管理します" />

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="date">対象日</Label>
          <Input id="date" name="date" type="date" defaultValue={date} className="w-40" max={today} />
        </div>
        <Button type="submit" variant="secondary">
          表示する
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{date.replaceAll('-', '/')} の日報</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {targetStores.length === 0 ? (
            <div className="p-5">
              <EmptyState title="アクセス可能な店舗がありません" className="border-0 py-8" />
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map(({ store: s, report, closed }) => {
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-navy">{s.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {closed ? 'レジ締め済み' : 'レジ締め未実施（当日集計のみで生成できます）'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {report && <Badge tone={STATUS_TONE[report.status] ?? 'gray'}>{STATUS_LABEL[report.status] ?? report.status}</Badge>}
                      {report && (
                        <ReportDetailDialog reportId={report.id} canSubmit={canWrite} canApprove={canApprove} triggerLabel="詳細" />
                      )}
                      {canWrite && report?.status !== 'approved' && (
                        <GenerateButton storeId={s.id} date={date} emphasized={closed} label={report ? '再生成' : '日報を生成'} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>過去の日報を検索</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="date" value={date} />
            <div>
              <Label htmlFor="from">期間（開始）</Label>
              <Input id="from" name="from" type="date" defaultValue={histFrom} className="w-40" />
            </div>
            <div>
              <Label htmlFor="to">期間（終了）</Label>
              <Input id="to" name="to" type="date" defaultValue={histTo} className="w-40" />
            </div>
            {targetStores.length > 1 && (
              <div>
                <Label htmlFor="store">店舗</Label>
                <Select id="store" name="store" defaultValue={sp.store ?? ''} className="w-40">
                  <option value="">すべて</option>
                  {targetStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="status">状態</Label>
              <Select id="status" name="status" defaultValue={sp.status ?? ''} className="w-36">
                <option value="">すべて</option>
                <option value="draft">下書き</option>
                <option value="submitted">提出済み</option>
                <option value="approved">承認済み</option>
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              検索する
            </Button>
          </form>

          {history.length === 0 ? (
            <EmptyState title="該当する日報がありません" className="border-0 py-8" />
          ) : (
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>日付</Th>
                    <Th>店舗</Th>
                    <Th>状態</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {history.map((h) => (
                    <Tr key={h.id}>
                      <Td>{h.businessDate.replaceAll('-', '/')}</Td>
                      <Td className="font-medium text-navy">{h.storeName}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[h.status] ?? 'gray'}>{STATUS_LABEL[h.status] ?? h.status}</Badge>
                      </Td>
                      <Td>
                        <ReportDetailDialog reportId={h.id} canSubmit={canWrite} canApprove={canApprove} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
