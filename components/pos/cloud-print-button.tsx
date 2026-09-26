'use client';

import { useTransition } from 'react';
import { Printer, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { enqueueReceiptPrint } from '@/app/app/pos/print-actions';

/**
 * CloudPRNT対応プリンタへレシート印字ジョブを送るボタン。
 * プリンタが次回ポーリング時に取得して印字する（ブラウザ印刷の window.print とは別経路）。
 */
export function CloudPrintButton({
  orderId,
  jobType,
  reissue,
  recipientName,
  purpose,
  splitAmounts,
  disabled,
  onPrinted,
  className,
}: {
  orderId: string;
  jobType: 'receipt' | 'ryoshusho';
  reissue?: boolean;
  /** 領収書の宛名。画面で入力した内容をそのまま印字する（空欄なら「上様」） */
  recipientName?: string;
  /** 領収書の但し書き。空欄なら「飲食代として」 */
  purpose?: string;
  /** 領収書を分割して出すときの1枚ぶんの金額。2枚以上で渡すとその枚数だけ印字される */
  splitAmounts?: number[] | null;
  /** 分割の合計が合っていないときなど、押させたくないとき */
  disabled?: boolean;
  /** 送信できたら枚数を返す（領収書の「発行済み」表示に使う） */
  onPrinted?: (queued: number) => void;
  className?: string;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const handleClick = () =>
    startTransition(async () => {
      // 領収書のときだけ宛名・但し書きを送る（レシートには存在しない項目のため）
      const res = await enqueueReceiptPrint(orderId, {
        reissue,
        jobType,
        ...(jobType === 'ryoshusho'
          ? { recipientName: recipientName ?? null, purpose: purpose ?? null, splitAmounts: splitAmounts ?? null }
          : {}),
      });
      if (res.ok) {
        const n = res.queued ?? 1;
        toast(n > 1 ? `プリンタへ送信しました（${n}枚・数秒後に印字されます）` : 'プリンタへ送信しました（数秒後に印字されます）');
        onPrinted?.(n);
      } else toast(res.error ?? '送信に失敗しました', 'error');
    });

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || disabled}
      className={cn(
        'flex h-14 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-deep disabled:opacity-60 print:hidden',
        className
      )}
    >
      {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
      <span className="flex flex-col items-start leading-tight">
        <span>
          {jobType === 'ryoshusho'
            ? splitAmounts && splitAmounts.length > 1
              ? `領収書を${splitAmounts.length}枚に分けて印刷`
              : '領収書を印刷'
            : 'レシートを印刷'}
        </span>
        <span className="text-[11px] font-normal opacity-80">レジのレシートプリンター / Receipt printer</span>
      </span>
    </button>
  );
}
