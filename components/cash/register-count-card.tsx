'use client';

import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { closeRegister } from '@/app/app/cash/actions';
import { toUserMessage } from '@/lib/action-error';

export interface CountSession {
  id: string;
  registerName: string;
  /** このセッションの営業日。当日と違えば前営業日から開きっぱなし */
  businessDate?: string;
  openingFloat: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  cashRefunds: number;
  theoreticalCash: number;
}

/**
 * 現金実査（プロトタイプの close 右カード）。理論在高と実査額の差額を見てクローズする。
 * 締め処理は既存の closeRegister（close_register_session RPC）をそのまま呼ぶ。差額がある場合は理由必須。
 */
export function RegisterCountCard({
  session,
  showRegisterName,
  canOperate,
  today,
}: {
  session: CountSession;
  showRegisterName: boolean;
  canOperate: boolean;
  /** 当日の営業日。session.businessDate と違えば「前営業日から開きっぱなし」として警告する */
  today?: string;
}) {
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const countedValue = counted === '' ? null : Number(counted);
  const diff = countedValue == null ? null : countedValue - session.theoreticalCash;
  const needsReason = diff != null && diff !== 0;

  const handleClose = () => {
    if (countedValue == null || !Number.isInteger(countedValue) || countedValue < 0) {
      toast('実査額（数えた現金）を入力してください', 'error');
      return;
    }
    if (needsReason && !reason.trim()) {
      toast('差額がある場合は理由を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        const result = await closeRegister(session.id, countedValue, needsReason ? reason.trim() : null);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }
        toast(`${session.registerName}をクローズしました`);
        setCounted('');
        setReason('');
      } catch (err) {
        toast(toUserMessage(err, 'クローズに失敗しました'), 'error');
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle en="Cash count">現金実査{showRegisterName ? ` — ${session.registerName}` : ''}</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {/* 前営業日から開きっぱなしのレジ。これを締めないと、そのレジは新しく開局できない */}
        {today && session.businessDate && session.businessDate !== today && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            このレジは <span className="font-bold">{session.businessDate}</span>{' '}
            の営業日から開いたままです。先にこのレジを締めてください（締めるまで、このレジは新しく開局できません）。
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-b border-line py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">理論在高</p>
            <p className="text-xs text-ink-3">釣銭準備金 ＋ 現金売上 ＋ 入金 − 出金 − 現金返金</p>
            <p className="mt-1 text-[11px] text-ink-3 tabular-nums">
              {yen(session.openingFloat)} ＋ {yen(session.cashSales)} ＋ {yen(session.cashIn)} − {yen(session.cashOut)}
              {session.cashRefunds > 0 && ` − ${yen(session.cashRefunds)}`}
            </p>
          </div>
          <b className="shrink-0 text-xl font-extrabold text-ink tabular-nums">{yen(session.theoreticalCash)}</b>
        </div>

        <label className="flex items-center justify-between gap-3 border-b border-line py-4">
          <span className="text-sm font-medium text-ink">実査額（数えた現金）</span>
          <input
            inputMode="numeric"
            value={counted}
            onChange={(e) => setCounted(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="0"
            disabled={!canOperate}
            className="h-14 w-full max-w-[19rem] min-w-0 rounded-lg border border-line bg-white px-4 text-right text-[26px] font-extrabold text-ink tabular-nums placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/25"
          />
        </label>

        <div className="flex items-center justify-between gap-3 border-b border-line py-4">
          <span className="text-sm font-medium text-ink">差額</span>
          <b
            className={cn(
              'text-xl font-extrabold tabular-nums',
              diff == null ? 'text-ink' : diff === 0 ? 'text-success' : 'text-danger'
            )}
          >
            {diff == null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${yen(Math.abs(diff))}`}
          </b>
        </div>

        {needsReason && (
          <div className="border-b border-line py-3">
            <label htmlFor={`diff-reason-${session.id}`} className="mb-1 block text-sm font-medium text-danger">
              差額の理由（必須）
            </label>
            <Textarea
              id={`diff-reason-${session.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：釣銭の渡し間違い／レシートのない出金"
            />
          </div>
        )}

        {canOperate ? (
          <Button
            size="lg"
            variant={needsReason ? 'danger' : 'primary'}
            className="mt-4 w-full"
            onClick={handleClose}
            disabled={pending || (needsReason && !reason.trim())}
          >
            {pending ? 'クローズ中…' : 'レジをクローズする'}
          </Button>
        ) : (
          <p className="mt-4 text-center text-xs text-ink-3">レジ操作の権限がありません</p>
        )}
      </CardContent>
    </Card>
  );
}
