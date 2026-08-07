'use client';

import { useState, useTransition } from 'react';
import { Pencil, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { MEMBER_RANKS, MEMBER_RANK_LABELS, type MemberRank } from './labels';
import { adjustCustomerPoints, updateCustomerMemberNo, updateCustomerMemberRank } from '@/app/app/customers/actions';

/** ポイント残高カード。会員番号・会員ランクの編集と手動調整（±ポイント・理由必須）を提供する */
export function PointsCard({
  customerId,
  pointBalance,
  memberNo,
  memberRank,
  loyaltyEnabled,
  canEdit,
  canAdjust,
}: {
  customerId: string;
  pointBalance: number;
  memberNo: string | null;
  memberRank: string;
  loyaltyEnabled: boolean;
  canEdit: boolean;
  canAdjust: boolean;
}) {
  const [memberNoOpen, setMemberNoOpen] = useState(false);
  const [memberNoInput, setMemberNoInput] = useState(memberNo ?? '');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustDirection, setAdjustDirection] = useState<'add' | 'sub'>('add');
  const [adjustAmount, setAdjustAmount] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleSaveMemberNo = () => {
    startTransition(async () => {
      try {
        await updateCustomerMemberNo(customerId, memberNoInput);
        toast('会員番号を更新しました');
        setMemberNoOpen(false);
      } catch (err) {
        toast(err instanceof Error ? err.message : '更新に失敗しました', 'error');
      }
    });
  };

  const handleRankChange = (rank: string) => {
    startTransition(async () => {
      try {
        await updateCustomerMemberRank(customerId, rank);
        toast('会員ランクを更新しました');
      } catch (err) {
        toast(err instanceof Error ? err.message : '更新に失敗しました', 'error');
      }
    });
  };

  const handleAdjust = () => {
    setError(null);
    if (!adjustAmount || adjustAmount <= 0) {
      setError('増減ポイントを入力してください');
      return;
    }
    if (!adjustReason.trim()) {
      setError('理由を入力してください');
      return;
    }
    const delta = adjustDirection === 'add' ? adjustAmount : -adjustAmount;
    startTransition(async () => {
      try {
        await adjustCustomerPoints(customerId, delta, adjustReason);
        toast('ポイントを調整しました');
        setAdjustOpen(false);
        setAdjustAmount(0);
        setAdjustReason('');
      } catch (err) {
        setError(err instanceof Error ? err.message : '調整に失敗しました');
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>ポイント・会員</CardTitle>
        {canAdjust && (
          <Button variant="secondary" size="sm" onClick={() => setAdjustOpen(true)}>
            手動調整
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500">ポイント残高</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-primary-deep">
              {pointBalance.toLocaleString('ja-JP')}
              <span className="ml-1 text-base font-medium text-gray-400">pt</span>
            </p>
          </div>
          {!loyaltyEnabled && <Badge tone="gray">ポイント機能OFF</Badge>}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="flex items-center gap-1 text-xs font-medium text-gray-500">
              会員番号
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setMemberNoInput(memberNo ?? '');
                    setMemberNoOpen(true);
                  }}
                  aria-label="会員番号を編集"
                  className="rounded p-0.5 hover:bg-gray-100"
                >
                  <Pencil className="h-3 w-3 text-gray-400" />
                </button>
              )}
            </dt>
            <dd className="mt-0.5 text-sm text-navy">{memberNo || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">会員ランク</dt>
            <dd className="mt-1">
              {canEdit ? (
                <Select
                  value={memberRank}
                  onChange={(e) => handleRankChange(e.target.value)}
                  disabled={pending}
                  className="max-w-[160px]"
                >
                  {MEMBER_RANKS.map((r) => (
                    <option key={r} value={r}>
                      {MEMBER_RANK_LABELS[r]}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-sm text-navy">
                  {MEMBER_RANK_LABELS[memberRank as MemberRank] ?? memberRank}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>

      {canEdit && (
        <Dialog open={memberNoOpen} onClose={() => setMemberNoOpen(false)} title="会員番号を編集">
          <div>
            <Label htmlFor="member-no-input">会員番号</Label>
            <Input id="member-no-input" value={memberNoInput} onChange={(e) => setMemberNoInput(e.target.value)} placeholder="M-000123" />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMemberNoOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={handleSaveMemberNo} disabled={pending}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </div>
        </Dialog>
      )}

      {canAdjust && (
        <Dialog open={adjustOpen} onClose={() => setAdjustOpen(false)} title="ポイントを手動調整">
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAdjustDirection('add')}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-medium',
                  adjustDirection === 'add' ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 text-gray-600'
                )}
              >
                <Plus className="mr-1 inline h-3.5 w-3.5" />
                付与
              </button>
              <button
                type="button"
                onClick={() => setAdjustDirection('sub')}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-medium',
                  adjustDirection === 'sub' ? 'border-danger bg-danger-soft text-danger' : 'border-gray-300 text-gray-600'
                )}
              >
                <Minus className="mr-1 inline h-3.5 w-3.5" />
                減算
              </button>
            </div>
            <div>
              <Label htmlFor="adjust-amount">ポイント数</Label>
              <Input
                id="adjust-amount"
                type="number"
                min={1}
                value={adjustAmount || ''}
                onChange={(e) => setAdjustAmount(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="adjust-reason">理由（必須・履歴に記録されます）</Label>
              <Textarea
                id="adjust-reason"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="ポイントカード移行分の手動付与 等"
              />
            </div>
            <FieldError message={error ?? undefined} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setAdjustOpen(false)} disabled={pending}>
                キャンセル
              </Button>
              <Button onClick={handleAdjust} disabled={pending}>
                {pending ? '処理中…' : '調整する'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Card>
  );
}
