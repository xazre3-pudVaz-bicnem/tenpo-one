import type { Metadata } from 'next';
import Link from 'next/link';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { yen, formatDate, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EditCustomerDialog } from '@/components/customers/edit-customer-dialog';
import { AttributesCard } from '@/components/customers/attributes-card';
import { ConsentPanel, type ConsentState } from '@/components/customers/consent-panel';
import { TagsEditor } from '@/components/customers/tags-editor';
import { NotesSection, type NoteRow } from '@/components/customers/notes-section';
import { RecalcButton } from '@/components/customers/recalc-button';
import { DeleteCustomerButton } from '@/components/customers/delete-customer-button';
import {
  CONSENT_TYPES,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_TONES,
  type ConsentType,
  type ReservationStatus,
} from '@/components/customers/labels';

export const metadata: Metadata = { title: '顧客詳細' };

/** 最終来店日からの経過日数 */
function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMember();

  if (!can(ctx.role, 'customers.view')) {
    return (
      <div>
        <PageHeader title="顧客詳細" />
        <EmptyState title="閲覧権限がありません" description="顧客情報の閲覧には権限が必要です。管理者にお問い合わせください。" />
      </div>
    );
  }

  const supabase = await createClient();

  const { data: customer } = await supabase
    .from('customers')
    .select(
      'id, name, name_kana, phone, email, birthday, gender, postal_code, address, allergy_note, dislike_note, preference_note, seat_preference, anniversary_note, service_note, visit_count, total_spent, cancel_count, no_show_count, last_visit_at, first_visit_at, created_at'
    )
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .maybeSingle();

  if (!customer) {
    return (
      <div>
        <EmptyState
          title="顧客が見つかりません"
          description="削除されたか、アクセスできない顧客です"
          action={
            <Link href="/app/customers" className="text-sm font-medium text-primary hover:underline">
              顧客一覧へ戻る
            </Link>
          }
        />
      </div>
    );
  }

  const canWrite = can(ctx.role, 'customers.write');
  const canDelete = can(ctx.role, 'customers.delete');

  const [
    { data: consentRows },
    { data: tagLinkRows },
    { data: allTagRows },
    { data: noteRows },
    { data: reservationRows },
    { data: orderRows },
  ] = await Promise.all([
    supabase.from('customer_consents').select('consent_type, granted, granted_at').eq('customer_id', id),
    supabase.from('customer_tag_links').select('customer_tags(id, name, color)').eq('customer_id', id),
    supabase.from('customer_tags').select('id, name, color').eq('organization_id', ctx.organizationId).order('name'),
    supabase
      .from('customer_notes')
      .select('id, body, created_at, created_by')
      .eq('customer_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('reservations')
      .select('id, start_at, party_size, status, cancel_reason, stores(name)')
      .eq('customer_id', id)
      .order('start_at', { ascending: false })
      .limit(20),
    supabase
      .from('orders')
      .select('id, opened_at, total, stores(name)')
      .eq('customer_id', id)
      .in('status', ['paid', 'refunded'])
      .order('opened_at', { ascending: false })
      .limit(20),
  ]);

  // 接客メモの投稿者名を解決（created_byにFK制約はないため別クエリで解決）
  const creatorIds = [...new Set((noteRows ?? []).map((n) => n.created_by).filter((v): v is string => !!v))];
  const creatorMap = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profileRows } = await supabase.from('profiles').select('id, display_name').in('id', creatorIds);
    for (const p of profileRows ?? []) creatorMap.set(p.id, p.display_name);
  }

  const consents: Record<ConsentType, ConsentState> = {
    privacy: { granted: false, grantedAt: null },
    marketing_email: { granted: false, grantedAt: null },
    marketing_line: { granted: false, grantedAt: null },
  };
  for (const row of consentRows ?? []) {
    if (CONSENT_TYPES.includes(row.consent_type as ConsentType)) {
      consents[row.consent_type as ConsentType] = { granted: row.granted, grantedAt: row.granted_at };
    }
  }

  const attachedTags = ((tagLinkRows ?? []) as unknown as { customer_tags: { id: string; name: string; color: string } | null }[])
    .map((l) => l.customer_tags)
    .filter((t): t is { id: string; name: string; color: string } => !!t);

  const notes: NoteRow[] = (noteRows ?? []).map((n) => ({
    id: n.id,
    body: n.body,
    created_at: n.created_at,
    creatorName: n.created_by ? (creatorMap.get(n.created_by) ?? null) : null,
  }));

  const reservations = (reservationRows ?? []) as unknown as {
    id: string;
    start_at: string;
    party_size: number;
    status: ReservationStatus;
    cancel_reason: string | null;
    stores: { name: string } | null;
  }[];

  const orders = (orderRows ?? []) as unknown as {
    id: string;
    opened_at: string;
    total: number;
    stores: { name: string } | null;
  }[];

  const avgSpend = customer.visit_count > 0 ? Math.round(customer.total_spent / customer.visit_count) : 0;
  const daysSinceLastVisit = customer.last_visit_at ? daysSince(customer.last_visit_at) : null;
  const cancelDenominator = customer.visit_count + customer.cancel_count;
  const cancelRate = cancelDenominator > 0 ? (customer.cancel_count / cancelDenominator) * 100 : 0;

  return (
    <div>
      <PageHeader
        title={customer.name}
        description={`登録日 ${formatDate(customer.created_at)}${customer.name_kana ? `｜${customer.name_kana}` : ''}`}
        actions={
          <>
            <RecalcButton customerId={customer.id} />
            {canWrite && <EditCustomerDialog customer={customer} />}
            {canDelete && <DeleteCustomerButton customerId={customer.id} customerName={customer.name} />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="来店回数" value={`${customer.visit_count}回`} />
        <StatCard label="累計利用額" value={yen(customer.total_spent)} tone="primary" />
        <StatCard label="平均客単価" value={yen(avgSpend)} />
        <StatCard label="最終来店からの日数" value={daysSinceLastVisit == null ? '—' : `${daysSinceLastVisit}日`} />
        <StatCard
          label="キャンセル率"
          value={`${cancelRate.toFixed(1)}%`}
          tone={cancelRate > 0 ? 'warning' : 'default'}
          sub={`キャンセル${customer.cancel_count}件・無断キャンセル${customer.no_show_count}件`}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>基本情報</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-gray-500">電話番号</dt>
                  <dd className="mt-0.5 text-sm text-navy">{customer.phone || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">メールアドレス</dt>
                  <dd className="mt-0.5 text-sm text-navy">{customer.email || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">誕生日</dt>
                  <dd className="mt-0.5 text-sm text-navy">{customer.birthday ? formatDate(customer.birthday) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">性別</dt>
                  <dd className="mt-0.5 text-sm text-navy">
                    {customer.gender === 'male' ? '男性' : customer.gender === 'female' ? '女性' : customer.gender === 'other' ? 'その他' : '—'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-gray-500">住所</dt>
                  <dd className="mt-0.5 text-sm text-navy">
                    {customer.postal_code ? `〒${customer.postal_code} ` : ''}
                    {customer.address || (!customer.postal_code ? '—' : '')}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <AttributesCard
            customerId={customer.id}
            attributes={{
              allergy_note: customer.allergy_note,
              dislike_note: customer.dislike_note,
              preference_note: customer.preference_note,
              seat_preference: customer.seat_preference,
              anniversary_note: customer.anniversary_note,
              service_note: customer.service_note,
            }}
            canEdit={canWrite}
          />

          <NotesSection customerId={customer.id} notes={notes} canEdit={canWrite} />

          <Card>
            <CardHeader>
              <CardTitle>予約履歴（直近20件）</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {reservations.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="予約履歴はありません" className="border-0 py-8" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>日時</Th>
                        <Th>店舗</Th>
                        <Th className="text-right">人数</Th>
                        <Th>状態</Th>
                        <Th>キャンセル理由</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {reservations.map((r) => (
                        <Tr key={r.id}>
                          <Td>{formatDateTime(r.start_at)}</Td>
                          <Td>{r.stores?.name ?? '—'}</Td>
                          <Td className="text-right tabular-nums">{r.party_size}名</Td>
                          <Td>
                            <Badge tone={RESERVATION_STATUS_TONES[r.status] ?? 'gray'}>
                              {RESERVATION_STATUS_LABELS[r.status] ?? r.status}
                            </Badge>
                          </Td>
                          <Td className="text-gray-500">{r.cancel_reason || '—'}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>注文履歴（直近20件）</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {orders.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="注文履歴はありません" className="border-0 py-8" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>日時</Th>
                        <Th>店舗</Th>
                        <Th className="text-right">金額</Th>
                        <Th />
                      </Tr>
                    </THead>
                    <TBody>
                      {orders.map((o) => (
                        <Tr key={o.id}>
                          <Td>{formatDateTime(o.opened_at)}</Td>
                          <Td>{o.stores?.name ?? '—'}</Td>
                          <Td className="text-right tabular-nums">{yen(o.total)}</Td>
                          <Td>
                            <Link href={`/app/orders/${o.id}`} className="text-xs font-medium text-primary hover:underline">
                              明細を見る
                            </Link>
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

        <div className="space-y-5">
          <ConsentPanel customerId={customer.id} consents={consents} canEdit={canWrite} />
          <TagsEditor customerId={customer.id} allTags={allTagRows ?? []} attached={attachedTags} canEdit={canWrite} />
        </div>
      </div>
    </div>
  );
}
