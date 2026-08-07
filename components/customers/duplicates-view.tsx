'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate } from '@/lib/format';
import { mergeCustomers } from '@/app/app/customers/actions';

export interface DuplicateCandidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  visitCount: number;
  totalSpent: number;
  lastVisitAt: string | null;
}

export interface DuplicateGroup {
  key: string;
  matchType: 'phone' | 'email';
  customers: DuplicateCandidate[];
}

/** 累計利用額・来店回数が多い方を「残す」候補として初期選択する */
function bestGuessKeepId(customers: DuplicateCandidate[]): string {
  return [...customers].sort((a, b) => b.totalSpent - a.totalSpent || b.visitCount - a.visitCount)[0].id;
}

function MergeGroupDialog({ group, onClose }: { group: DuplicateGroup; onClose: () => void }) {
  const [keepId, setKeepId] = useState(() => bestGuessKeepId(group.customers));
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const others = group.customers.filter((c) => c.id !== keepId);

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        await mergeCustomers(
          keepId,
          others.map((o) => o.id)
        );
        toast('顧客を統合しました');
        onClose();
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '統合に失敗しました', 'error');
      }
    });
  };

  return (
    <Dialog open onClose={onClose} title="重複候補を統合">
      <p className="text-sm text-gray-700">
        残す顧客を選択してください。予約・注文・ポイント・タグ等の履歴はすべて残した顧客に引き継がれ、選択されなかった顧客は削除扱いになります。この操作は取り消せません。
      </p>
      <div className="mt-4 space-y-2">
        {group.customers.map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40"
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="keep-customer"
                checked={keepId === c.id}
                onChange={() => setKeepId(c.id)}
                className="h-4 w-4 text-primary focus:ring-primary"
              />
              <span>
                <span className="block text-sm font-medium text-navy">{c.name}</span>
                <span className="block text-xs text-gray-500">
                  {c.phone || '—'}｜{c.email || '—'}｜来店{c.visitCount}回｜{yen(c.totalSpent)}
                </span>
              </span>
            </span>
            {keepId === c.id ? <Badge tone="primary">残す</Badge> : <Badge tone="gray">統合される</Badge>}
          </label>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          キャンセル
        </Button>
        <Button variant="danger" onClick={handleConfirm} disabled={pending || others.length === 0}>
          {pending ? '統合中…' : '統合する'}
        </Button>
      </div>
    </Dialog>
  );
}

/** 電話番号・メールアドレスが一致する重複候補を並べ、統合導線を提供する（顧客一覧「重複候補」タブ） */
export function DuplicatesView({ groups, canMerge }: { groups: DuplicateGroup[]; canMerge: boolean }) {
  const [target, setTarget] = useState<DuplicateGroup | null>(null);

  if (groups.length === 0) {
    return <EmptyState title="重複候補は見つかりませんでした" description="電話番号またはメールアドレスが一致する顧客はありません" />;
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={`${g.matchType}-${g.key}`}>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-400" />
              {g.matchType === 'phone' ? '電話番号が一致' : 'メールアドレスが一致'}：{g.key}
            </CardTitle>
            {canMerge && (
              <Button size="sm" onClick={() => setTarget(g)}>
                統合
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>名前</Th>
                    <Th>電話</Th>
                    <Th>メール</Th>
                    <Th className="text-right">来店回数</Th>
                    <Th className="text-right">累計利用額</Th>
                    <Th>最終来店</Th>
                  </Tr>
                </THead>
                <TBody>
                  {g.customers.map((c) => (
                    <Tr key={c.id}>
                      <Td className="font-medium text-navy">{c.name}</Td>
                      <Td className="text-gray-600">{c.phone || '—'}</Td>
                      <Td className="text-gray-600">{c.email || '—'}</Td>
                      <Td className="text-right tabular-nums">{c.visitCount}回</Td>
                      <Td className="text-right tabular-nums">{yen(c.totalSpent)}</Td>
                      <Td className="text-gray-600">{c.lastVisitAt ? formatDate(c.lastVisitAt) : '—'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>
      ))}

      {target && <MergeGroupDialog group={target} onClose={() => setTarget(null)} />}
    </div>
  );
}
