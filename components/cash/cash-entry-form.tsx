'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { addCashTransaction } from '@/app/app/cash/actions';
import { buildShoppingPurpose, shoppingSpent, validateShopping, type EntryShop } from '@/lib/cash-shops';

export type { EntryShop } from '@/lib/cash-shops';

/** 出金の「買い物」（経費支払）。この理由のときだけ 担当者・買い物先・買った物・お釣り を聞く */
const SHOPPING = '買い物（経費）';

const REASONS: Record<'deposit' | 'withdrawal', string[]> = {
  deposit: ['釣銭補充', '両替', '仮払いのお釣り戻し', 'その他'],
  withdrawal: [SHOPPING, '両替', '銀行へ預入', 'その他'],
};

export interface EntrySession {
  id: string;
  registerName: string;
}

export interface EntryClerk {
  id: string;
  name: string;
}

const digits = (s: string) => s.replace(/[^\d]/g, '');
const num = (s: string) => (s === '' ? 0 : Number(s));

/**
 * 入出金の登録フォーム（入金/出金切替＋金額＋理由＋メモ）。
 * 登録は addCashTransaction（開局中セッションへの中間入出金）をそのまま使う。
 * 用途（purpose）は「理由：メモ」の形で保存する。
 *
 * 出金の「買い物（経費）」は 2026-09-28 Ronnie：
 *  払った担当者を必ず選ぶ／買い物先（仕入先）／買った物／持ち出した金額とお釣り（「ちょうど」ボタン）。
 *  レジから減るのは使った分（持出 − お釣り）なので、その金額で出金を登録する。
 */
export function CashEntryForm({
  storeId,
  sessions,
  shops = [],
  clerks = [],
}: {
  storeId: string;
  sessions: EntrySession[];
  shops?: EntryShop[];
  clerks?: EntryClerk[];
}) {
  const [kind, setKind] = useState<'deposit' | 'withdrawal'>('deposit');
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(REASONS.deposit[0]);
  const [memo, setMemo] = useState('');
  // 買い物（経費）のとき
  const [clerk, setClerk] = useState('');
  const [shop, setShop] = useState('');
  const [items, setItems] = useState('');
  const [change, setChange] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const disabled = sessions.length === 0;
  const activeSessionId = sessions.some((s) => s.id === sessionId) ? sessionId : (sessions[0]?.id ?? '');
  const shopping = kind === 'withdrawal' && reason === SHOPPING;
  const taken = num(amount);
  const changeN = num(change);
  const spent = shoppingSpent(taken, changeN);

  const switchKind = (k: 'deposit' | 'withdrawal') => {
    setKind(k);
    setReason(REASONS[k][0]);
  };

  const reset = () => {
    setAmount('');
    setMemo('');
    setShop('');
    setItems('');
    setChange('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(digits(amount));
    if (!Number.isInteger(value) || value <= 0) {
      toast(shopping ? '持ち出した金額は1円以上の整数で入力してください' : '金額は1円以上の整数で入力してください', 'error');
      return;
    }

    let purpose: string;
    let recorded = value;
    if (shopping) {
      if (change === '') {
        toast('お釣りを入力してください（お釣りが無ければ「ちょうど」）', 'error');
        return;
      }
      const input = { clerk, shop, items, taken: value, change: changeN };
      const problem = validateShopping(input);
      if (problem) {
        toast(problem, 'error');
        return;
      }
      recorded = shoppingSpent(value, changeN);
      purpose = memo.trim() ? `${buildShoppingPurpose(input)}｜${memo.trim()}` : buildShoppingPurpose(input);
    } else {
      if (reason === 'その他' && !memo.trim()) {
        toast('「その他」のときはメモを入力してください', 'error');
        return;
      }
      purpose = memo.trim() ? `${reason}：${memo.trim()}` : reason;
    }

    startTransition(async () => {
      try {
        await addCashTransaction({ storeId, registerSessionId: activeSessionId, kind, amount: recorded, purpose });
        toast(`${kind === 'deposit' ? '入金' : '出金'} ¥${recorded.toLocaleString('ja-JP')} を登録しました`);
        reset();
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
              kind === k ? 'on-brand text-white' : 'bg-white text-ink-2 hover:bg-lilac-soft'
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

      {shopping && (
        <label className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm">
          <span className="font-medium text-ink">
            払った人<span className="ml-1 text-[10.5px] font-bold text-danger">必須</span>
          </span>
          <select
            value={clerk}
            onChange={(e) => setClerk(e.target.value)}
            disabled={disabled}
            required
            aria-label="買い物を払った担当者"
            className={cn(
              'h-10 w-44 rounded-lg border bg-white px-3 text-sm text-ink disabled:bg-lilac-soft',
              clerk ? 'border-line' : 'border-danger/60'
            )}
          >
            <option value="">担当者を選ぶ</option>
            {clerks.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {shopping && (
        <div className="border-b border-line py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">
              買い物先<span className="en-inline text-[10.5px]">Shop</span>
            </span>
            <Link href="/app/vendors" className="text-[12px] font-bold text-royal hover:underline">
              ＋ 買い物先を足す（仕入先）
            </Link>
          </div>
          {shops.length === 0 ? (
            <p className="text-[12px] text-ink-3">仕入先に登録した店がここに並びます（企業で共通・ABC／五十音順）。</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {shops.map((s) => {
                const on = shop === s.name;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => setShop(on ? '' : s.name)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[13px] font-bold transition-colors',
                      on ? 'border-iris bg-iris text-white' : 'border-line bg-white text-ink-2 hover:bg-lilac-soft'
                    )}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {shopping && (
        <label className="flex items-center gap-3 border-b border-line py-3 text-sm">
          <span className="w-16 shrink-0 font-medium text-ink">
            買った物<span className="ml-1 text-[10.5px] font-bold text-danger">必須</span>
          </span>
          <input
            value={items}
            onChange={(e) => setItems(e.target.value)}
            placeholder="例：野菜・鶏肉・洗剤"
            disabled={disabled}
            maxLength={80}
            aria-label="買った物"
            className="h-10 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-ink-3 disabled:bg-lilac-soft"
          />
        </label>
      )}

      <label className="flex items-center gap-3 border-b border-line py-3">
        <span className="w-16 shrink-0 text-sm leading-tight font-medium text-ink">{shopping ? '持ち出した金額' : '金額'}</span>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(digits(e.target.value))}
          placeholder="0"
          disabled={disabled}
          aria-label={shopping ? '持ち出した金額' : '金額'}
          className="h-14 w-full min-w-0 rounded-lg border border-line bg-white px-4 text-right text-[26px] font-extrabold text-royal tabular-nums placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/25 disabled:bg-lilac-soft"
        />
      </label>

      {shopping && (
        <div className="border-b border-line py-3">
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-sm leading-tight font-medium text-ink">
              お釣り<span className="ml-1 text-[10.5px] font-bold text-danger">必須</span>
            </span>
            <input
              inputMode="numeric"
              value={change}
              onChange={(e) => setChange(digits(e.target.value))}
              placeholder="0"
              disabled={disabled}
              aria-label="お釣り"
              className="h-12 w-full min-w-0 rounded-lg border border-line bg-white px-4 text-right text-[20px] font-extrabold text-ink tabular-nums placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/25 disabled:bg-lilac-soft"
            />
            <button
              type="button"
              disabled={disabled}
              aria-pressed={change === '0'}
              onClick={() => setChange('0')}
              className={cn(
                'h-12 shrink-0 rounded-lg border px-4 text-[15px] font-bold transition-colors',
                change === '0' ? 'border-iris bg-iris text-white' : 'border-line bg-white text-royal hover:bg-lilac-soft'
              )}
            >
              ちょうど
            </button>
          </div>
          <p className="mt-2 flex items-center justify-between text-[13px] text-ink-2">
            <span>使った金額（レジから減る分）</span>
            <b className={cn('text-[17px] tabular-nums', taken > 0 && change !== '' && spent > 0 ? 'text-royal' : 'text-ink-3')}>
              ¥{(taken > 0 && change !== '' && spent > 0 ? spent : 0).toLocaleString('ja-JP')}
            </b>
          </p>
        </div>
      )}

      <label className="flex items-center justify-between gap-3 py-3 text-sm">
        <span className="shrink-0 font-medium text-ink">メモ</span>
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={shopping ? '例：レシートは事務所へ' : kind === 'withdrawal' ? '例：千円札 → 小銭' : '例：千円札 → 小銭'}
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
