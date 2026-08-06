'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate } from '@/lib/format';
import { getDocumentSignedUrl, deleteDocument } from '@/app/app/invoices/actions';
import { DOC_TYPE_LABELS, type DocType } from './labels';

export interface DocumentRow {
  id: string;
  docType: DocType;
  fileName: string;
  docDate: string | null;
  amount: number | null;
  vendorName: string | null;
  storeName: string | null;
}

export function DocumentList({ rows }: { rows: DocumentRow[] }) {
  const [target, setTarget] = useState<DocumentRow | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const preview = async (doc: DocumentRow) => {
    try {
      const res = await getDocumentSignedUrl(doc.id);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast('プレビューを開けませんでした', 'error');
    }
  };

  if (rows.length === 0) {
    return <EmptyState title="該当する書類はありません" description="絞り込み条件を変更してください" />;
  }

  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>種別</Th>
              <Th>ファイル名</Th>
              <Th>日付</Th>
              <Th>取引先</Th>
              <Th>店舗</Th>
              <Th className="text-right">金額</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Badge>{DOC_TYPE_LABELS[r.docType]}</Badge>
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => void preview(r)}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.fileName}
                  </button>
                </Td>
                <Td>{formatDate(r.docDate)}</Td>
                <Td>{r.vendorName ?? '—'}</Td>
                <Td>{r.storeName ?? '全店舗'}</Td>
                <Td className="text-right tabular-nums">{yen(r.amount)}</Td>
                <Td>
                  <Button size="sm" variant="danger" onClick={() => setTarget(r)}>
                    削除
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="書類を削除"
        message={`「${target?.fileName}」を削除します。この操作は取り消せません。`}
        requireReason
        confirmLabel="削除する"
        onConfirm={async (reason) => {
          if (!target) return;
          await deleteDocument(target.id, reason);
          toast('書類を削除しました');
          router.refresh();
        }}
      />
    </>
  );
}
