'use client';

import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen, formatDateTime } from '@/lib/format';
import { addCashTransaction, closeRegister } from '@/app/app/cash/actions';
import { KIND_LABELS, IN_KINDS, type CashKind } from '@/components/cash/labels';

export interface SessionCardData {
  id: string;
  storeId: string;
  registerName: string;
  openedByName: string;
  openedAt: string;
  openingFloat: number;
}

export function SessionCard({
  session,
  breakdown,
  theoreticalCash,
}: {
  session: SessionCardData;
  breakdown: Partial<Record<CashKind, number>>;
  theoreticalCash: number;
}) {
  const [txOpen, setTxOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const breakdownEntries = (Object.keys(breakdown) as CashKind[])
    .filter((k) => breakdown[k])
    .sort((a, b) => KIND_LABELS[a].localeCompare(KIND_LABELS[b], 'ja'));

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{session.registerName}</CardTitle>
          <p className="mt-1 text-xs text-gray-500">
            開局 {formatDateTime(session.openedAt)}｜担当 {session.openedByName}｜釣銭準備金 {yen(session.openingFloat)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setTxOpen(true)}>
            中間入出金
          </Button>
          <Button size="sm" onClick={() => setCloseOpen(true)}>
            レジ締め
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-gray-500">当セッションの内訳</p>
            {breakdownEntries.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">まだ取引がありません</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {breakdownEntries.map((k) => (
                  <li key={k} className="flex items-center justify-between">
                    <span className="text-gray-600">{KIND_LABELS[k]}</span>
                    <span className="tabular-nums font-medium text-navy">
                      {IN_KINDS.includes(k) ? '+' : '−'}
                      {yen(breakdown[k])}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col justify-center rounded-xl bg-primary-soft p-4">
            <p className="text-xs font-medium text-primary-deep">現在の理論現金</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-primary-deep">{yen(theoreticalCash)}</p>
          </div>
        </div>
      </CardContent>

      <MidTransactionDialog open={txOpen} onClose={() => setTxOpen(false)} storeId={session.storeId} sessionId={session.id} />
      <CloseRegisterDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        sessionId={session.id}
        registerName={session.registerName}
        theoreticalCash={theoreticalCash}
      />
    </Card>
  );
}

function MidTransactionDialog({
  open,
  onClose,
  storeId,
  sessionId,
}: {
  open: boolean;
  onClose: () => void;
  storeId: string;
  sessionId: string;
}) {
  const [kind, setKind] = useState<'deposit' | 'withdrawal'>('deposit');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const reset = () => {
    setKind('deposit');
    setAmount('');
    setPurpose('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) {
      toast('金額は1円以上の整数で入力してください', 'error');
      return;
    }
    if (!purpose.trim()) {
      toast('用途を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await addCashTransaction({ storeId, registerSessionId: sessionId, kind, amount: value, purpose });
        toast('登録しました');
        reset();
        onClose();
      } catch (err) {
        toast(err instanceof Error ? err.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title="中間入出金">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="tx-kind">区分</Label>
          <Select id="tx-kind" value={kind} onChange={(e) => setKind(e.target.value as 'deposit' | 'withdrawal')}>
            <option value="deposit">{KIND_LABELS.deposit}（両替・銀行入金等でレジの現金が増える）</option>
            <option value="withdrawal">{KIND_LABELS.withdrawal}（両替・銀行預入等でレジの現金が減る）</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="tx-amount">金額</Label>
          <Input id="tx-amount" type="number" inputMode="numeric" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
        </div>
        <div>
          <Label htmlFor="tx-purpose">用途</Label>
          <Input id="tx-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例：銀行へ預入" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? '登録中…' : '登録する'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CloseRegisterDialog({
  open,
  onClose,
  sessionId,
  registerName,
  theoreticalCash,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  registerName: string;
  theoreticalCash: number;
}) {
  const [countedCash, setCountedCash] = useState('');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const counted = countedCash === '' ? null : Number(countedCash);
  const diff = counted == null || !Number.isFinite(counted) ? null : counted - theoreticalCash;
  const needsReason = diff != null && diff !== 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (counted == null || !Number.isInteger(counted) || counted < 0) {
      toast('実残高は0以上の整数で入力してください', 'error');
      return;
    }
    if (needsReason && !reason.trim()) {
      toast('差異がある場合は理由を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await closeRegister(sessionId, counted, needsReason ? reason.trim() : null);
        toast('レジを締めました');
        onClose();
      } catch (err) {
        toast(err instanceof Error ? err.message : '締め処理に失敗しました', 'error');
      }
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title={`レジ締め — ${registerName}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl bg-primary-soft p-4">
          <p className="text-xs font-medium text-primary-deep">理論現金（開局額＋現金売上－返金＋入金－出金）</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-primary-deep">{yen(theoreticalCash)}</p>
        </div>
        <div>
          <Label htmlFor="counted-cash">実残高（数えた現金）</Label>
          <Input
            id="counted-cash"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={countedCash}
            onChange={(e) => setCountedCash(e.target.value)}
            placeholder="0"
          />
        </div>
        {diff != null && (
          <div className={`rounded-xl p-4 ${diff === 0 ? 'bg-success-soft' : 'bg-danger-soft'}`}>
            <p className={`text-xs font-medium ${diff === 0 ? 'text-success' : 'text-danger'}`}>差異</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${diff === 0 ? 'text-success' : 'text-danger'}`}>
              {diff > 0 ? '+' : ''}
              {yen(diff)}
            </p>
          </div>
        )}
        {needsReason && (
          <div>
            <Label htmlFor="diff-reason">差異の理由（必須）</Label>
            <Textarea id="diff-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="差異の原因を入力してください" />
            <FieldError message={!reason.trim() ? '差異がある場合は理由の入力が必須です' : undefined} />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button type="submit" variant={needsReason ? 'danger' : 'primary'} disabled={pending || (needsReason && !reason.trim())}>
            {pending ? '締め処理中…' : 'レジを締める'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
