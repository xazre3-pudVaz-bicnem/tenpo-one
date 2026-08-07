'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, Printer as PrinterIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { deletePrinterConfig } from '@/app/app/settings/printers/actions';
import { PrinterDialog, type PrinterConfigRow } from './printer-dialog';
import { TestPrintDialog } from './test-print-dialog';

const USAGE_LABEL: Record<string, string> = { receipt: 'レシート', kitchen: '厨房', label: 'ラベル' };
const CONNECTION_LABEL: Record<string, string> = {
  browser: 'ブラウザ印刷', wifi: 'Wi-Fi', lan: '有線LAN', bluetooth: 'Bluetooth', usb: 'USB',
};

export function PrintersPanel({ storeId, initial }: { storeId: string; initial: PrinterConfigRow[] }) {
  const rows = initial;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PrinterConfigRow | null>(null);
  const [deleting, setDeleting] = useState<PrinterConfigRow | null>(null);
  const [testing, setTesting] = useState<PrinterConfigRow | null>(null);
  const { toast } = useToast();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-navy">プリンター</p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          プリンター追加
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="プリンターが登録されていません" description="「プリンター追加」から登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>名前</Th>
                <Th>メーカー / 型番</Th>
                <Th>接続方式</Th>
                <Th>用途</Th>
                <Th>検証状態</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium text-navy">{r.name}</Td>
                  <Td>
                    {r.maker}
                    {r.model && ` / ${r.model}`}
                  </Td>
                  <Td>
                    {CONNECTION_LABEL[r.connectionType] ?? r.connectionType}
                    {r.connectionType !== 'browser' && (
                      <Badge tone="warning" className="ml-1">シミュレーション動作</Badge>
                    )}
                  </Td>
                  <Td>{USAGE_LABEL[r.usage] ?? r.usage}</Td>
                  <Td>
                    <Badge tone={r.isVerified ? 'success' : 'gray'}>{r.isVerified ? '検証済み' : '未検証'}</Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setTesting(r)}
                        aria-label="テスト印刷"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        <PrinterIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(r);
                          setDialogOpen(true);
                        }}
                        aria-label="編集"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(r)}
                        aria-label="削除"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {dialogOpen && <PrinterDialog storeId={storeId} editing={editing} onClose={() => setDialogOpen(false)} />}

      {testing && (
        <TestPrintDialog
          open
          onClose={() => setTesting(null)}
          printerId={testing.id}
          printerName={testing.name}
          connectionType={testing.connectionType}
          storeId={storeId}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="プリンター設定を削除"
          message={`「${deleting.name}」を削除します。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deletePrinterConfig(deleting.id, storeId);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('プリンター設定を削除しました');
          }}
        />
      )}
    </div>
  );
}
