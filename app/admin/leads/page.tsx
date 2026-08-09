import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { LeadStatusSelect } from './lead-status-select';

export const metadata: Metadata = { title: 'お問い合わせ' };

const STORE_COUNT_LABELS: Record<string, string> = {
  '1': '1店舗',
  '2-5': '2〜5店舗',
  '6-10': '6〜10店舗',
  '11-30': '11〜30店舗',
  '31+': '31店舗以上',
};

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  new: { label: '未対応', tone: 'warning' },
  contacted: { label: '対応中', tone: 'primary' },
  closed: { label: '完了', tone: 'gray' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default async function LeadsPage() {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const { data: leads } = await admin
    .from('contact_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = leads ?? [];
  const newCount = rows.filter((l) => l.status === 'new').length;

  return (
    <div>
      <PageHeader
        title="お問い合わせ"
        description={`マーケティングサイトのフォームからの問い合わせ（リード）一覧。未対応 ${newCount} 件 / 直近 ${rows.length} 件`}
      />

      {rows.length === 0 ? (
        <EmptyState title="問い合わせはまだありません" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>受付日時</Th>
                <Th>お名前 / 会社・店舗</Th>
                <Th>連絡先</Th>
                <Th>店舗数</Th>
                <Th>利用中システム</Th>
                <Th>相談内容</Th>
                <Th>対応状況</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((l) => {
                const meta = STATUS_META[l.status] ?? STATUS_META.new;
                return (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap text-xs text-gray-500">{formatDate(l.created_at)}</Td>
                    <Td>
                      <p className="font-medium text-navy">{l.contact_name}</p>
                      {(l.company_name || l.store_name) && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {[l.company_name, l.store_name].filter(Boolean).join(' / ')}
                        </p>
                      )}
                    </Td>
                    <Td className="text-xs">
                      <a href={`mailto:${l.email}`} className="text-primary-deep hover:underline">{l.email}</a>
                      {l.phone && <p className="mt-0.5 text-gray-500">{l.phone}</p>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-gray-600">
                      {l.store_count ? (STORE_COUNT_LABELS[l.store_count] ?? l.store_count) : '—'}
                    </Td>
                    <Td className="max-w-[160px] text-xs text-gray-600">{l.current_tools || '—'}</Td>
                    <Td className="max-w-[260px] text-xs text-gray-600">
                      <span className="line-clamp-3 whitespace-pre-wrap">{l.message || '—'}</span>
                    </Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1.5">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <LeadStatusSelect id={l.id} status={l.status} />
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
