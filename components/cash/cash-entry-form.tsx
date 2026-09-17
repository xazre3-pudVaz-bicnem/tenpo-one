'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { addCashTransaction } from '@/app/app/cash/actions';

const REASONS: Record<'deposit' | 'withdrawal', string[]> = {
  deposit: ['釣銭補充', '両替', '仮払いのお釣り戻し', 'その他'],
  withdrawal: ['経費支払', '両替', '銀行へ預入', 'その他'],
};

export interface EntrySession {
  id: string;
  registerName: string;
}

/**
 * 入出金の登録フォーム（プロトタイプの入金/出金切替＋金額＋理由＋メモ）。
 * 登録は既存の addCashTransaction（開局中セッションへの中間入出金）をそのまま使う。
 * 用途（purpose）は「理由：メモ」の形で保存する。
 */
export function CashEntryForm({ storeId, sessions }: { storeId: string; sessions: EntrySession[] }) {
  const [kind, setKind] = useState<'deposit' | 'withdrawal'>('deposit');
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(REASONS.deposit[0]);
  const [memo, setMemo] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const disabled = sessions.length === 0;
  const activeSessionId = sessions.some((s) => s.id === sessionId) ? sessionId : (sessions[0]?.id ?? '');

  const switchKind = (k: 'deposit' | 'withdrawal') => {
    setKind(k);
    setReason(REASONS[k][0]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount.replace(/[^\d]/g, ''));
    if (!Number.isInteger(value) || value <= 0) {
      toast('金額は1円以上の整数で入力してください', 'error');
      return;
    }
    if (reason === 'その他' && !memo.trim()) {
      toast('「その他」のときはメモを入力してください', 'error');
      return;
    }
    const purpose = memo.trim() ? `${reason}：${memo.trim()}` : reason;
    startTransition(async () => {
      try {
        await addCashTransaction({ storeId, registerSessionId: activeSessionId, kind, amount: value, purpose });
        toast(`${kind === 'deposit' ? '入金' : '出金'} ¥${value.toLocaleString('ja-JP')} を登録しました`);
        setAmount('');
        setMemo('');
      } catch (err) {
        toast(err instanceof Error ? err.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-1">
      <div className="grid grid-cols-2 overflow-hidden rounded-[10px] border border-line" role="tablist" aria-label="入金・出金の切替">
        {(['deposit', 'withdrawal'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => switchKind(k)}
            className={cn(
              'py-3 text-center text-[15px] font-bold transition-colors',
              kind === k ? 'bg-royal text-white' : 'bg-white text-ink-2 hover:bg-lilac-soft'
            )}
          >
            {k === 'deposit' ? '入金' : '出金'}
            <span className={cn('ml-1.5 text-[10.5px] font-semibold', kind === k ? 'text-white/75' : 'text-ink-3')}>
              {k === 'deposit' ? 'In' : 'Out'}
            </span>
          </button>
        ))}
      </div>

      {sessions.length > 1 && (
        <label className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm">
          <span className="font-medium text-ink">レジ</span>
          <select
            value={activeSessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.registerName}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex items-center gap-3 border-b border-line py-3">
        <span className="w-10 shrink-0 text-sm leading-tight font-medium text-ink">金額</span>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
          placeholder="0"
          disabled={disabled}
          aria-label="金額"
          className="h-14 w-full min-w-0 rounded-lg border border-line bg-white px-4 text-right text-[26px] font-extrabold text-royal tabular-nums placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/25 disabled:bg-lilac-soft"
        />
      </label>

      <label className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm">
        <span className="font-medium text-ink">理由</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={disabled}
          className="h-10 w-44 rounded-lg border border-line bg-white px-3 text-sm text-ink disabled:bg-lilac-soft"
        >
          {REASONS[kind].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-3 py-3 text-sm">
        <span className="shrink-0 font-medium text-ink">メモ</span>
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={kind === 'withdrawal' ? '例：野菜仕入（八百屋）' : '例：千円札 → 小銭'}
          disabled={disabled}
          maxLength={80}
          className="h-10 w-full max-w-[17rem] min-w-0 rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-ink-3 disabled:bg-lilac-soft"
        />
      </label>

      <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending || disabled}>
        {pending ? '登録中…' : '登録する'}
      </Button>
      {disabled && (
        <p className="pt-1 text-center text-xs text-ink-3">開局中のレジがありません。下の「レジ」から開局すると登録できます。</p>
      )}
    </form>
  );
}
