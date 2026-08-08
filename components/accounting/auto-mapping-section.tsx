'use client';

import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { saveExpenseAccountMapping } from '@/app/app/accounting/auto/actions';

export interface ExpenseAccountMappingRow {
  id: string;
  name: string;
  accountId: string | null;
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
}

export function AutoMappingSection({
  rows,
  accountOptions,
}: {
  rows: ExpenseAccountMappingRow[];
  accountOptions: AccountOption[];
}) {
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState<Record<string, string | null>>(
    Object.fromEntries(rows.map((r) => [r.id, r.accountId]))
  );

  function handleChange(expenseAccountId: string, accountId: string) {
    const value = accountId || null;
    setLocal((prev) => ({ ...prev, [expenseAccountId]: value }));
    setPendingId(expenseAccountId);
    startTransition(async () => {
      try {
        await saveExpenseAccountMapping(expenseAccountId, value);
        toast('保存しました');
      } catch (err) {
        toast(err instanceof Error ? err.message : '保存に失敗しました', 'error');
      } finally {
        setPendingId(null);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>費目 → 勘定科目マッピング</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            費目（expense_accounts）が登録されていません。経費ページで費目を登録してからマッピングしてください。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>費目 → 勘定科目マッピング</CardTitle>
        <p className="mt-1 text-xs text-gray-500">
          未マッピングの費目は自動仕訳の際に雑費（599）で仮計上され、候補プレビューに警告が表示されます。
        </p>
      </CardHeader>
      <CardContent>
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>費目</Th>
                <Th>対応する勘定科目</Th>
                <Th>状態</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const value = local[r.id] ?? '';
                return (
                  <Tr key={r.id}>
                    <Td>{r.name}</Td>
                    <Td>
                      <Select
                        value={value ?? ''}
                        onChange={(e) => handleChange(r.id, e.target.value)}
                        disabled={pendingId === r.id}
                        className="w-56"
                      >
                        <option value="">未設定（雑費で計上）</option>
                        {accountOptions.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>{value ? <Badge tone="success">設定済み</Badge> : <Badge tone="warning">未設定</Badge>}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      </CardContent>
    </Card>
  );
}
