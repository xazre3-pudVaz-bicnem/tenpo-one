'use client';

import { Fragment, useState, useTransition } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatDateTime } from '@/lib/format';
import { setNenchoReviewing, confirmNencho, rejectNencho } from '@/app/app/payroll/nencho/actions';
import type { NenchoData } from '@/app/app/payroll/nencho/schema';

export interface NenchoAdminRow {
  id: string;
  profileName: string;
  year: number;
  status: 'submitted' | 'reviewing' | 'needs_fix' | 'confirmed';
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  data: NenchoData;
}

const STATUS_LABEL: Record<string, string> = { submitted: '提出済み', reviewing: '確認中', needs_fix: '要修正', confirmed: '確認済み' };
const STATUS_TONE: Record<string, 'gray' | 'warning' | 'success' | 'danger'> = {
  submitted: 'warning',
  reviewing: 'warning',
  needs_fix: 'danger',
  confirmed: 'success',
};

export function NenchoAdminPanel({ rows }: { rows: NenchoAdminRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const runReviewing = (id: string) => {
    startTransition(async () => {
      const result = await setNenchoReviewing(id);
      toast(result.message, result.ok ? 'success' : 'error');
    });
  };
  const runConfirm = (id: string) => {
    startTransition(async () => {
      const result = await confirmNencho(id);
      toast(result.message, result.ok ? 'success' : 'error');
    });
  };
  const runReject = async (reason: string) => {
    if (!rejectTarget) return;
    const result = await rejectNencho(rejectTarget, reason);
    toast(result.message, result.ok ? 'success' : 'error');
  };

  return (
    <TableWrap>
      <Table>
        <THead>
          <Tr>
            <Th className="w-8"></Th>
            <Th>スタッフ</Th>
            <Th>年</Th>
            <Th>状態</Th>
            <Th>提出日</Th>
            <Th className="text-right">操作</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <Tr className="cursor-pointer" onClick={() => setExpanded((cur) => (cur === r.id ? null : r.id))}>
                <Td className="text-gray-400">{expanded === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Td>
                <Td className="font-medium text-navy">{r.profileName}</Td>
                <Td>{r.year}年</Td>
                <Td>
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </Td>
                <Td>{formatDate(r.submittedAt)}</Td>
                <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-2">
                    {r.status === 'submitted' && (
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => runReviewing(r.id)}>
                        確認中にする
                      </Button>
                    )}
                    {r.status === 'reviewing' && (
                      <Button size="sm" disabled={pending} onClick={() => runConfirm(r.id)}>
                        確認済みにする
                      </Button>
                    )}
                    {(r.status === 'submitted' || r.status === 'reviewing') && (
                      <Button variant="danger" size="sm" disabled={pending} onClick={() => setRejectTarget(r.id)}>
                        差し戻す
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
              {expanded === r.id && (
                <Tr>
                  <Td colSpan={6} className="bg-gray-50/60 whitespace-normal">
                    <div className="grid gap-4 py-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-semibold text-gray-500">扶養家族</p>
                        {r.data.dependents.length === 0 ? (
                          <p className="text-xs text-gray-400">なし</p>
                        ) : (
                          <ul className="space-y-0.5 text-sm text-gray-700">
                            {r.data.dependents.map((d, i) => (
                              <li key={i}>
                                {d.name}（{d.relation}・{formatDate(d.birthDate)}）
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="space-y-1 text-sm text-gray-700">
                        <p>配偶者: {r.data.hasSpouse ? `あり（年間所得概算 ${r.data.spouseIncome?.toLocaleString('ja-JP') ?? '—'}円）` : 'なし'}</p>
                        <p>生命保険料: {r.data.lifeInsurancePremium.toLocaleString('ja-JP')}円</p>
                        <p>地震保険料: {r.data.earthquakeInsurancePremium.toLocaleString('ja-JP')}円</p>
                        <p>住宅ローン控除: {r.data.hasHousingLoanDeduction ? 'あり' : 'なし'}</p>
                        <p>前職源泉徴収票: {r.data.hasPreviousEmploymentIncome ? 'あり（提出必要）' : 'なし'}</p>
                        {r.data.basicDeductionNote && <p>基礎控除メモ: {r.data.basicDeductionNote}</p>}
                        {r.reviewNote && <p className="text-danger">差戻し理由: {r.reviewNote}</p>}
                        {r.reviewedAt && <p className="text-xs text-gray-400">最終確認: {formatDateTime(r.reviewedAt)}</p>}
                      </div>
                    </div>
                  </Td>
                </Tr>
              )}
            </Fragment>
          ))}
        </TBody>
      </Table>

      <ConfirmDialog
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="申告を差し戻す"
        message="差戻し理由を入力してください。本人に通知され、修正のうえ再提出できるようになります。"
        confirmLabel="差し戻す"
        requireReason
        destructive
        onConfirm={runReject}
      />
    </TableWrap>
  );
}
